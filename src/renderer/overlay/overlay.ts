// Overlay entry point: wires IPC to the buddy dot and annotation drawing.

import { DISCO_COLOR, OVERLAY_COLORS, overlayCssColor } from '../../shared/color';
import { linkHost } from '../../shared/link-text';
import {
  callCardLines,
  type AppState,
  type BubbleLocation,
  type OverlayMouseMode,
  type SettingsView,
} from '../../shared/types';
import { buildSourceChip } from '../shared/source-chip';
import { clearAnnotations, drawAnnotations } from './annotations';
import { renderCaptionMarkdown } from './caption-markdown';
import { clearDrawings, revealDrawings, setDrawings } from './drawing/render';
import { initMarks, markingActive } from './marks';
import type { BuddyApi } from '../../shared/ipc';

// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

const dot = document.getElementById('buddy')!;
// The state arrives by event; until the first one, the dot is honestly idle —
// without this, an always-visible dot would wear the busy style at startup.
dot.dataset['state'] = 'idle';
const caption = document.getElementById('caption')!;
const errorBubble = document.getElementById('error-bubble')!;
const activity = document.getElementById('activity')!;
const activityText = activity.querySelector('span')!;
const askButton = document.getElementById('ask-selection')!;

// The dot trails the cursor with a slight offset and eased motion.
const OFFSET = { x: 20, y: 20 };
const EASING = 0.16; // fraction of remaining distance covered per frame

const target = { x: -100, y: -100 };
const current = { x: -100, y: -100 };
let visible = false;
/** Is the cursor on this display? Independent of the dot being shown. */
let cursorHere = false;
let captionEnabled = true; // the "show caption bubble" setting
/** The first-run walk covers the chat, so the dot's bubble is the reply. */
let walk = false;
/** Where the caption bubble (and activity pill) live: cursor-trailing or a corner. */
let bubbleLocation: BubbleLocation = 'cursor';
/** The dot trails the cursor at all times, not just while Buddy is engaged. */
let dotAlwaysVisible = false;
/** The agent is acting: the dot is a safety cue and is shown wherever it acts. */
let agentPointing = false;
/** A Watch-mode task is running on this display: Buddy has the cursor. */
let agentWatchDriving = false;
/** The Type to Buddy box is open: the field sits "next to the dot", so the dot stays out. */
let quickAskOpen = false;

void buddy.getSettings().then(applySettings);
buddy.onSettingsChanged(applySettings);

function applySettings(view: SettingsView): void {
  const wasWalk = walk;
  walk = !view.settings.onboardingDone;
  captionEnabled = view.settings.showCaptionBubble;
  bubbleLocation = view.settings.bubbleLocation;
  dotAlwaysVisible = view.settings.dotAlwaysVisible;
  syncDot(); // the toggle takes effect without waiting for the next state change
  // The Appearance tab picks the overlay colors; CSS does the rest.
  // Disco colours share one spinning hue, each offset so two discos never match.
  const style = document.documentElement.style;
  let disco = false;
  for (const { css, key, shift } of OVERLAY_COLORS) {
    const value = view.settings[key];
    style.setProperty(css, overlayCssColor(value, shift));
    if (value === DISCO_COLOR) disco = true;
  }
  document.documentElement.classList.toggle('disco', disco);
  document.documentElement.classList.toggle('vision-assist', view.settings.visionAssist);
  if (!captionEnabled || (wasWalk && !walk && chatFocused)) {
    hideCaption();
    hideActivity();
  }
}

/** Top-left position parking an element in the configured corner. */
function cornerXY(element: HTMLElement): { x: number; y: number } {
  return {
    x: bubbleLocation.endsWith('left') ? 12 : window.innerWidth - element.offsetWidth - 12,
    y: bubbleLocation.startsWith('top') ? 12 : window.innerHeight - element.offsetHeight - 12,
  };
}

/**
 * The dot is not decoration. It comes out when Buddy is called and goes away
 * once the answer is over, so a screen nobody has asked anything of has
 * nothing sitting on it. It stays out while Buddy is doing something, while
 * it is parked on what it pointed at, and while the agent is acting.
 */
