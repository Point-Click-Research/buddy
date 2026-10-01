// The only code that synthesizes mouse and keyboard input. The InputDriver
// interface hides @nut-tree-fork/nut-js so it can be swapped for a native
// helper later. Every synthetic event is reported through DriverSafetyHooks
// so safety.ts can tell Buddy's input apart from the user's (kill switch).

import { Button, Key, keyboard, mouse, Point, straightTo } from '@nut-tree-fork/nut-js';
import { execFile } from 'child_process';
import { clipboard } from 'electron';
import { promisify } from 'util';
import { claimKeys, claimMouse, claimTyping, type DriverSafetyHooks } from './claim';
import type { Point2D } from './provider';

const execFileAsync = promisify(execFile);

export type MouseButton = 'left' | 'right' | 'middle';

/** All coordinates are global screen DIP, matching Electron's screen module. */
export interface InputDriver {
  moveMouse(x: number, y: number): Promise<void>;
  click(button: MouseButton, count: number): Promise<void>;
  mouseDown(button: MouseButton): Promise<void>;
  mouseUp(button: MouseButton): Promise<void>;
  drag(from: Point2D, to: Point2D): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  /** A combo like "cmd+shift+t", "ctrl+a" or a single key like "enter". */
  pressKeys(combo: string): Promise<void>;
  /** Short text is typed key by key; longer text is pasted via the clipboard. */
  typeText(text: string): Promise<void>;
  cursorPosition(): Promise<Point2D>;
}

/** Above this length, typeText pastes via the clipboard instead of typing. */
const PASTE_THRESHOLD = 20;
const PER_KEY_MS = 25;

const BUTTONS: Record<MouseButton, Button> = {
  left: Button.LEFT,
  right: Button.RIGHT,
  middle: Button.MIDDLE,
};

/** Key names accepted in combos -> the nut.js key. Keycodes live in keycodes.ts. */
const KEYS = new Map<string, Key>();

function defineKey(names: string[], nut: Key): void {
  for (const name of names) KEYS.set(name, nut);
}

defineKey(['cmd', 'command', 'meta', 'win'], Key.LeftCmd);
defineKey(['ctrl', 'control'], Key.LeftControl);
defineKey(['alt', 'option'], Key.LeftAlt);
defineKey(['shift'], Key.LeftShift);
defineKey(['enter', 'return'], Key.Return);
defineKey(['tab'], Key.Tab);
defineKey(['escape', 'esc'], Key.Escape);
defineKey(['space'], Key.Space);
defineKey(['backspace'], Key.Backspace);
defineKey(['delete'], Key.Delete);
defineKey(['up'], Key.Up);
defineKey(['down'], Key.Down);
defineKey(['left'], Key.Left);
defineKey(['right'], Key.Right);
defineKey(['home'], Key.Home);
defineKey(['end'], Key.End);
defineKey(['pageup'], Key.PageUp);
defineKey(['pagedown'], Key.PageDown);
defineKey(['minus', '-'], Key.Minus);
defineKey(['equal', '='], Key.Equal);
defineKey(['comma', ','], Key.Comma);
defineKey(['period', '.'], Key.Period);
defineKey(['slash', '/'], Key.Slash);
defineKey(['backslash', '\\'], Key.Backslash);
defineKey(['semicolon', ';'], Key.Semicolon);
defineKey(['quote', "'"], Key.Quote);
defineKey(['grave', '`'], Key.Grave);
for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(97 + i); // a..z
  defineKey([letter], Key[letter.toUpperCase() as 'A']);
}
for (let digit = 0; digit <= 9; digit++) {
  defineKey([String(digit)], Key[`Num${digit}` as 'Num0']);
}
for (let f = 1; f <= 12; f++) {
  defineKey([`f${f}`], Key[`F${f}` as 'F1']);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Media keys ---------------------------------------------------------------
// The keyboard's playback keys, pressed system-wide: they steer whatever the
// OS considers "now playing" (Music, Spotify, a browser tab). Standalone,
// outside InputDriver, because they never touch the pointer, focus or text —
// there is nothing for the safety rails to distinguish from the user's work.

const MEDIA_KEYS = {
  play_pause: Key.AudioPlay,
  next_track: Key.AudioNext,
  previous_track: Key.AudioPrev,
  mute: Key.AudioMute,
} as const;

export type MediaKey = keyof typeof MEDIA_KEYS;

/** Press and release one media key, like a finger on the keyboard's top row. */
export async function tapMediaKey(name: MediaKey): Promise<void> {
  await keyboard.type(MEDIA_KEYS[name]);
}

// CGMouseButton and CGEventType values for the JXA multi-click below.
const CG_BUTTONS: Record<MouseButton, { button: number; down: number; up: number }> = {
  left: { button: 0, down: 1, up: 2 },
  right: { button: 1, down: 3, up: 4 },
  middle: { button: 2, down: 25, up: 26 },
};

/**
 * macOS multi-click at the current cursor position. libnut's click-state
 * upgrade compares CPU-time microseconds against a milliseconds threshold,
 * so its synthetic double-clicks almost never carry click-state 2 and macOS
 * apps ignore them. Post the canonical sequence (a down/up pair at state 1,
 * then state 2, then 3) through the system's JXA ObjC bridge instead —
 * built into macOS, no extra dependency.
 */
async function macMultiClick(button: MouseButton, count: number): Promise<void> {
  const cg = CG_BUTTONS[button];
  const script = `
ObjC.import('CoreGraphics');
const loc = $.CGEventGetLocation($.CGEventCreate($()));
for (let state = 1; state <= ${count}; state++) {
  for (const type of [${cg.down}, ${cg.up}]) {
    const event = $.CGEventCreateMouseEvent($(), type, loc, ${cg.button});
    $.CGEventSetIntegerValueField(event, 1, state); // kCGMouseEventClickState
    $.CGEventPost(0, event); // kCGHIDEventTap
  }
  if (state < ${count}) delay(0.06);
}`;
  await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 5_000 });
}

