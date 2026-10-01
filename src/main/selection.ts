// Detect a text selection (drag or double-click) and show the Ask Buddy
// button. uiohook is already running for hotkeys; we just listen.
//
// Two ways to learn what was selected. Native apps publish it through the
// accessibility tree, which costs nothing and touches nothing. Browsers
// publish no tree at all to AppleScript, so their selection is read by
// copying it — once the user has clicked the button, or the moment they
// drag while the Type to Buddy box is open (its chip needs the text then).

import { screen } from 'electron';
import { UiohookKey, uIOhook } from 'uiohook-napi';
import { createLogger } from './log';
import { copySelectedText } from './reader/copy';
import {
  AutomationDenied,
  browserFamily,
  frontmostApp,
  frontmostSelectedText,
  isSelfApp,
  type FrontmostApp,
} from './reader/frontmost';
import { highlightChipLabel } from './highlight-chip';
import { getSettings } from './settings';
import { getState } from './state';
import { isDoubleClick, isDragSelect, type PointTime } from './selection-gesture';
import {
  hideSelectionButton,
  isOverlayMarking,
  isQuickAskFocused,
  isQuickAskVisible,
  quickAskContains,
  raiseQuickAskWindow,
  sendQuickAskHighlight,
  showSelectionButton,
} from './windows';
import { errorMessage } from '../shared/errors';

const log = createLogger('selection');

/** The button gives up on its own; a selection nobody used is not an offer. */
const SHOW_MS = 8_000;

let down: PointTime | null = null;
let lastClick: PointTime | null = null;
/** What the accessibility tree gave us, when it could. */
let selectedText = '';
/** The app published nothing, so the text is fetched by copying on click. */
let copyOnAsk = false;
/** Who owned the selection — reactivated before a copy, since clicking the
 * Ask Buddy button makes Buddy itself the frontmost app. */
let owner: FrontmostApp | null = null;
let hideTimer: NodeJS.Timeout | null = null;
/** Highlighted text held for the open Type to Buddy box, separate from the Ask Buddy button. */
let quickAskText = '';
/** Bumped whenever the chip is attached or released, so a slow read can't restore a stale one. */
let chipEpoch = 0;
let probing = false;

const MODIFIER_CODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);
let deniedLogged = false;
let watching = false;

export function startSelectionWatcher(): void {
  if (watching) return;
  watching = true;

  uIOhook.on('mousedown', () => {
    down = { ...cursor(), t: Date.now() };
  });

  // Dismissal happens here rather than on mouse-down: the click that reaches
  // the Ask Buddy button is a real mouse-down too, and clearing the selection
  // under it would race the button's own IPC and usually win.
  uIOhook.on('mouseup', () => {
    const up = { ...cursor(), t: Date.now() };
    const dragged = down ? isDragSelect(down, up) : false;
    const doubled = isDoubleClick(lastClick, up);
    const insideField = down !== null && quickAskContains(down.x, down.y) && quickAskContains(up.x, up.y);
    lastClick = up;
    down = null;
    if (!(dragged || doubled) || insideField) {
      if (!isQuickAskVisible()) hideSelection();
      // A click in the highlighted app drops the selection. A click in the
      // field is them typing about it, so the chip stays.
      else if (!insideField && !isOverlayMarking()) void releaseQuickAskHighlight('click');
      return;
    }
    if (isQuickAskVisible()) {
      // Holding the talk chord to draw a mark also ends in a mouse-up. That
      // drag never selected text, so it must not replace the chip.
      if (!isOverlayMarking()) void attachToQuickAsk();
      return;
    }
    if (!getSettings().selectionButtonEnabled || getState() !== 'idle') return;
    void probeSelection(up);
  });

  uIOhook.on('wheel', () => hideSelection());

  // An arrow or a typed character in the highlighted app can collapse the
  // selection too. Keys while the field is focused belong to the draft.
  uIOhook.on('keydown', (event) => {
    if (MODIFIER_CODES.has(event.keycode)) return;
    if (!isQuickAskVisible() || isQuickAskFocused() || isOverlayMarking()) return;
    void releaseQuickAskHighlight('key');
  });
}

/**
 * Take the selection for a question, leaving nothing behind to re-ask.
 * In a browser this is where the text is actually fetched.
 */
export async function takeSelection(): Promise<string> {
  const known = selectedText;
  const byCopy = copyOnAsk;
  const from = owner;
  hideSelection();
  if (known) return known;
  if (!byCopy) return '';
  return (await copySelectedText(from)).trim();
}

/**
 * The hold-to-talk chord just went down: whatever is offered now belongs to
 * that question. The button disappears (they are talking, not clicking), the
 * expiry stops (a spoken question can outlast it), and the text itself is
 * collected by takeSelection when the pipeline runs.
 */
export function pinSelection(): void {
  if (!selectedText && !copyOnAsk) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  hideSelectionButton();
}

/** A verification this fresh still stands; key repeats must not queue osascript. */
const RELEASE_THROTTLE_MS = 300;
let lastReleaseAt = 0;