function dotWanted(): boolean {
  // The agent's own marker is shown wherever it is acting: it is how the
  // user sees what is about to be clicked. In Watch mode it stays out for the
  // whole task, thinking gaps included — the cursor moving on its own with
  // nothing attached to it is the one thing worse than an unwanted dot, so
  // the "always follow my cursor" setting does not get a say here.
  if (agentPointing || agentWatchDriving) return true;
  if (!cursorHere) return false;
  // The Type to Buddy box opened beside the dot; an invisible dot would
  // leave the field floating next to nothing.
  if (quickAskOpen) return true;
  // The always-on companion: out whenever the cursor is on this display.
  if (dotAlwaysVisible) return true;
  // The bubble hangs off the dot, so the dot stays as long as it is up.
  return appState !== 'idle' || flyTarget !== null || !caption.hidden;
}

function syncDot(): void {
  const wanted = dotWanted();
  if (wanted === visible) return;
  visible = wanted;
  dot.classList.toggle('visible', wanted);
  // Arrive where it is needed rather than flying in from wherever the cursor
  // happened to be when it was last shown.
  if (wanted) {
    current.x = target.x;
    current.y = target.y;
  }
}

// When Claude points at something, the dot flies there and stays until the
// user moves the mouse meaningfully (or the annotations expire).
let flyTarget: { x: number; y: number; anchor: { x: number; y: number } } | null = null;
let flyExpireTimer: ReturnType<typeof setTimeout> | null = null;
let lastCursor = { x: 0, y: 0 };

buddy.onCursorMoved((pos) => {
  // Tracked before the dot setting is consulted: the sources list follows the
  // cursor's display whether or not the dot itself is switched on.
  lastCursor = pos;
  if (!cursorHere) {
    cursorHere = true;
    syncSources();
  }
  // Moving the mouse > 40px away recalls the dot from its flight.
  if (flyTarget && Math.hypot(pos.x - flyTarget.anchor.x, pos.y - flyTarget.anchor.y) > 40) {
    flyTarget = null;
  }
  target.x = (flyTarget?.x ?? pos.x + OFFSET.x);
  target.y = (flyTarget?.y ?? pos.y + OFFSET.y);
  syncDot();
});

function flyTo(x: number, y: number): void {
  if (!dotWanted()) return; // the dot lives on another display; the marker is enough
  // Center the 14px dot on the target rather than its top-left corner.
  const cx = x - 7;
  const cy = y - 7;
  flyTarget = { x: cx, y: cy, anchor: { ...lastCursor } };
  target.x = cx;
  target.y = cy;
  if (flyExpireTimer) clearTimeout(flyExpireTimer);
  // Return home when the annotations themselves fade (20s) — and, the answer
  // being long over by then, go away with them.
  flyExpireTimer = setTimeout(() => {
    flyTarget = null;
    syncDot();
  }, 20_000);
  syncDot();
}

buddy.onCursorHidden(() => {
  cursorHere = false;
  syncDot();
  syncSources();
});

// While listening, the dot grows with the mic level (smoothed in tick()).
let levelScaleTarget = 1;
let levelScale = 1;



buddy.onMicLevel((level) => {
  levelScaleTarget = dot.dataset['state'] === 'listening' ? 1 + Math.min(1, level) * 0.9 : 1;
});