export function createNutDriver(hooks: DriverSafetyHooks): InputDriver {
  keyboard.config.autoDelayMs = PER_KEY_MS;
  mouse.config.autoDelayMs = 20;
  mouse.config.mouseSpeed = 1600; // px/s for animated drag movements

  async function pressKeys(combo: string): Promise<void> {
    const names = combo
      .toLowerCase()
      .split('+')
      .map((name) => name.trim())
      .filter(Boolean);
    const keys = names.map((name) => {
      const key = KEYS.get(name);
      if (!key) throw new Error(`Unknown key "${name}" in combo "${combo}"`);
      return key;
    });
    // Record before synthesizing: the uiohook events can arrive immediately.
    claimKeys(hooks, names);
    await keyboard.pressKey(...keys);
    await keyboard.releaseKey(...[...keys].reverse());
  }

  return {
    async moveMouse(x, y) {
      claimMouse(hooks, x, y);
      await mouse.setPosition(new Point(x, y));
    },

    async click(button, count) {
      const clicks = Math.max(1, count);
      if (clicks >= 2 && process.platform === 'darwin') {
        await macMultiClick(button, Math.min(clicks, 3));
        return;
      }
      if (clicks >= 2) {
        await mouse.doubleClick(BUTTONS[button]);
        for (let i = 2; i < clicks; i++) await mouse.click(BUTTONS[button]);
        return;
      }
      await mouse.click(BUTTONS[button]);
    },

    async mouseDown(button) {
      await mouse.pressButton(BUTTONS[button]);
    },

    async mouseUp(button) {
      await mouse.releaseButton(BUTTONS[button]);
    },

    async drag(from, to) {
      // The animated movement emits many intermediate positions; excuse them.
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      claimMouse(hooks, to.x, to.y, (distance / mouse.config.mouseSpeed) * 1000);
      await mouse.setPosition(new Point(from.x, from.y));
      await mouse.pressButton(Button.LEFT);
      await mouse.move(straightTo(new Point(to.x, to.y)));
      await mouse.releaseButton(Button.LEFT);
    },

    async scroll(dx, dy) {
      if (dy > 0) await mouse.scrollDown(dy);
      if (dy < 0) await mouse.scrollUp(-dy);
      if (dx > 0) await mouse.scrollRight(dx);
      if (dx < 0) await mouse.scrollLeft(-dx);
    },

    pressKeys,

    async typeText(text) {
      if (text.length <= PASTE_THRESHOLD) {
        claimTyping(hooks, text.length);
        await keyboard.type(text);
        return;
      }
      // Paste long text; save and restore the user's clipboard around it.
      // (Text only: rich formats on the clipboard are not preserved.)
      const saved = await clipboard.readText();
      await clipboard.writeText(text);
      await pressKeys(process.platform === 'darwin' ? 'cmd+v' : 'ctrl+v');
      await sleep(200); // let the target app read the clipboard first
      await clipboard.writeText(saved);
    },

    async cursorPosition() {
      const position = await mouse.getPosition();
      return { x: position.x, y: position.y };
    },
  };
}