/**
 * The highlight may have been dropped: a click or a key in the app that owns
 * it. Native apps publish their selection, so it is re-read — text still
 * selected keeps the chip (grown with shift+arrow, the chip follows), text
 * gone takes it down. Browsers publish nothing: a click in the page always
 * collapses the selection, so the chip goes; a key proves nothing there and
 * leaves it alone.
 */
async function releaseQuickAskHighlight(cause: 'click' | 'key'): Promise<void> {
  if (!quickAskText || probing) return;
  if (Date.now() - lastReleaseAt < RELEASE_THROTTLE_MS) return;
  probing = true;
  const epoch = chipEpoch;
  try {
    const app = await frontmostApp();
    if (epoch !== chipEpoch || !quickAskText) return;
    // Buddy in front (or nothing readable): they went to the field or another
    // of our windows, not away from the highlighted text.
    if (!app || isSelfApp(app)) return;
    if (browserFamily(app)) {
      if (cause === 'click') clearQuickAskHighlight();
      return;
    }
    const text = (await frontmostSelectedText()).trim();
    if (epoch !== chipEpoch || !quickAskText) return;
    if (!text) {
      clearQuickAskHighlight();
    } else if (text !== quickAskText) {
      quickAskText = text;
      sendQuickAskHighlight(highlightChipLabel(text));
    }
  } catch (error) {
    if (epoch === chipEpoch) clearQuickAskHighlight();
    if (!(error instanceof AutomationDenied)) {
      log.warn(`selection probe failed: ${errorMessage(error)}`);
    }
  } finally {
    probing = false;
    lastReleaseAt = Date.now();
  }
}

/** The highlight attached to the open Type to Buddy box, if any. */
export function quickAskHighlightText(): string {
  return quickAskText;
}

/** Attach text another path already fetched (the Ask Buddy button's click). */
export function setQuickAskHighlight(text: string): void {
  chipEpoch++;
  quickAskText = text;
  sendQuickAskHighlight(highlightChipLabel(text));
}

/** Take it for the ask and clear the chip. */
export function takeQuickAskHighlight(): string {
  const text = quickAskText;
  clearQuickAskHighlight();
  return text;
}

export function clearQuickAskHighlight(): void {
  chipEpoch++;
  if (!quickAskText) {
    sendQuickAskHighlight(null);
    return;
  }
  quickAskText = '';
  sendQuickAskHighlight(null);
}

export function hideSelection(): void {
  selectedText = '';
  copyOnAsk = false;
  owner = null;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  hideSelectionButton();
}

/**
 * A selection while the Type to Buddy box is open belongs to that ask: the
 * field shows a short chip, and the full text rides along when they press
 * Enter. Browsers publish no selection, so those are read by copying — the
 * same fetch the Ask Buddy button does, just taken now so the chip can show it.
 */
async function attachToQuickAsk(): Promise<void> {
  if (probing) return;
  probing = true;
  const epoch = ++chipEpoch;
  try {
    const app = await frontmostApp();
    if (!app || isSelfApp(app) || !isQuickAskVisible() || epoch !== chipEpoch) return;
    const text = (
      browserFamily(app) ? await copySelectedText(app) : await frontmostSelectedText()
    ).trim();
    if (!text || !isQuickAskVisible() || epoch !== chipEpoch) return;
    quickAskText = text;
    sendQuickAskHighlight(highlightChipLabel(text));
    // Copying pulls the owner app forward; bring the field back so they can type.
    if (browserFamily(app)) raiseQuickAskWindow();
  } catch (error) {
    if (error instanceof AutomationDenied) {
      if (!deniedLogged) {
        deniedLogged = true;
        log.warn(`selection unavailable: ${error.message}`);
      }
      return;
    }
    log.warn(`selection probe failed: ${errorMessage(error)}`);
  } finally {
    probing = false;
  }
}

async function probeSelection(at: PointTime): Promise<void> {
  // Reading the selection spawns osascript; one at a time is plenty, and a
  // fast drag would otherwise queue a pile of them.
  if (probing) return;
  probing = true;
  try {
    const app = await frontmostApp();
    if (!app) return;

    // A browser will always answer "nothing selected", so don't bother
    // asking: offer the button and read the text if the offer is taken.
    if (browserFamily(app)) {
      offer(at, app, { copy: true });
      return;
    }

    const text = (await frontmostSelectedText()).trim();
    if (text) offer(at, app, { text });
  } catch (error) {
    // Without Automation permission every probe fails the same way, so say
    // it once instead of on every drag.
    if (error instanceof AutomationDenied) {
      if (!deniedLogged) {
        deniedLogged = true;
        log.warn(`selection button unavailable: ${error.message}`);
      }
      return;
    }
    log.warn(`selection probe failed: ${errorMessage(error)}`);
  } finally {
    probing = false;
  }
}

function offer(at: PointTime, from: FrontmostApp, source: { text?: string; copy?: boolean }): void {
  selectedText = source.text ?? '';
  copyOnAsk = source.copy ?? false;
  owner = from;
  showSelectionButton(at.x, at.y);
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideSelection, SHOW_MS);
}

function cursor(): { x: number; y: number } {
  return screen.getCursorScreenPoint();
}