function tick(): void {
  current.x += (target.x - current.x) * EASING;
  current.y += (target.y - current.y) * EASING;
  levelScale += (levelScaleTarget - levelScale) * 0.3;
  // The trailing scale()s pick up CSS-animated enter/exit pops (--dot-pop,
  // --pop): the scale must sit inside this transform, after the translate,
  // or it would drag the element toward the viewport origin.
  dot.style.transform = `translate3d(${current.x}px, ${current.y}px, 0) scale(${levelScale.toFixed(3)}) scale(var(--dot-pop, 1))`;

  // Caption sits above-right of the dot (clamped to the screen), or parks in
  // the corner the Appearance settings chose.
  if (!caption.hidden) {
    let x: number;
    let y: number;
    if (bubbleLocation === 'cursor') {
      x = Math.max(12, Math.min(current.x + 24, window.innerWidth - caption.offsetWidth - 12));
      y = Math.max(12, current.y - caption.offsetHeight - 12);
    } else {
      ({ x, y } = cornerXY(caption));
    }
    caption.style.transform = `translate3d(${x}px, ${y}px, 0) scale(var(--pop, 1))`;
  }
  // The activity pill takes the caption's spot, or stacks next to it when a
  // caption is up — Buddy's words matter more than his status.
  if (!activity.hidden) {
    let x: number;
    let y: number;
    if (bubbleLocation === 'cursor') {
      x = Math.max(12, Math.min(current.x + 24, window.innerWidth - activity.offsetWidth - 12));
      y = caption.hidden
        ? Math.max(12, current.y - activity.offsetHeight - 12)
        : Math.min(current.y + 26, window.innerHeight - activity.offsetHeight - 12);
    } else {
      ({ x, y } = cornerXY(activity));
      if (!caption.hidden) {
        y = bubbleLocation.startsWith('top')
          ? 12 + caption.offsetHeight + 8
          : window.innerHeight - caption.offsetHeight - 12 - activity.offsetHeight - 8;
      }
    }
    activity.style.transform = `translate3d(${x}px, ${y}px, 0) scale(var(--pop, 1))`;
  }
  // Errors follow the real cursor, not the dot — they have to land next to
  // the pointer even with the dot off. They never take the reply's slot:
  // caption stays above the cursor, error (and the activity pill) stack below.
  if (!errorBubble.hidden) {
    const x = Math.max(
      12,
      Math.min(lastCursor.x + 24, window.innerWidth - errorBubble.offsetWidth - 12),
    );
    const above = Math.max(12, lastCursor.y - errorBubble.offsetHeight - 12);
    const below = (from: number) =>
      Math.min(from, window.innerHeight - errorBubble.offsetHeight - 12);
    let y: number;
    if (!caption.hidden) {
      let from = lastCursor.y + 26;
      if (!activity.hidden) from += activity.offsetHeight + 8;
      y = below(from);
    } else if (!activity.hidden) {
      y = below(lastCursor.y + 26);
    } else {
      y = above;
    }
    errorBubble.style.transform = `translate3d(${x}px, ${y}px, 0) scale(var(--pop, 1))`;
  }
  requestAnimationFrame(tick);
}
tick();

let appState: AppState = 'idle';

buddy.onStateChanged((state) => {
  appState = state;
  dot.dataset['state'] = state;
  if (state !== 'listening') levelScaleTarget = 1;
  if (state === 'speaking') turnWasSpoken = true;
  // The hotkey — or anything else that wakes Buddy — is what brings the dot
  // out, and the return to idle is what puts it away again.
  syncDot();
  // The reading clock starts when Buddy is done talking, not before.
  if (state === 'idle') {
    scheduleCaptionHide();
    hideCallPill();
  }
});

buddy.onAnnotationsDraw((annotations) => {
  drawAnnotations(annotations);
  const point = annotations.filter((a) => a.kind === 'point').at(-1);
  if (point) flyTo(point.x, point.y);
});

buddy.onAnnotationsClear(() => {
  clearAnnotations();
  clearDrawings();
  flyTarget = null;
  syncDot();
});

buddy.onDrawings((payload) => setDrawings(payload));
buddy.onDrawingsReveal(({ names, all }) => revealDrawings(names, all === true));

// The user's own marking layer (point and talk).
initMarks(buddy);

// --- Caption bubble ----------------------------------------------------------

let captionHideTimer: ReturnType<typeof setTimeout> | null = null;

// The bubble shows one message at a time, and stays up long enough to read
// it: roughly 200 words a minute, with a floor for short lines and a ceiling
// so a wall of text can't pin it to the screen forever.
const CAPTION_MS_PER_CHAR = 60;
const CAPTION_MIN_MS = 4_000;
const CAPTION_MAX_MS = 30_000;
/**
 * A spoken answer was already read sentence-by-sentence as it played, so
 * once the voice finishes the bubble only lingers briefly — charging full
 * reading time on top of the listening time kept it up far too long.
 */
const SPOKEN_LINGER_MS = 4_000;
/** This turn's answer was (at least partly) heard out loud. */
let turnWasSpoken = false;
/** No delta for this long means the message is finished being written. */
const CAPTION_SETTLE_MS = 700;
/** Safety net for a runaway message; the panel keeps the full text. */
const CAPTION_MAX_CHARS = 2_400;

/** Set while a silent message streams (the agent's work log; panel only). */
let captionMuted = false;

/** The bubble's raw markdown, accumulated by deltas and rendered as a whole. */
let captionText = '';

/**
 * Cap the bubble's text. If the cut dropped an odd number of fence lines,
 * the kept text starts mid-code-block — reopen the fence so the block's tail
 * still renders as code instead of flipping the prose after it into code.
 */
