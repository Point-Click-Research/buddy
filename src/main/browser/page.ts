// Driving Buddy's browser from inside the page. Reading is a script run in
// every frame (see dom-snapshot.ts); acting is the Chrome DevTools Protocol
// over webContents.debugger — trusted mouse and keyboard events the page
// cannot tell from a person's, with no pointer moved and no focus taken.
// Text goes in with Input.insertText, which is what card widgets that
// ignore value writes and drop untrusted keystrokes actually listen for.

import { createHash } from 'crypto';
import type { WebContents, WebFrameMain } from 'electron';
import type { KeyCombo } from '../computer/keys';
import type { Bounds, TreeElement } from '../computer/tree';
import { createLogger } from '../log';
import {
  frameOwner,
  nodeScript,
  parseNodeToken,
  setValueScript,
  SNAPSHOT_SCRIPT,
  toTreeElements,
  type FrameSnapshot,
  type NodeRef,
  type PlacedFrame,
} from './dom-snapshot';
import { browserPage, pageSize } from './window';
import { errorMessage } from '../../shared/errors';

const log = createLogger('browser');

const NAVIGATE_TIMEOUT_MS = 20_000;
/** Between a click and reading the page again: the page's own settle. */
const SETTLE_MS = 500;
const JPEG_QUALITY = 70;
/** A just-shown page paints within this; one retry covers it. */
const CAPTURE_RETRY_MS = 400;

export interface PageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: TreeElement[];
}

export interface PageCapture {
  base64: string;
  width: number;
  height: number;
  /** Of the bytes, for the unchanged check. */
  hash: string;
}

/** The parent frame and which of its remembered nodes owns a child frame. */
interface FrameOwner {
  parent: number;
  ownerIndex: number;
}

/** What the browser provider drives; PageSession is the real one, tests fake it. */
export interface PageDriver {
  url(): string;
  title(): string;
  navigate(url: string): Promise<void>;
  snapshot(): Promise<PageSnapshot>;
  capture(): Promise<PageCapture>;
  locate(ref: NodeRef): Promise<Bounds | null>;
  click(x: number, y: number, button?: 'left' | 'right' | 'middle', count?: number): Promise<void>;
  clickNode(ref: NodeRef): Promise<boolean>;
  /** A native <select>'s choices, or null when the node is anything else. */
  selectOptions(ref: NodeRef): Promise<string[] | null>;
  focus(ref: NodeRef): Promise<boolean>;
  insertText(text: string): Promise<void>;
  setValue(ref: NodeRef, value: string): Promise<'ok' | 'missing' | 'no-option'>;
  key(combo: KeyCombo, repeat?: number): Promise<void>;
  scroll(deltaX: number, deltaY: number, at?: { x: number; y: number }): Promise<void>;
  nodeRef(token: string | null): NodeRef | null;
}

export class PageSession implements PageDriver {
  private readonly contents: WebContents;
  /** The frames of the last snapshot, by frame number; refs are relative to it. */
  private frames: WebFrameMain[] = [];
  private owners = new Map<number, FrameOwner>();
  private attached = false;
  /** Frames already reported as refusing scripts; they refuse on every read. */
  private refused = new Set<string>();

  constructor(contents: WebContents = browserPage()) {
    this.contents = contents;
    contents.debugger.on('detach', () => {
      this.attached = false;
    });
  }

  url(): string {
    return this.contents.getURL();
  }

  title(): string {
    return this.contents.getTitle();
  }

