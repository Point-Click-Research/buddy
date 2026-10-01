// The browser provider: Buddy's own browser window behind the same
// ComputerProvider seam the desktop drivers use. get_window_state is a DOM
// walk, click_element a trusted mouse event at the element's centre after
// it scrolls itself into view, type_into a focus and a text insert. There is
// one window (the page), no pointer to protect, and every element is
// reachable whatever the fold — the failures that drove this exist only
// when acting on a page from outside the browser.

import type { PageDriver } from '../browser/page';
import type { NodeRef } from '../browser/dom-snapshot';
import { ACTIONS, actionsForFamilies, CLICK_BUTTONS, namesElement, unknownFields, wrongFieldsDetail } from './actions';
import { clamp, invalid, number, readPoint, sleep, text, unsupported } from './args';
import { computerError, type ComputerError } from './errors';
import type { Jev } from '../ai/jev';
import { conditionHolds, needsJev, pickElement, pickNote } from './judgement';
import { parseKeyCombo } from './keys';
import { ObservationRegistry } from './observations';
import type {
  ActionOutcome,
  ComputerDescriptor,
  ComputerProvider,
  ResolvedObservation,
  ScreenObservation,
  WindowObservationView,
} from './provider';
import { renderTree, subtreeOf, type RefRow } from './tree';
import { errorMessage } from '../../shared/errors';

const FAMILIES = ['screen', 'window', 'element', 'browser'] as const;
/** Actions a page has no equivalent for. */
const MISSING = [
  'cursor_position',
  'mouse_move',
  'left_click_drag',
  'left_mouse_down',
  'left_mouse_up',
  'list_apps',
  'bring_to_front',
  'invoke_menu',
];

/** The one window Buddy's browser has, as the model addresses it. */
const PID = 0;
const WINDOW_ID = 1;
export const BROWSER_APP = "Buddy's browser";

/** Wheel pixels per "click" of scroll_amount. */
const SCROLL_PX = 100;
const WAIT_POLL_MS = 1_000;
const MAX_WAIT_SECONDS = 30;
const MAX_WAIT_FOR_SECONDS = 30;
const DEFAULT_WAIT_FOR_SECONDS = 10;