function clipCaption(text: string): string {
  if (text.length <= CAPTION_MAX_CHARS) return text;
  const kept = text.slice(-CAPTION_MAX_CHARS);
  const dropped = text.slice(0, -CAPTION_MAX_CHARS);
  const fences = dropped.match(/^[ \t]*```/gm)?.length ?? 0;
  return fences % 2 === 1 ? `\`\`\`\n${kept}` : kept;
}

function setCaptionText(text: string): void {
  // The bubble's own bloom covers the first paint. After that, each new
  // word fades and blurs into focus on its own.
  const animate =
    caption.classList.contains('visible') && text.startsWith(captionText) && text.length > captionText.length;
  captionText = text;
  renderCaptionMarkdown(caption, text, { animate });
}

buddy.onQuickAskOpenChanged((open) => {
  quickAskOpen = open;
  syncDot();
});

// While the home window is focused, the reply is streaming right in front of
// the user; a bubble saying the same thing next to the cursor is just noise.
// During the first-run walk that window is the step, which covers the thread,
// so the dot's bubble is the only place the reply can be read.
let chatFocused = false;
/** The first-run tour talks from the dot while it opens windows; the bubble stays. */
let touring = false;

function replyIsInChat(): boolean {
  return chatFocused && !walk && !touring;
}

buddy.onTourChanged((stop) => {
  touring = stop !== null;
});

buddy.onChatFocusChanged((focused) => {
  chatFocused = focused;
  if (replyIsInChat()) {
    hideCaption();
    hideActivity();
  }
});

/**
 * Empty the bubble and take it down at once. Emptying alone left a visible,
 * padded pill with nothing in it whenever a new question or message began
 * while the last answer was still lingering — most often at an agent
 * handoff. The next delta brings the bubble back with text in it.
 */
function resetCaption(): void {
  if (captionHideTimer) clearTimeout(captionHideTimer);
  captionHideTimer = null;
  setCaptionText('');
  caption.classList.remove('visible');
  caption.hidden = true;
  syncDot();
}

buddy.onTranscript(() => {
  resetCaption(); // new question: start a fresh caption
  captionMuted = false;
  caption.classList.remove('thought');
  turnWasSpoken = false;
  clearSources();
  hideErrorBubble(); // whatever failed, the user has moved on
  askButton.hidden = true;
});

// The bubble carries only what Buddy says out loud, one message at a time, so
// what's on screen is always short enough to fit and to finish reading. The
// exception is a Watch-mode task: a silent message there is the reasoning for
// the next action, and watching Buddy work is a lot less unnerving with his
// train of thought next to the cursor. It is styled as an inner voice, never
// spoken, and any message he actually says takes the bubble back.
buddy.onMessageStart((spoken) => {
  const thought = !spoken && agentWatchDriving;
  captionMuted = !spoken && !thought;
  caption.classList.toggle('thought', thought);
  if (captionMuted) return; // leave the last spoken message up
  resetCaption();
});

buddy.onResponseDelta((delta) => {
  // Only the overlay the cursor is on shows the caption, and never while a
  // plan or question card is up (the card already shows the text) or the home
  // window is focused (the reply is streaming there).
  if (captionMuted || !captionEnabled || !cursorHere || editableCardOpen || askOpen || replyIsInChat()) return;
  setCaptionText(clipCaption(captionText + delta));
  caption.hidden = false;
  caption.classList.add('visible');
  caption.scrollTop = caption.scrollHeight; // keep the newest lines in view
  // Wait for the writing to stop before starting the reading clock.
  if (captionHideTimer) clearTimeout(captionHideTimer);
  captionHideTimer = setTimeout(scheduleCaptionHide, CAPTION_SETTLE_MS);
});

/**
 * Hide once there's been time to read what's in the bubble — but never while
 * Buddy is still thinking or speaking. The state's return to idle calls this
 * again, and that is when the reading clock actually starts.
 */
function scheduleCaptionHide(): void {
  if (caption.hidden) return;
  if (appState === 'thinking' || appState === 'speaking') return;
  if (captionHideTimer) clearTimeout(captionHideTimer);
  const readMs = captionText.length * CAPTION_MS_PER_CHAR;
  captionHideTimer = setTimeout(
    hideCaption,
    turnWasSpoken ? SPOKEN_LINGER_MS : Math.min(CAPTION_MAX_MS, Math.max(CAPTION_MIN_MS, readMs)),
  );
}

// Escape (or a new hotkey press) cancelled the turn: what the caption was
// saying is over, so it should not sit there for its scheduled reading time.
buddy.onSessionCancelled(() => {
  hideCaption();
  hideActivity();
  hideErrorBubble();
  hideTerminal();
  hideCallPill();
});

function hideCaption(): void {
  caption.classList.remove('visible');
  setTimeout(() => {
    caption.hidden = true;
    setCaptionText('');
    syncDot(); // nothing left to anchor: the dot goes too
  }, 250);
}

// --- Error bubble ----------------------------------------------------------
// Something failed and the dot blinks red for a few seconds. The red alone
// explains nothing, so the message always appears next to the cursor — on
// purpose ignoring the caption-bubble setting, because an unexplained
// failure is worse than an unwanted bubble. It stacks below the reply so
// it never covers what Buddy just said.

let errorHideTimer: ReturnType<typeof setTimeout> | null = null;

buddy.onSessionError((message) => {
  if (!cursorHere) return; // only the display the user is actually on
  errorBubble.textContent = message;
  errorBubble.hidden = false;
  requestAnimationFrame(() => errorBubble.classList.add('visible'));
  if (errorHideTimer) clearTimeout(errorHideTimer);
  const readMs = Math.min(CAPTION_MAX_MS, Math.max(CAPTION_MIN_MS, message.length * CAPTION_MS_PER_CHAR));
  errorHideTimer = setTimeout(hideErrorBubble, readMs);
});

function hideErrorBubble(): void {
  if (errorHideTimer) clearTimeout(errorHideTimer);
  errorHideTimer = null;
  errorBubble.classList.remove('visible');
  setTimeout(() => {
    errorBubble.hidden = true;
  }, 250);
}

// --- Activity pill -------------------------------------------------------------
// A shimmering one-liner ("Searching…", "Thinking…") for the gaps between
// speeches, so a tool call or a long think never looks like a hang.

let activityHideTimer: ReturnType<typeof setTimeout> | null = null;

buddy.onActivity((label) => {
  if (activityHideTimer) {
    clearTimeout(activityHideTimer);
    activityHideTimer = null;
  }
  // Shown under the same conditions as the caption: this display, bubbles
  // wanted, and never next to an open card or the focused home window.
  if (!label || !captionEnabled || !cursorHere || editableCardOpen || askOpen || replyIsInChat()) {
    hideActivity();
    return;
  }
  activityText.textContent = label;
  activity.hidden = false;
  requestAnimationFrame(() => activity.classList.add('visible'));
});

function hideActivity(): void {
  activity.classList.remove('visible');
  if (activityHideTimer) clearTimeout(activityHideTimer);
  activityHideTimer = setTimeout(() => {
    activity.hidden = true;
  }, 250);
}

// --- Sources -------------------------------------------------------------------
// Links a tool result mentioned, parked in the top-right corner so the user
// can reach them with the mouse. They sit on whichever display the cursor is
// on, and stay until the × or the next question — there is no timeout, so a
// link is still there whenever the user gets round to it.

const sourcesEl = document.getElementById('sources')!;
const sourceList = document.getElementById('source-list')!;
const shownLinks = new Set<string>();

let sourcesHidden = false;

buddy.onSessionLinks((links) => {
  for (const url of links) {
    if (shownLinks.has(url)) continue;
    shownLinks.add(url);
    // The corner is narrow, so show the site rather than the whole path.
    sourceList.append(buildSourceChip(buddy, url, linkHost(url)));
  }
  // New sources are worth another look, even if the list was dismissed.
  sourcesHidden = false;
  syncSources();
});

document.getElementById('sources-dismiss')!.addEventListener('click', hideSources);

function hideSources(): void {
  sourcesHidden = true;
  syncSources();
}

/** Shown only on the display the cursor is on, and only while wanted. */
function syncSources(): void {
  sourcesEl.hidden = shownLinks.size === 0 || !cursorHere || sourcesHidden;
  // A list that just appeared or vanished changes what the corner should do
  // with the mouse, even if the pointer never moves again.
  syncMouseMode(lastCursor.x, lastCursor.y);
}

function clearSources(): void {
  sourcesHidden = false;
  shownLinks.clear();
  sourceList.replaceChildren();
  syncSources();
}

// --- Live terminal -------------------------------------------------------------
// run_command's output as it streams, in the same card and spot as the
// confirmation that approved it, so a long command is watchable instead of a
// silent wait. Shown on the display the cursor was on when the command
// started; read-only and click-through. A new confirmation card takes the
// spot back (see onMcpConfirm).

const terminal = document.getElementById('terminal')!;
const terminalCommand = document.getElementById('terminal-command')!;
const terminalStatus = document.getElementById('terminal-status')!;
const terminalOutput = document.getElementById('terminal-output')!;
/** Plenty to watch; the model gets the full output separately. */
const TERMINAL_MAX_CHARS = 8_000;
/** Time to read how it ended before the panel fades. */
const TERMINAL_LINGER_MS = 6_000;
let terminalHideTimer: ReturnType<typeof setTimeout> | null = null;

buddy.onCommandOutput((event) => {
  if (event.kind === 'start') {
    if (!cursorHere) return; // only the display the user is actually on
    if (terminalHideTimer) clearTimeout(terminalHideTimer);
    terminalHideTimer = null;
    terminalCommand.textContent = `$ ${event.command}`;
    terminalStatus.textContent = 'running…';
    terminalOutput.textContent = '';
    terminal.hidden = false; // the card chrome animates the entrance
    return;
  }
  if (terminal.hidden) return;
  if (event.kind === 'chunk') {
    terminalOutput.textContent = ((terminalOutput.textContent ?? '') + event.text).slice(-TERMINAL_MAX_CHARS);
    terminalOutput.scrollTop = terminalOutput.scrollHeight; // keep the newest lines in view
    return;
  }
  terminalStatus.textContent = event.note;
  terminalHideTimer = setTimeout(hideTerminal, TERMINAL_LINGER_MS);
});

function hideTerminal(): void {
  if (terminalHideTimer) clearTimeout(terminalHideTimer);
  terminalHideTimer = null;
  terminal.hidden = true; // the card chrome animates the exit
}

// --- Tool confirmation card ---------------------------------------------------

const confirmCard = document.getElementById('confirm')!;
const confirmBody = document.getElementById('confirm-body')!;
const confirmTool = document.getElementById('confirm-tool')!;
const confirmDetail = document.getElementById('confirm-detail')!;
const confirmNote = document.getElementById('confirm-note')!;
const confirmPlan = document.getElementById('confirm-plan')!;
const confirmDescription = document.getElementById('confirm-description') as HTMLTextAreaElement;
const confirmMode = document.getElementById('confirm-mode')!;
const modeNote = document.getElementById('confirm-mode-note')!;
const modeRadios = [...confirmMode.querySelectorAll<HTMLInputElement>('input[name="confirm-mode"]')];
const confirmStart = document.getElementById('confirm-start')!;
const confirmHint = document.getElementById('confirm-hint')!;

/** A plan or editable-text card is open: its textarea wants the mouse and Enter. */
let editableCardOpen = false;

// The overlay is click-through except where the pointer is over something
// interactive. The plan card needs keyboard focus for its textarea; source
// links only need the click, so they must not pull focus out of the user's app.
let mouseMode: OverlayMouseMode = 'through';

function pointerOver(element: HTMLElement, x: number, y: number): boolean {
  if (element.hidden) return false;
  const box = element.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

function setMouseMode(mode: OverlayMouseMode): void {
  if (mouseMode === mode) return;
  mouseMode = mode;
  buddy.setOverlayMouse(mode);
}

/** What the pointer's current position calls for. */
function syncMouseMode(x: number, y: number): void {
  // While the user is drawing marks, main owns the mouse capture; asking for
  // 'through' here would hand the mouse back mid-stroke.
  if (markingActive()) return;
  if (editableCardOpen && pointerOver(confirmCard, x, y)) setMouseMode('focus');
  else if (askOpen && pointerOver(askCard, x, y)) setMouseMode('focus');
  else if (pointerOver(askButton, x, y) || pointerOver(sourcesEl, x, y)) setMouseMode('click');
  else setMouseMode('through');
}

window.addEventListener('mousemove', (event) => {
  syncMouseMode(event.clientX, event.clientY);
});

function readPlanDraft() {
  const picked = modeRadios.find((radio) => radio.checked)?.value;
  return {
    description: confirmDescription.value,
    // Only sent when the card offered the choice; Watch is otherwise implied.
    ...(confirmMode.hidden
      ? {}
      : { mode: picked === 'browser' ? ('browser' as const) : ('watch' as const) }),
  };
}

let draftTimer: ReturnType<typeof setTimeout> | null = null;
function pushPlanDraftSoon(): void {
  if (confirmPlan.hidden) return;
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => buddy.sendConfirmPlanDraft(readPlanDraft()), 120);
}

function submitPlan(): void {
  const draft = readPlanDraft();
  if (!draft.description.trim()) {
    confirmDescription.focus();
    return;
  }
  buddy.submitConfirmPlan(draft);
}

confirmStart.addEventListener('click', () => submitPlan());
confirmDescription.addEventListener('input', () => pushPlanDraftSoon());
for (const radio of modeRadios) radio.addEventListener('change', () => pushPlanDraftSoon());
confirmDescription.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    submitPlan();
  }
});