  /** Load a page and wait for it to finish (or give up after a while). */
  async navigate(url: string): Promise<void> {
    const load = this.contents.loadURL(url);
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error(`${url} did not finish loading in ${NAVIGATE_TIMEOUT_MS / 1000}s`)), NAVIGATE_TIMEOUT_MS),
    );
    try {
      await Promise.race([load, timeout]);
    } catch (error) {
      // A slow third-party script is not a failed navigation: if the page
      // itself is there, carry on with it.
      if (!this.contents.getURL().startsWith(url.split('#')[0]!.slice(0, 24))) throw error;
      log.warn(`navigation to ${url} did not settle: ${errorMessage(error)}`);
    }
    await sleep(SETTLE_MS);
  }

  /** Every frame's elements as one list, with each frame placed in the page. */
  async snapshot(): Promise<PageSnapshot> {
    const frames = this.contents.mainFrame.framesInSubtree;
    const placed: PlacedFrame[] = [];
    const owners = new Map<number, FrameOwner>();
    for (const [number, frame] of frames.entries()) {
      const snapshot = await this.evaluate<FrameSnapshot | null>(frame, SNAPSHOT_SCRIPT);
      if (!snapshot) continue;
      let offset: PlacedFrame['offset'] = number === 0 ? { x: 0, y: 0 } : null;
      if (number > 0) {
        // The owner iframe is in whichever already-placed frame lists it.
        for (const parent of placed) {
          const owner = frameOwner(parent.snapshot, snapshot);
          if (owner?.bounds && parent.offset) {
            offset = { x: parent.offset.x + owner.bounds.x, y: parent.offset.y + owner.bounds.y };
            owners.set(number, { parent: parent.frame, ownerIndex: owner.index });
            break;
          }
        }
      }
      placed.push({ frame: number, snapshot, offset });
    }
    this.frames = frames;
    this.owners = owners;
    const main = placed[0]?.snapshot;
    return {
      url: main?.url ?? this.url(),
      title: main?.title ?? this.title(),
      viewport: main?.viewport ?? pageSize(),
      elements: toTreeElements(placed),
    };
  }

  /**
   * The page as an image in its own CSS pixel space. A page that has not
   * painted yet (nothing loaded, a window just shown) has no surface to
   * capture; that is one retry and then an empty capture, never a failed
   * task — the elements are still readable.
   */
  async capture(): Promise<PageCapture> {
    // Fixed for the capture: the window may be mid-drag, and the image must match the size it reports.
    const size = pageSize();
    let bytes: Buffer = Buffer.alloc(0);
    for (let attempt = 0; attempt < 2 && bytes.length === 0; attempt++) {
      try {
        const image = await this.contents.capturePage();
        if (!image.isEmpty()) bytes = image.resize(size).toJPEG(JPEG_QUALITY);
      } catch (error) {
        log.warn(`capture failed: ${errorMessage(error)}`);
      }
      if (bytes.length === 0) await sleep(CAPTURE_RETRY_MS);
    }
    return {
      base64: bytes.toString('base64'),
      ...size,
      hash: createHash('sha1').update(bytes).digest('hex'),
    };
  }

  /**
   * Where an element is right now, in page coordinates, after scrolling it
   * into view. Null when the node is gone or its frame cannot be placed.
   */
  async locate(ref: NodeRef): Promise<Bounds | null> {
    const frame = this.frames[ref.frame];
    if (!frame) return null;
    await this.evaluate(frame, nodeScript(ref.index, 'scrollIntoView'));
    await sleep(120);
    const rect = await this.evaluate<Bounds | null>(frame, nodeScript(ref.index, 'rect'));
    if (!rect) return null;
    const offset = await this.offsetOf(ref.frame);
    return offset ? { ...rect, x: rect.x + offset.x, y: rect.y + offset.y } : null;
  }

  /** A trusted click at a page point. */
  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left', count = 1): Promise<void> {
    const at = { x: Math.round(x), y: Math.round(y) };
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    for (let n = 1; n <= count; n++) {
      await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button, clickCount: n });
      await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button, clickCount: n });
    }
    await sleep(SETTLE_MS);
  }

  /** The element's own click(), for a node whose frame cannot be placed. */
  async clickNode(ref: NodeRef): Promise<boolean> {
    const frame = this.frames[ref.frame];
    const clicked = frame ? (await this.evaluate<boolean>(frame, nodeScript(ref.index, 'click'))) === true : false;
    if (clicked) await sleep(SETTLE_MS);
    return clicked;
  }

  async selectOptions(ref: NodeRef): Promise<string[] | null> {
    const frame = this.frames[ref.frame];
    if (!frame) return null;
    const options = await this.evaluate<string[] | null>(frame, nodeScript(ref.index, 'options'));
    return Array.isArray(options) ? options : null;
  }

  /** Give the node focus (and select its text, so typing replaces). */
  async focus(ref: NodeRef): Promise<boolean> {
    const frame = this.frames[ref.frame];
    if (!frame) return false;
    await this.evaluate(frame, nodeScript(ref.index, 'scrollIntoView'));
    return (await this.evaluate<boolean>(frame, nodeScript(ref.index, 'focus'))) === true;
  }

  /** Text into whatever has focus, as the browser's own text input. */
  async insertText(text: string): Promise<void> {
    await this.cdp('Input.insertText', { text });
    await sleep(SETTLE_MS);
  }

  /** Set a field's value with the events frameworks listen for. */
  async setValue(ref: NodeRef, value: string): Promise<'ok' | 'missing' | 'no-option'> {
    const frame = this.frames[ref.frame];
    if (!frame) return 'missing';
    const result = await this.evaluate<string>(frame, setValueScript(ref.index, value));
    await sleep(SETTLE_MS);
    return result === 'ok' || result === 'no-option' ? result : 'missing';
  }

  async key(combo: KeyCombo, repeat = 1): Promise<void> {
    const event = keyEvent(combo);
    for (let n = 0; n < repeat; n++) {
      await this.cdp('Input.dispatchKeyEvent', { type: event.text ? 'keyDown' : 'rawKeyDown', ...event });
      await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...event, text: undefined, commands: undefined });
    }
    await sleep(SETTLE_MS);
  }

  /** A wheel event at a point (the page centre unless said). */
  async scroll(deltaX: number, deltaY: number, at?: { x: number; y: number }): Promise<void> {
    const { width, height } = pageSize();
    const point = at ?? { x: width / 2, y: height / 2 };
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX, deltaY });
    await sleep(SETTLE_MS);
  }

  /** A remembered node's frame, from its token. */
  nodeRef(token: string | null): NodeRef | null {
    const ref = parseNodeToken(token);
    return ref && this.frames[ref.frame] ? ref : null;
  }

  /** A frame's origin in page coordinates, re-measured through its owner iframes. */
  private async offsetOf(frame: number): Promise<{ x: number; y: number } | null> {
    if (frame === 0) return { x: 0, y: 0 };
    const owner = this.owners.get(frame);
    const parent = owner ? this.frames[owner.parent] : undefined;
    if (!owner || !parent) return null;
    const rect = await this.evaluate<Bounds | null>(parent, nodeScript(owner.ownerIndex, 'rect'));
    const above = await this.offsetOf(owner.parent);
    return rect && above ? { x: above.x + rect.x, y: above.y + rect.y } : null;
  }

  private async evaluate<T>(frame: WebFrameMain, script: string): Promise<T | null> {
    try {
      return (await frame.executeJavaScript(script, true)) as T;
    } catch (error) {
      // A frame that navigated away mid-read, or refuses scripts: not fatal.
      // Empty placeholder frames (ad slots, trackers) refuse every script and
      // are not worth a line each; the rest get one line, without the query.
      const where = frame.url.split(/[?#]/)[0];
      if (where && where !== 'about:blank' && !this.refused.has(where)) {
        this.refused.add(where);
        log.warn(`frame script failed (${where}): ${errorMessage(error)}`);
      }
      return null;
    }
  }

  private cdp(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.attached) {
      this.contents.debugger.attach('1.3');
      this.attached = true;
    }
    return this.contents.debugger.sendCommand(method, params);
  }
}