export function createBrowserProvider(page: PageDriver, jev?: Jev): ComputerProvider {
  const descriptor: ComputerDescriptor = {
    id: 'browser',
    label: "Buddy's browser",
    families: FAMILIES,
    actions: actionsForFamilies(FAMILIES, MISSING),
    jev: jev !== undefined,
  };
  const observations = new ObservationRegistry();
  let observationCount = 0;
  /** The last capture, so an unchanged page sends no image and keeps its frame id. */
  let frame: { frameId: string; hash: string } | null = null;
  let frameCount = 0;
  let lastUrl = '';
  /** The last full page read, so a read that repeats it can say nothing changed. */
  let lastRead = '';

  const checkFrame = (frameId: unknown): ComputerError | null => {
    if (!frame) return computerError('STALE_FRAME', 'No screenshot of the page has been taken yet.');
    if (typeof frameId !== 'string' || !frameId) {
      return computerError(
        'INVALID_REQUEST',
        `Coordinates need the frame_id they were measured in; the latest is "${frame.frameId}".`,
      );
    }
    if (frameId !== frame.frameId) {
      return computerError('STALE_FRAME', `Frame ${frameId} is no longer current; the latest is ${frame.frameId}.`);
    }
    return null;
  };

  const observeScreen = async (note?: string): Promise<ActionOutcome> => {
    const capture = await page.capture();
    const size = { width: capture.width, height: capture.height };
    let observation: ScreenObservation;
    if (!capture.base64) {
      // Nothing painted yet: the frame stands (or a first one is minted) with
      // no image, and the note points at the element list instead.
      frame ??= { frameId: `b${++frameCount}`, hash: '' };
      observation = { kind: 'screen', frameId: frame.frameId, ...size, unchanged: true };
      note = [note, 'The page has no picture yet; read it with get_window_state.'].filter(Boolean).join(' ');
    } else if (frame && frame.hash === capture.hash) {
      observation = { kind: 'screen', frameId: frame.frameId, ...size, unchanged: true };
    } else {
      frame = { frameId: `b${++frameCount}`, hash: capture.hash };
      observation = { kind: 'screen', frameId: frame.frameId, ...size, base64: capture.base64 };
    }
    return { ...(note ? { text: note } : {}), observation };
  };

  const observeWindow = async (note?: string, query = ''): Promise<ActionOutcome> => {
    const snapshot = await page.snapshot();
    lastUrl = snapshot.url;
    const wanted = query.trim().toLowerCase();
    const elements = wanted
      ? snapshot.elements.filter(
          (element, index) => index === 0 || `${element.name} ${element.value} ${element.role}`.toLowerCase().includes(wanted),
        )
      : snapshot.elements;
    const recorded = observations.record({
      observationId: `p${++observationCount}`,
      pid: PID,
      windowId: WINDOW_ID,
      app: BROWSER_APP,
      title: snapshot.title,
      elements,
    });
    const rendered = renderTree(recorded.rows);
    const view: WindowObservationView = {
      kind: 'window',
      observationId: recorded.observationId,
      pid: PID,
      windowId: WINDOW_ID,
      app: BROWSER_APP,
      title: snapshot.title || snapshot.url,
      tree: rendered.text,
      shown: rendered.shown,
      kept: recorded.rows.length,
      total: snapshot.elements.length,
    };
    // Only a full read is comparable; a filtered one leaves the verdict out.
    if (!wanted) {
      const read = `${snapshot.url}\n${snapshot.title}\n${rendered.text}`;
      if (lastRead) view.unchanged = read === lastRead;
      lastRead = read;
    }
    return { ...(note ? { text: note } : {}), observation: view };
  };

  /**
   * The element an action names and the node behind it, or the refusal. By
   * ref, or by the plain words in `element`: the page is read fresh and Jev
   * picks, which saves the model the get_window_state call it would make
   * just to learn a ref.
   */
  const node = async (
    input: Record<string, unknown>,
  ): Promise<{ row: RefRow; ref: NodeRef; note?: string } | { error: ComputerError }> => {
    const wanted = text(input['element']);
    let row: RefRow;
    let note: string | undefined;
    if (wanted && input['ref'] === undefined) {
      if (!jev) return { error: needsJev('element') };
      await observeWindow();
      const current = observations.current(PID, WINDOW_ID)!;
      const picked = await pickElement(jev, current.rows, current.title || lastUrl, wanted);
      if (!picked) {
        return {
          error: computerError(
            'INVALID_REQUEST',
            `Nothing on the page confidently matched "${wanted}". Read it with get_window_state and act by ref.`,
          ),
        };
      }
      row = picked;
      note = pickNote(wanted, row);
    } else {
      const found = observations.resolve(input['observation_id'], input['ref']);
      if ('error' in found) return found;
      row = found.element;
    }
    const ref = page.nodeRef(row.token);
    if (!ref) {
      return { error: computerError('STALE_OBSERVATION', `${row.ref} belongs to a page that has since been re-read.`) };
    }
    return { row, ref, ...(note ? { note } : {}) };
  };

  async function act(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ActionOutcome> {
    switch (name) {
      case 'screenshot':
        return observeScreen();
      case 'zoom':
        // The page image is already at its own pixel size, so there is nothing to magnify.
        return observeScreen('The page is captured at full size in this browser; read from the screenshot.');
      case 'wait': {
        await sleep(clamp(number(input['duration']) ?? 1, 0, MAX_WAIT_SECONDS) * 1000);
        return observeScreen();
      }
      case 'scroll': {
        const direction = text(input['scroll_direction']);
        if (!['up', 'down', 'left', 'right'].includes(direction)) {
          return invalid('scroll needs scroll_direction: up, down, left or right.');
        }
        const amount = clamp(number(input['scroll_amount']) ?? 10, 1, 50) * SCROLL_PX;
        const at = readPoint(input, 'coordinate', checkFrame);
        if ('error' in at) return { error: at.error };
        const point = 'point' in at ? { x: at.point[0], y: at.point[1] } : undefined;
        await page.scroll(
          direction === 'left' ? -amount : direction === 'right' ? amount : 0,
          direction === 'up' ? -amount : direction === 'down' ? amount : 0,
          point,
        );
        return observeScreen();
      }
      case 'type': {
        const value = text(input['text']);
        if (!value) return invalid('type needs text.');
        await page.insertText(value);
        return observeScreen();
      }
      case 'key': {
        const combo = parseKeyCombo(text(input['text']));
        if (!combo) return invalid('key needs text: one key with optional modifiers, e.g. "cmd+a".');
        // Keys aimed at a field land in it: the field takes focus first.
        if (namesElement(input)) {
          const found = await node(input);
          if ('error' in found) return { error: found.error };
          if (!(await page.focus(found.ref))) {
            return { error: computerError('REFUSED', `${found.row.ref} would not take focus, so the keys were not sent.`) };
          }
        }
        await page.key(combo, clamp(number(input['repeat']) ?? 1, 1, 20));
        return observeScreen();
      }
      case 'list_windows':
        return { text: `pid ${PID} window_id ${WINDOW_ID} | ${BROWSER_APP} | ${page.title() || page.url()} | ${page.url()}` };
      case 'get_window_state':
        return observeWindow(undefined, text(input['query']));
      case 'expand_element': {
        const found = observations.resolve(input['observation_id'], input['ref']);
        if ('error' in found) return { error: found.error };
        const rows = subtreeOf(found.observation.rows, found.element.ref);
        if (rows.length <= 1) return { text: `${found.element.ref} has no elements inside it.` };
        return { text: `Inside ${found.element.ref}:\n${renderTree(rows.slice(1)).text}` };
      }
      case 'wait_for':
        return waitFor(input, signal);
      case 'click_element':
      case 'right_click_element': {
        const found = await node(input);
        if ('error' in found) return { error: found.error };
        // A native dropdown opens an OS menu no snapshot or capture can see,
        // so a click here only ever looks like nothing happened; the model
        // then clicks again, forever. The option is picked directly instead.
        const options = await page.selectOptions(found.ref);
        if (options) {
          return {
            error: computerError(
              'INVALID_REQUEST',
              `${found.row.ref} is a dropdown; clicking it opens a menu Buddy cannot see. Use set_value on it with one of: ${options.join(', ')}.`,
            ),
          };
        }
        const box = await page.locate(found.ref);
        if (box) {
          await page.click(box.x + box.w / 2, box.y + box.h / 2, name === 'right_click_element' ? 'right' : 'left');
        } else if (name === 'click_element') {
          // A frame Buddy could not place in the page: the element's own click.
          if (!(await page.clickNode(found.ref))) {
            return { error: computerError('REFUSED', `${found.row.ref} is no longer on the page.`) };
          }
        } else {
          return { error: computerError('REFUSED', `${found.row.ref} cannot be located on the page for a right-click.`) };
        }
        return observeWindow(found.note);
      }
      case 'set_value': {
        const value = text(input['value']);
        if (!value) return invalid('set_value needs value.');
        const found = await node(input);
        if ('error' in found) return { error: found.error };
        const result = await page.setValue(found.ref, value);
        if (result === 'no-option') {
          return { error: computerError('INVALID_REQUEST', `${found.row.ref} has no option matching "${value}". Send the option's exact text.`) };
        }
        if (result === 'missing') return { error: computerError('REFUSED', `${found.row.ref} is no longer on the page.`) };
        return observeWindow(found.note);
      }
      case 'type_into': {
        const value = text(input['text']);
        if (!value) return invalid('type_into needs text.');
        const found = await node(input);
        if ('error' in found) return { error: found.error };
        if (!(await page.focus(found.ref))) {
          return { error: computerError('REFUSED', `${found.row.ref} would not take focus. Try set_value, or click_element it first.`) };
        }
        await page.insertText(value);
        return observeWindow(found.note);
      }
      case 'navigate': {
        const url = text(input['url']);
        if (!/^https?:\/\//i.test(url)) return invalid('navigate needs an http(s) url.');
        await page.navigate(url);
        return observeWindow(`Opened ${url}.`);
      }
      default: {
        const click = CLICK_BUTTONS[name];
        if (!click) return unsupported(`"${name}" is not available in Buddy's browser.`);
        const at = readPoint(input, 'coordinate', checkFrame);
        if ('error' in at) return { error: at.error };
        if ('absent' in at) return invalid(`${name} needs coordinate in Buddy's browser: there is no pointer to click where it already is.`);
        await page.click(at.point[0], at.point[1], click.button, click.count);
        return observeScreen();
      }
    }
  }

  /**
   * Poll the page until an element appears, goes, or changes (element_text +
   * until), or a plain-language condition holds by Jev; then read it for real.
   */
  async function waitFor(input: Record<string, unknown>, signal?: AbortSignal): Promise<ActionOutcome> {
    const wanted = text(input['element_text']).toLowerCase();
    const condition = text(input['condition']);
    const until = text(input['until']) || 'appears';
    if (!wanted && !condition) return invalid('wait_for needs element_text (with until) or condition.');
    if (condition && !jev) return { error: needsJev('condition') };
    if (!['appears', 'gone', 'changed'].includes(until)) return invalid('until must be appears, gone or changed.');
    const timeoutMs = clamp(number(input['duration']) ?? DEFAULT_WAIT_FOR_SECONDS, 1, MAX_WAIT_FOR_SECONDS) * 1000;
    const started = Date.now();
    let baseline: string | null | undefined;
    let met = false;
    for (;;) {
      if (signal?.aborted) break;
      const snapshot = await page.snapshot();
      if (condition) {
        met = await conditionHolds(jev!, snapshot.elements, snapshot.title || snapshot.url, condition);
      } else {
        const match = snapshot.elements.find((element) =>
          `${element.name} ${element.value} ${element.role}`.toLowerCase().includes(wanted),
        );
        if (until === 'appears') met = match !== undefined;
        else if (until === 'gone') met = match === undefined;
        else {
          const state = match ? `${match.value}|${match.selected}` : null;
          if (baseline === undefined) baseline = state;
          else met = state !== baseline;
        }
      }
      const left = timeoutMs - (Date.now() - started);
      if (met || left <= 0) break;
      await sleep(Math.min(WAIT_POLL_MS, left));
    }
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const what =
      condition ||
      `"${text(input['element_text'])}" to ${until === 'appears' ? 'appear' : until === 'gone' ? 'disappear' : 'change'}`;
    return observeWindow(
      met
        ? `Condition met after ${elapsed}s. Here is the page now (fresh refs).`
        : `Timed out after ${elapsed}s still waiting for ${what}. Here is the page now (fresh refs).`,
    );
  }

  return {
    descriptor: () => descriptor,
    snapshot: async () => (await observeScreen()).observation as ScreenObservation,
    // Nothing on the user's displays to fly to or draw on: the page is Buddy's.
    locate: () => null,
    elementBox: () => null,
    targetApp: ({ name }) => (ACTIONS[name]?.mutates ? `${BROWSER_APP} — ${hostOf(lastUrl || page.url())}` : null),
    close: async () => undefined,

    resolveElements(observationId): ResolvedObservation | null {
      const observation = observations.observationById(observationId);
      if (!observation) return null;
      const { pid, windowId, app, title, rows } = observation;
      return { observationId: observation.observationId, pid, windowId, app, title, rows, url: lastUrl || page.url() };
    },

    async act({ name, input }, signal) {
      if (!descriptor.actions.includes(name)) {
        return { error: computerError('UNSUPPORTED_ACTION', `"${name}" is not available in Buddy's browser.`) };
      }
      const extra = unknownFields(name, input);
      if (extra.length > 0) return { error: computerError('INVALID_REQUEST', wrongFieldsDetail(name, extra)) };
      try {
        return await act(name, input, signal);
      } catch (error) {
        return { error: computerError('DRIVER_UNAVAILABLE', errorMessage(error)) };
      }
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