window.addEventListener('keydown', (event) => {
  if (confirmCard.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    buddy.cancelConfirm();
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey && event.target !== confirmDescription) {
    event.preventDefault();
    if (editableCardOpen) submitPlan();
  }
});

buddy.onMcpConfirm((card) => {
  // The card and the terminal share the same spot; a lingering terminal
  // stands aside for a new confirmation.
  if (card && !terminal.hidden) hideTerminal();
  if (!card) {
    editableCardOpen = false;
    syncMouseMode(lastCursor.x, lastCursor.y);
    // Only the card itself is hidden; its contents stay put so the exit
    // animation fades out the card the user saw, not a gutted shell. The
    // next open sets every field before showing.
    confirmCard.hidden = true;
    return;
  }
  const isPlan = Boolean(card.plan);
  const isEdit = Boolean(card.edit);
  editableCardOpen = isPlan || isEdit;
  confirmCard.classList.toggle('danger', Boolean(card.danger));
  confirmPlan.hidden = !editableCardOpen;
  confirmStart.hidden = !editableCardOpen;
  confirmDetail.hidden = !card.detail;
  confirmTool.hidden = !card.title;
  confirmNote.hidden = !card.note;
  confirmBody.hidden = !card.title && !card.detail;
  confirmTool.textContent = card.title;
  // Detail and note go through the shared markdown renderer, so a link on a
  // card reads the same as one in the caption or the chat window.
  renderCaptionMarkdown(confirmDetail, card.detail);
  renderCaptionMarkdown(confirmNote, card.note ?? '');
  if (card.plan) {
    // Buddy speaks the plan as the card opens; the bubble would just repeat
    // what the card already shows, right next to it.
    hideCaption();
    confirmDescription.value = card.plan.description;
    // Each way of running is offered only when it can actually happen; a
    // purchase offers none and says where it runs instead.
    confirmMode.hidden = !card.plan.offerBrowser;
    modeNote.hidden = !card.plan.lockedNote;
    modeNote.textContent = card.plan.lockedNote ?? '';
    for (const radio of modeRadios) {
      radio.checked = radio.value === (card.plan.mode ?? 'watch');
    }
    confirmStart.textContent = 'Start';
    pushPlanDraftSoon();
    confirmHint.textContent = '⏎ or say “Start” · Esc cancels · ⇧⏎ new line';
  } else if (card.edit) {
    // Editable text that isn't a plan: a message before it sends, or a whole
    // distilled skill. The box grows to the text and scrolls past its cap.
    confirmDescription.value = card.edit.text;
    confirmMode.hidden = true;
    modeNote.hidden = true;
    confirmStart.textContent = card.edit.action;
    pushPlanDraftSoon();
    confirmHint.textContent = 'Edit if you like · ⏎ or “Yes” · Esc cancels';
  } else {
    confirmHint.textContent = card.danger
      ? 'Can’t be undone · ⏎ or “Yes” runs it · Esc cancels'
      : '⏎ or say “Yes” · Esc to cancel';
  }
  syncMouseMode(lastCursor.x, lastCursor.y);
  if (editableCardOpen) {
    setTimeout(() => {
      confirmDescription.focus();
      confirmDescription.setSelectionRange(confirmDescription.value.length, confirmDescription.value.length);
    }, 50);
  }
  confirmCard.hidden = false;
});