// --- Keys ------------------------------------------------------------------------

/** CDP modifier bits. */
const MODIFIER_BITS: Record<string, number> = { alt: 1, ctrl: 2, cmd: 4, shift: 8 };

const SPECIAL_KEYS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
};

/** Editing commands a cmd-combo means, which the page performs itself. */
const EDIT_COMMANDS: Record<string, string> = { a: 'selectAll', c: 'copy', x: 'cut', v: 'paste', z: 'undo' };

/** The fields of one CDP key event for a combo (shared by its down and up). */
export function keyEvent(combo: KeyCombo): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
  commands?: string[];
} {
  const modifiers = combo.modifiers.reduce((bits, name) => bits | (MODIFIER_BITS[name] ?? 0), 0);
  const special = SPECIAL_KEYS[combo.key];
  if (special) {
    return {
      key: special.key,
      code: special.code,
      windowsVirtualKeyCode: special.vk,
      modifiers,
      ...(special.text && modifiers === 0 ? { text: special.text } : {}),
    };
  }
  const char = combo.key.length === 1 ? combo.key : combo.key.slice(0, 1);
  const upper = char.toUpperCase();
  const shifted = combo.modifiers.includes('shift');
  const key = shifted ? upper : char.toLowerCase();
  const code = /[a-z]/i.test(char) ? `Key${upper}` : /\d/.test(char) ? `Digit${char}` : upper;
  const command = combo.modifiers.includes('cmd') ? EDIT_COMMANDS[char.toLowerCase()] : undefined;
  return {
    key,
    code,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    modifiers,
    ...(modifiers === 0 || modifiers === MODIFIER_BITS['shift'] ? { text: key } : {}),
    ...(command ? { commands: [command] } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