// --- ask_user question card ------------------------------------------------------
// The agent's mid-task question as a card: click an option, type an answer,
// or hold the hotkey and speak. All three resolve the same pending question
// in main, and the card closes when any of them lands.

const askCard = document.getElementById('ask')!;
const askQuestionEl = document.getElementById('ask-question')!;
const askOptions = document.getElementById('ask-options')!;
const askInput = document.getElementById('ask-input') as HTMLInputElement;
let askOpen = false;

buddy.onAskQuestion((card) => {
  askOpen = Boolean(card);
  if (!card) {
    // Contents stay for the exit animation; the next open replaces them.
    askCard.hidden = true;
    syncMouseMode(lastCursor.x, lastCursor.y);
    return;
  }
  // Buddy speaks the question as the card opens; the bubble would repeat it
  // right next to the card. Same goes for a lingering terminal in this spot.
  hideCaption();
  hideTerminal();
  // The shared markdown renderer, so a question's link or emphasis reads the
  // same as everywhere else Buddy writes.
  renderCaptionMarkdown(askQuestionEl, card.question);
  askOptions.replaceChildren(
    ...card.options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ask-option';
      button.textContent = option;
      button.addEventListener('click', () => buddy.submitAskAnswer(option));
      return button;
    }),
  );
  askInput.value = '';
  askCard.hidden = false;
  syncMouseMode(lastCursor.x, lastCursor.y);
});

askInput.addEventListener('keydown', (event) => {
  event.stopPropagation(); // typing an answer must not trip other key handlers
  if (event.key === 'Enter' && askInput.value.trim()) {
    event.preventDefault();
    buddy.submitAskAnswer(askInput.value.trim());
  }
});

// --- Ask Buddy selection button -----------------------------------------------

buddy.onSelectionShow((pos) => {
  askButton.hidden = false;
  const x = Math.min(pos.x, window.innerWidth - askButton.offsetWidth - 12);
  const y = Math.max(12, pos.y - askButton.offsetHeight - 10);
  askButton.style.transform = `translate3d(${Math.max(12, x)}px, ${y}px, 0) scale(var(--pop, 1))`;
  syncMouseMode(lastCursor.x, lastCursor.y);
});

buddy.onSelectionHide(() => {
  askButton.hidden = true;
  syncMouseMode(lastCursor.x, lastCursor.y);
});

askButton.addEventListener('mousedown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  buddy.askAboutSelection();
});

// --- Call pill -------------------------------------------------------------------
// Who Buddy is calling through Bland and how it's going, at the bottom of the
// screen for as long as the turn lasts: the model stays on the line (waiting
// for the call, then reporting it), so the turn ending is the call ending.
// A failure lingers long enough to read, then goes.

const callPill = document.getElementById('call-pill')!;
const callWho = document.getElementById('call-who')!;
const callState = document.getElementById('call-state')!;
const CALL_FAILED_LINGER_MS = 6_000;
let callHideTimer: ReturnType<typeof setTimeout> | null = null;

buddy.onCallStatus((call) => {
  // A background turn (a text, a job) has no idle state to hide the pill on; it says when.
  if (call.state === 'ended') {
    hideCallPill();
    return;
  }
  if (callHideTimer) clearTimeout(callHideTimer);
  callHideTimer = null;
  const { who, status } = callCardLines(call);
  callWho.textContent = who;
  callState.textContent = status;
  callPill.dataset['state'] = call.state;
  callPill.hidden = false;
  if (call.state === 'failed') callHideTimer = setTimeout(hideCallPill, CALL_FAILED_LINGER_MS);
});

function hideCallPill(): void {
  if (callHideTimer) clearTimeout(callHideTimer);
  callHideTimer = null;
  callPill.hidden = true;
}

// --- Agent HUD -----------------------------------------------------------------

const drivingBorder = document.getElementById('driving-border')!;
const drivingPill = document.getElementById('driving-pill')!;

buddy.onAgentDriving(({ active }) => {
  drivingBorder.hidden = !active;
  drivingPill.hidden = !active;
  agentWatchDriving = active;
  if (!active) {
    // The task is over, so the dot goes back to being the user's: out only
    // while Buddy is doing something for them.
    agentPointing = false;
    caption.classList.remove('thought');
  }
  syncDot();
});

// The agent is about to act here: fly the dot to the target so the user sees
// what's about to be clicked, even when the cursor is on another display —
// this is a safety cue, not decoration.
buddy.onAgentPointer((pos) => {
  agentPointing = true;
  flyTo(pos.x, pos.y);
});
