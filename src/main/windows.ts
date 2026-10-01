// Creates and tracks Buddy's windows: one transparent overlay per display,
// plus the small panel that drops down from the tray icon.
// Also owns the cursor poller that feeds the "cursor buddy" dot.

import { app, BrowserWindow, nativeTheme, screen, systemPreferences, type WebContents } from 'electron';
import { join } from 'path';
import type { DrawCommand, DrawingsPayload } from '../shared/drawing';
import {
  APP_NAME,
  type Annotation,
  type Appearance,
  type CleanMark,
  type HomeShowTarget,
  type MarksMode,
  type OverlayMouseMode,
  type DictationTranscript,
  type PermissionName,
} from '../shared/types';
import { displayGeometry } from './computer/frames';
import type { Rect } from './coords';
import { dictationContents } from './dictation-target';
import { createLogger } from './log';
import { IpcChannels } from '../shared/ipc';

const log = createLogger('windows');

/** Every Buddy window is a sandboxed renderer that reaches main only through the preload. */
const SANDBOXED_PRELOAD = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
} satisfies Electron.WebPreferences;

const overlays = new Map<number, BrowserWindow>(); // display.id -> window
/** The display set the current overlays were built for (see syncOverlays). */
let overlayLayout = '';
/** The display the agent is driving, re-applied to overlays created mid-task. */
let drivingDisplayId: number | null = null;
let panel: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let homeWin: BrowserWindow | null = null;
let recorder: BrowserWindow | null = null;
let quickAsk: BrowserWindow | null = null;
let dragCard: { win: BrowserWindow; list: string } | null = null;

/**
 * Light, dark, or follow macOS. themeSource drives prefers-color-scheme in
 * every renderer, so the CSS tokens switch on their own; the app windows
 * are transparent over vibrancy, so no native background needs repainting.
 */
export function applyAppearance(appearance: Appearance): void {
  if (!nativeTheme) return;
  nativeTheme.themeSource = appearance === 'auto' ? 'system' : appearance;
}

/** Load a renderer page: dev server in dev, built file in production. */
export type RendererPage = 'overlay' | 'panel' | 'settings' | 'recorder' | 'home' | 'quick-ask' | 'browser' | 'boogle';

function loadRenderer(win: BrowserWindow, page: RendererPage, hash?: string): void {
  loadRendererPage(win.webContents, page, hash);
}

/** Load one of Buddy's renderer pages into any web contents (a window's, or a view's). */
export function loadRendererPage(contents: WebContents, page: RendererPage, hash?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void contents.loadURL(`${devUrl}/${page}/index.html${hash ? `#${hash}` : ''}`);
  } else {
    void contents.loadFile(join(__dirname, `../renderer/${page}/index.html`), hash ? { hash } : {});
  }
}

/** The overlays are capturing the mouse for marks; nothing may move them. */
let marking = false;

/**
 * Forwarding mouse moves into the overlay installs a macOS event tap, which
 * needs Accessibility. Without it the tap is created anyway and swallows
 * every click on the display. Trust is fixed for the life of the process
 * (a change relaunches Buddy, see hotkey.ts), so this is read once.
 */
let forwardSafe: boolean | null = null;
function canForwardClicks(): boolean {
  forwardSafe ??= process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false);
  return forwardSafe;
}

/** Let clicks fall through the overlay. `show` and `setBounds` can undo this, so it is re-applied after both. */
function passClicksThrough(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (canForwardClicks()) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(true);
}

/** Show the overlay, unless forwarding is unsafe: then it stays hidden until Buddy relaunches trusted. */
function presentOverlay(win: BrowserWindow): void {
  if (win.isDestroyed() || !canForwardClicks()) return;
  win.showInactive();
  passClicksThrough(win);
}

function createOverlay(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds,
    // A non-activating panel: drawing a mark clicks the overlay, and a click
    // on an ordinary window activates Buddy, which raises the chat window
    // over whatever the user was marking up.
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    transparent: true,
    frame: false,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    // macOS clamps normal windows below the menu bar; without this the
    // overlay sits ~33px too low and every annotation lands off-target.
    enableLargerThanScreen: true,
    webPreferences: SANDBOXED_PRELOAD,
  });
  // 'screen-saver' keeps the overlay above fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver');
  // Clicks pass through. Forwarding needs Accessibility; without it the event
  // tap eats every click on the display and the Mac has to be force-restarted.
  passClicksThrough(win);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Exclude our own overlay from the screenshots we take later.
  win.setContentProtection(true);
  loadRenderer(win, 'overlay');
  win.once('ready-to-show', () => {
    presentOverlay(win);
    // A display change mid-task recreates every overlay, so a fresh window has
    // to be told the agent is still driving or the HUD vanishes for the rest of it.
    send(win, IpcChannels.agentDriving, { active: display.id === drivingDisplayId });
    // Same story for the home window's focus: a fresh overlay must not bring
    // the caption bubble back while the user is reading the reply in the chat.
    send(win, IpcChannels.chatFocusChanged, homeFocused);
    // macOS can refuse to place a window over the menu bar at creation time,
    // which would shift the overlay (and every annotation) down. Re-assert
    // the exact display bounds after showing, and complain if it didn't take.
    win.setBounds(display.bounds);
    passClicksThrough(win);
    const actual = win.getBounds();
    if (JSON.stringify(actual) !== JSON.stringify(display.bounds)) {
      log.warn(
        `overlay bounds mismatch on display ${display.id}: wanted ${JSON.stringify(display.bounds)}, got ${JSON.stringify(actual)}`,
      );
    }
  });
  // macOS moves the overlay again later: when the menu bar hides or comes
  // back (a full-screen app, auto-hide) it grows the window up over the
  // bar's height. Snap back the moment it happens, not on the next poll,
  // so no drawing lands 32px off in between.
  const snap = (): void => {
    if (marking || win.isDestroyed()) return;
    const actual = win.getBounds();
    if (sameBounds(actual, display.bounds)) return;
    log.info(`overlay on display ${display.id} moved to ${JSON.stringify(actual)}; snapping back`);
    win.setBounds(display.bounds);
    passClicksThrough(win);
    redrawOverlay(display.id);
  };
  win.on('move', snap);
  win.on('resize', snap);
  return win;
}

function sameBounds(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Recreate all overlays to match the current display set. Called at startup
 * and on every screen change; recreating from scratch is simpler and safer
 * than patching bounds on live windows.
 *
 * It does nothing when the displays have not actually moved, because macOS
 * reports a metrics change for things that do not concern an overlay — the
 * work area shifts whenever the menu bar hides, the Dock resizes or an app
 * goes full screen, and those arrive in bursts. Recreating on each one threw
 * away live annotations and the driving HUD mid-task.
 */
export function syncOverlays(): void {
  const displays = screen.getAllDisplays();
  const layout = displays
    .map((display) => `${display.id}@${displayGeometry(display.bounds, display.scaleFactor)}`)
    .join('|');
  if (layout === overlayLayout && overlays.size === displays.length) return;

  for (const win of overlays.values()) win.destroy();
  overlays.clear();
  lastDrawn.clear();
  for (const display of displays) {
    overlays.set(display.id, createOverlay(display));
  }
  overlayLayout = layout;
  log.info(`created ${overlays.size} overlay window(s)`);
}

/** Send to a window, ignoring windows already destroyed (e.g. during quit). */
function send(win: BrowserWindow | undefined, channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

/**
 * One display's overlay, and how far macOS has parked it off the display.
 * Coordinates are computed against display bounds, but the window can sit
 * slightly off them (pushed down by the menu bar), so everything sent to
 * the overlay is shifted by (dx, dy) to land where it was aimed.
 */
function overlayFor(displayId: number): { win: BrowserWindow; dx: number; dy: number } | null {
  const win = overlays.get(displayId);
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!win || win.isDestroyed() || !display) return null;
  const bounds = win.getBounds();
  return { win, dx: display.bounds.x - bounds.x, dy: display.bounds.y - bounds.y };
}

/**
 * What each display's overlay was last told to draw, in display space. The
 * offset correction is baked in when it is sent, so when the window is put
 * back where it belongs, the drawing has to be sent again for the new
 * position; otherwise it stays shifted by however far the window had moved.
 * (Annotations fade on their own in the overlay, so they are not replayed.)
 */
const lastDrawn = new Map<number, { drawings?: DrawCommand[]; marks?: CleanMark[] }>();

function remember(displayId: number, patch: { drawings?: DrawCommand[]; marks?: CleanMark[] }): void {
  lastDrawn.set(displayId, { ...lastDrawn.get(displayId), ...patch });
}

/** The overlay moved (or was moved back): redraw what it shows, for where it is now. */
function redrawOverlay(displayId: number): void {
  const drawn = lastDrawn.get(displayId);
  if (drawn?.drawings) sendDrawings(displayId, drawn.drawings);
  if (drawn?.marks) sendMarksToDisplay(displayId, drawn.marks);
}

/** The user's marks came down; a later redraw must not bring them back. */
export function forgetOverlayMarks(): void {
  for (const drawn of lastDrawn.values()) delete drawn.marks;
}

/** Draw these annotations on one display, corrected for where its overlay really is. */
export function sendAnnotationsToDisplay(displayId: number, annotations: Annotation[]): void {
  const overlay = overlayFor(displayId);
  if (!overlay) return;
  if (annotations.length > 0) annotationsShown = true;
  const { win, dx, dy } = overlay;
  const shifted = dx === 0 && dy === 0 ? annotations : annotations.map((a) => shiftAnnotation(a, dx, dy));
  send(win, IpcChannels.annotationsDraw, shifted);
}

function shiftAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.kind === 'arrow') {
    return {
      ...annotation,
      fromX: annotation.fromX + dx,
      fromY: annotation.fromY + dy,
      toX: annotation.toX + dx,
      toY: annotation.toY + dy,
    };
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
}

/**
 * Replace everything one display is drawing. The main process owns the full
 * picture, so it sends the whole list rather than a diff — the overlay never
 * has to reason about what it already had.
 */
export function sendDrawings(displayId: number, commands: DrawCommand[]): void {
  remember(displayId, { drawings: commands });
  const overlay = overlayFor(displayId);
  if (!overlay) return;
  // The parked-window offset travels as one number pair for the overlay to
  // apply as a transform, rather than being baked into every coordinate —
  // path syntax is not something to rewrite with a regex.
  send(overlay.win, IpcChannels.drawingsSet, {
    commands,
    offset: { x: overlay.dx, y: overlay.dy },
  } satisfies DrawingsPayload);
}

export function clearAllAnnotations(): void {
  annotationsShown = false;
  for (const win of overlays.values()) {
    send(win, IpcChannels.annotationsClear);
  }
}

// The overlays fade annotations on their own after a while, so this can be
// stale-true — which only costs one redundant clear. It exists so a dismiss
// on every scroll tick doesn't message every overlay when nothing is up.
let annotationsShown = false;

/** Might any annotation still be on screen? */
export function hasAnnotations(): boolean {
  return annotationsShown;
}

/**
 * Plan cards stay click-through until the cursor is over the card. The overlay
 * then asks main to capture the mouse (see setOverlayMouse) so the textarea
 * can be clicked without swallowing clicks on the rest of the screen.
 */
export function setOverlayConfirmInteractive(on: boolean): void {
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue;
    win.setFocusable(on);
    passClicksThrough(win);
  }
}

/** Called from an overlay as the pointer enters/leaves its interactive parts. */
export function setOverlayMouse(sender: Electron.WebContents, mode: OverlayMouseMode): void {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return;
  if (mode === 'through' || !canForwardClicks()) {
    passClicksThrough(win);
    return;
  }
  win.setIgnoreMouseEvents(false);
  // 'click' stops here on purpose: hovering a source link must not pull
  // keyboard focus out of whatever the user is typing in.
  //
  // TODO(verify): this assumes macOS still delivers clicks to an overlay
  // created with focusable: false. If a source chip turns out not to respond,
  // add win.setFocusable(true) here — clicks land at the cost of the overlay
  // taking focus when clicked — or make the overlays panel-type windows.
  if (mode === 'focus') {
    win.setFocusable(true);
    win.focus();
  }
}

/** Fly the buddy dot to a global DIP point (the agent's next click target). */
export function flyBuddyTo(x: number, y: number): void {
  sendToOverlayAt(x, y, IpcChannels.agentPointer);
}

/** Send a global DIP point to the overlay under it, in that overlay's own coordinates. */
function sendToOverlayAt(x: number, y: number, channel: string): void {
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const win = overlays.get(display.id);
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  send(win, channel, { x: x - bounds.x, y: y - bounds.y });
}

/** Show the "Buddy is driving" border on one display (null hides everywhere). */
export function setDrivingHud(displayId: number | null): void {
  drivingDisplayId = displayId;
  for (const [id, win] of overlays) {
    send(win, IpcChannels.agentDriving, { active: id === displayId });
  }
}

// --- User marks (point and talk) ------------------------------------------------

/**
 * While the talk chord is held, the overlays capture the mouse so the user
 * can draw marks: clicks and drags land on the overlay, never on the app
 * underneath. Keyboard focus is untouched — the overlays stay non-focusable,
 * the same arrangement that already delivers clicks to the source chips.
 * The renderer swaps in a crosshair cursor when the mode message arrives.
 */
export function setOverlayMarking(active: boolean, color: string): void {
  // Capturing the fullscreen overlay without Accessibility locks the display.
  if (active && !canForwardClicks()) active = false;
  // Snap any parked overlay back to its display BEFORE it takes the mouse:
  // a window that moves mid-stroke shifts the ink under the user's hand.
  // (macOS parks fresh overlays a few pixels off at boot and tends to apply
  // the correction around the moment the window first becomes interactive —
  // which used to be the user's first mark.)
  if (active) ensureOverlayBounds();
  marking = active;
  // A drift the stroke held off is undone the moment the mouse is released.
  if (!active) ensureOverlayBounds();
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue;
    if (active) win.setIgnoreMouseEvents(false);
    else passClicksThrough(win);
    send(win, IpcChannels.marksMode, { active, color } satisfies MarksMode);
  }
}

/** Which display an overlay's webContents belongs to (for stroke events). */
export function overlayDisplayId(sender: Electron.WebContents): number | null {
  for (const [id, win] of overlays) {
    if (!win.isDestroyed() && win.webContents === sender) return id;
  }
  return null;
}

/** Replace everything one display's overlay shows as user marks. */
export function sendMarksToDisplay(displayId: number, marks: CleanMark[]): void {
  remember(displayId, { marks });
  const overlay = overlayFor(displayId);
  if (!overlay) return;
  const { win, dx, dy } = overlay;
  const shifted =
    dx === 0 && dy === 0
      ? marks
      : marks.map((mark) => ({
          ...mark,
          points: mark.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
          bounds: { ...mark.bounds, x: mark.bounds.x + dx, y: mark.bounds.y + dy },
        }));
  send(win, IpcChannels.marksSet, shifted);
}

/** Show the Ask Buddy button on the display that contains this global DIP point. */
export function showSelectionButton(x: number, y: number): void {
  hideSelectionButton();
  sendToOverlayAt(x, y, IpcChannels.selectionShow);
}

export function hideSelectionButton(): void {
  for (const win of overlays.values()) {
    send(win, IpcChannels.selectionHide);
  }
}

/** Send a message to every Buddy window (overlays + panel). */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    send(win, channel, ...args);
  }
}

// --- The Type to Buddy box ------------------------------------------------
// A small focusable window summoned next to the buddy dot (see
// src/main/quick-ask.ts for its lifecycle). It parks where it opened while
// the dot keeps trailing the cursor: a field glued to the pointer would sit
// under every click. The mouse stays with the user's apps, so highlighting
// text still works; a mark drag is the talk chord, not every drag.

/**
 * The shell, border-box. Row is 12 + 22 + 12, footer is a 28px send over
 * 10px, plus the 1px border. Keep in step with quick-ask.css.
 * The window is larger by QUICK_ASK_PAD so the corner stroke isn't clipped.
 */
const QUICK_ASK_FIELD = { width: 320, height: 12 + 22 + 12 + 28 + 10 + 2 };
const QUICK_ASK_PAD = 2;
const QUICK_ASK_WIDTH = QUICK_ASK_FIELD.width + QUICK_ASK_PAD * 2;
const QUICK_ASK_HEIGHT = QUICK_ASK_FIELD.height + QUICK_ASK_PAD * 2;
/** Right of the dot, which itself trails the cursor by ~20px. */
const QUICK_ASK_OFFSET = { x: 44, y: 10 };

function createQuickAskWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: QUICK_ASK_WIDTH,
    height: QUICK_ASK_HEIGHT,
    transparent: true,
    frame: false,
    hasShadow: false,
    // The system corner mask on a frameless window slices a CSS border at the
    // curves. The field draws its own radius; the window stays rectangular.
    roundedCorners: false,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: SANDBOXED_PRELOAD,
  });
  // Same stacking as the overlays, so the field sits above fullscreen apps —
  // and stays out of the screenshots Buddy takes of what's under it.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);
  loadRenderer(win, 'quick-ask');
  win.on('closed', () => {
    quickAsk = null;
  });
  return win;
}

/** Place the box beside the dot (clamped to the display), show it, focus it.
 * `chipLabel` is the highlight chip to open with, carried in the show message
 * because a freshly created window would miss a separately sent one. */
export function showQuickAskWindow(chipLabel: string | null = null): void {
  if (!quickAsk || quickAsk.isDestroyed()) quickAsk = createQuickAskWindow();
  const win = quickAsk;
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const x = Math.round(
    Math.max(area.x + 12, Math.min(point.x + QUICK_ASK_OFFSET.x, area.x + area.width - QUICK_ASK_WIDTH - 12)),
  );
  const y = Math.round(
    Math.max(area.y + 12, Math.min(point.y + QUICK_ASK_OFFSET.y, area.y + area.height - QUICK_ASK_HEIGHT - 12)),
  );
  win.setBounds({ x, y, width: QUICK_ASK_WIDTH, height: QUICK_ASK_HEIGHT });
  const reveal = (): void => {
    send(win, IpcChannels.quickAskShow, chipLabel);
    win.show();
    // Above the fullscreen overlays, so the field can be clicked.
    win.moveTop();
    win.focus();
  };
  if (win.webContents.isLoading()) win.once('ready-to-show', reveal);
  else reveal();
  // Every window hears the open: the overlays keep the dot out of the box's
  // spot, and the recorder plays the listening cue.
  broadcast(IpcChannels.quickAskOpenChanged, true);
}

export function hideQuickAskWindow(): void {
  if (quickAsk && !quickAsk.isDestroyed()) quickAsk.hide();
  broadcast(IpcChannels.quickAskOpenChanged, false);
}

/** The overlays have the pointer for a mark drag; that drag is not a text selection. */
export function isOverlayMarking(): boolean {
  return marking;
}

/** The field has the keyboard, so keys belong to the draft and not the highlighted app. */
export function isQuickAskFocused(): boolean {
  return Boolean(quickAsk && !quickAsk.isDestroyed() && quickAsk.isFocused());
}

/** Is the Type to Buddy box on screen? Selections land in it only while it is. */
export function isQuickAskVisible(): boolean {
  return Boolean(quickAsk && !quickAsk.isDestroyed() && quickAsk.isVisible());
}

/** A drag that starts and ends inside the field is editing the draft, not a highlight. */
export function quickAskContains(x: number, y: number): boolean {
  if (!isQuickAskVisible() || !quickAsk) return false;
  const bounds = quickAsk.getBounds();
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}

/** The highlight chip in the field: a short label, or null to take it away. */
export function sendQuickAskHighlight(label: string | null): void {
  send(quickAsk ?? undefined, IpcChannels.quickAskHighlight, label);
}

/** Dictated speech on its way into the Type to Buddy field. */
export function sendQuickAskTranscript(event: DictationTranscript): void {
  send(quickAsk ?? undefined, IpcChannels.quickAskTranscript, event);
}

/** Dictated speech on its way into the field that asked for it. */
export function sendFieldDictation(event: DictationTranscript): void {
  const contents = dictationContents();
  if (contents) contents.send(IpcChannels.dictation, event);
  else send(settingsWin ?? undefined, IpcChannels.dictation, event);
}

/** After a mark drag, the fullscreen overlay can sit above the field. */
export function raiseQuickAskWindow(): void {
  if (!quickAsk || quickAsk.isDestroyed() || !quickAsk.isVisible()) return;
  quickAsk.moveTop();
  quickAsk.focus();
}

// --- Cursor buddy poller -----------------------------------------------

let lastCursorDisplayId: number | null = null;
let cursorPoller: NodeJS.Timeout | null = null;

/**
 * Poll the cursor at ~60fps and forward its position (in overlay-local DIP
 * coordinates) only to the overlay of the display the cursor is on. The
 * renderer does the easing, so raw positions are fine here.
 * `onSample` sees every raw global position (the shake detector's feed).
 */
export function startCursorPoller(
  onSample?: (sample: { x: number; y: number; time: number }) => void,
): void {
  let ticks = 0;
  cursorPoller = setInterval(() => {
    // Every ~2s, push any drifted overlay back to its display bounds.
    if (++ticks % 120 === 0) ensureOverlayBounds();

    const point = screen.getCursorScreenPoint();
    onSample?.({ x: point.x, y: point.y, time: Date.now() });
    const display = screen.getDisplayNearestPoint(point);
    const win = overlays.get(display.id);
    if (lastCursorDisplayId !== null && lastCursorDisplayId !== display.id) {
      send(overlays.get(lastCursorDisplayId), IpcChannels.cursorHidden);
    }
    lastCursorDisplayId = display.id;
    if (!win || win.isDestroyed()) return;
    // Position relative to where the window actually is (see
    // sendAnnotationsToDisplay for why that can differ from display bounds).
    const winBounds = win.getBounds();
    send(win, IpcChannels.cursorMoved, {
      x: point.x - winBounds.x,
      y: point.y - winBounds.y,
    });
  }, 16);
}

/**
 * A stroke clicks the overlay, and macOS activates Buddy for it even as a
 * panel, which raises the chat window over what the user is drawing on. The
 * marks module registers how to hand focus back to the app that was in front.
 */
let onFocusTakenDuringMark: (() => boolean) | null = null;
/** `restore` returns false when there is nothing to hand back (the chat was already in front). */
export function handFocusBackDuringMarks(restore: (() => boolean) | null): void {
  onFocusTakenDuringMark = restore;
}

/** How many drifts each display has logged; the poll says so a few times, then only counts. */
const driftsLogged = new Map<number, number>();
const DRIFT_LOG_LIMIT = 3;

/**
 * The backstop behind the overlays' own move/resize snap: undo any drift the
 * events missed (a mark in progress held it off). A display that keeps
 * drifting is macOS's doing and not news; it is logged a few times, then
 * quietly corrected.
 */
function ensureOverlayBounds(): void {
  // Never reposition while a mark may be mid-stroke; the correction waits
  // for the next tick after the chord comes up.
  if (marking) return;
  for (const display of screen.getAllDisplays()) {
    const win = overlays.get(display.id);
    if (!win || win.isDestroyed()) continue;
    const actual = win.getBounds();
    if (sameBounds(actual, display.bounds)) continue;
    const logged = driftsLogged.get(display.id) ?? 0;
    if (logged < DRIFT_LOG_LIMIT) {
      driftsLogged.set(display.id, logged + 1);
      log.warn(
        `overlay drifted on display ${display.id}: at ${JSON.stringify(actual)}, expected ${JSON.stringify(display.bounds)}; re-asserting${
          logged + 1 === DRIFT_LOG_LIMIT ? ' (further drifts on this display are corrected silently)' : ''
        }`,
      );
    }
    win.setBounds(display.bounds);
    passClicksThrough(win);
    redrawOverlay(display.id);
  }
}

/** Stop polling before quit so the timer can't touch destroyed windows. */
export function stopCursorPoller(): void {
  if (cursorPoller) clearInterval(cursorPoller);
  cursorPoller = null;
}

// --- Panel --------------------------------------------------------------

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 360;

/**
 * The settings and home windows: the desktop blurs through. macOS composites
 * the vibrancy and the renderer paints its canvas at partial opacity over it
 * (body.translucent in ui/styles.css). The sidebar owns the top-left corner,
 * like native macOS Settings.
 */
const APP_WINDOW = {
  minWidth: 760,
  minHeight: 520,
  resizable: true,
  fullscreenable: false,
  backgroundColor: '#00000000',
  vibrancy: 'under-window',
  visualEffectState: 'active',
  titleBarStyle: 'hiddenInset',
  trafficLightPosition: { x: 14, y: 17 },
  webPreferences: SANDBOXED_PRELOAD,
} satisfies Electron.BrowserWindowConstructorOptions;

const HOME_SIZE = { width: 1240, height: 840 };
/** Settings opens taller than home so long pages fit. */
const SETTINGS_SIZE = { width: 1240, height: 960 };
/** Room left around an app window that would otherwise fill the screen. */
const SCREEN_MARGIN = 40;

/**
 * Centered on the display under the cursor, shrunk to fit its work area.
 * Computed here because macOS's own center() sits windows above the middle.
 */
function centeredBounds({ width, height }: { width: number; height: number }): Electron.Rectangle {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = Math.min(width, workArea.width - SCREEN_MARGIN * 2);
  const h = Math.min(height, workArea.height - SCREEN_MARGIN * 2);
  return {
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + (workArea.height - h) / 2),
    width: w,
    height: h,
  };
}

function createPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: SANDBOXED_PRELOAD,
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true);
  win.on('blur', () => win.hide());
  loadRenderer(win, 'panel');
  return win;
}

/** Toggle the panel, positioned centered under the tray icon. */
export function togglePanel(trayBounds: Electron.Rectangle): void {
  panel ??= createPanel();
  if (panel.isVisible()) {
    panel.hide();
    return;
  }
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - PANEL_WIDTH / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  panel.setPosition(x, y);
  panel.show();
}

// --- Recorder window --------------------------------------------------------

/**
 * A hidden window that owns the microphone (and later plays TTS audio).
 * Renderer APIs like getUserMedia/MediaRecorder only exist in a window, and
 * keeping audio out of the visible windows lets them stay sandboxed and dumb.
 */
export function createRecorderWindow(): void {
  recorder = new BrowserWindow({
    show: false,
    webPreferences: {
      ...SANDBOXED_PRELOAD,
      // Hidden windows get their timers throttled by default, which would
      // make the mic level meter stutter.
      backgroundThrottling: false,
    },
  });
  loadRenderer(recorder, 'recorder');
}

export function sendToRecorder(channel: string, ...args: unknown[]): void {
  send(recorder ?? undefined, channel, ...args);
}

// --- Drag card ---------------------------------------------------------------

const DRAG_CARD_WIDTH = 480;
/** The card sizes to its content (DragCard.tsx): one line, or a line plus the drag handle. */
const DRAG_CARD_HEIGHT: Record<PermissionName, number> = { microphone: 68, screen: 120, accessibility: 120 };

/**
 * The floating card the user drags Buddy's icon out of during the walk's
 * permissions step, into the System Settings list named by `list`. It sits
 * low on the primary display, where System Settings opens, above every
 * window; the user can drag the card itself closer. One card at a time: a
 * new list replaces it.
 */
export function showDragCard(list: PermissionName): void {
  if (dragCard && !dragCard.win.isDestroyed()) {
    if (dragCard.list === list) {
      dragCard.win.showInactive();
      dragCard.win.setAlwaysOnTop(true, 'pop-up-menu');
      return;
    }
    dragCard.win.close();
  }
  const { workArea } = screen.getPrimaryDisplay();
  const height = DRAG_CARD_HEIGHT[list];
  const win = new BrowserWindow({
    width: DRAG_CARD_WIDTH,
    height,
    x: Math.round(workArea.x + (workArea.width - DRAG_CARD_WIDTH) / 2),
    y: workArea.y + workArea.height - height - 32,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: SANDBOXED_PRELOAD,
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('closed', () => {
    if (dragCard?.win === win) dragCard = null;
  });
  dragCard = { win, list };
  loadRenderer(win, 'home', `drag-card-${list}`);
  // Above System Settings. setVisibleOnAllWorkspaces resets the level, and a
  // transparent window sometimes never fires ready-to-show, so both paths
  // raise it — and again once the pane has taken the front.
  const reveal = (): void => {
    if (win.isDestroyed()) return;
    win.showInactive();
    win.setAlwaysOnTop(true, 'pop-up-menu');
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
}

export function hideDragCard(): void {
  if (dragCard && !dragCard.win.isDestroyed()) dragCard.win.close();
  dragCard = null;
}

// --- Settings window ------------------------------------------------------

/** Open settings, optionally on a named sidebar page (e.g. 'permissions'). */
export function openSettingsWindow(page?: string): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (page) send(settingsWin, IpcChannels.settingsShowPage, page);
    settingsWin.show();
    bringToFront(settingsWin);
    return;
  }
  settingsWin = new BrowserWindow({
    ...APP_WINDOW,
    ...centeredBounds(SETTINGS_SIZE),
    title: `${APP_NAME} Settings`,
    show: false,
  });
  settingsWin.on('closed', () => (settingsWin = null));
  loadRenderer(settingsWin, 'settings', page);
  settingsWin.once('ready-to-show', () => settingsWin?.show());
}

/**
 * In front of every other app's windows, with the menu bar. A background
 * (accessory) app's focus() alone leaves an already-open window behind the
 * app the user was in, so a Dock or menu-bar click seems to do nothing.
 */
function bringToFront(win: BrowserWindow): void {
  if (process.platform === 'darwin') app.focus({ steal: true });
  win.focus();
}

/** Dismiss settings (e.g. after sign-out so home can show the sign-in scene). */
export function closeSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
}

// --- Home window ------------------------------------------------------------

/** While true, the reply is being read in the chat; bubbles stand down. */
let homeFocused = false;
/** The user asked for the chat. A warm window stays hidden until they do. */
let homeWanted = false;
/** The renderer has painted the shell, so showing it is not a blank frame. */
let homePainted = false;
/** A landing target that arrived before the shell could hear it. */
let homeTarget: HomeShowTarget | null = null;
let quitting = false;

function setHomeFocused(focused: boolean): void {
  if (homeFocused === focused) return;
  homeFocused = focused;
  broadcast(IpcChannels.chatFocusChanged, focused);
}

/** Show the chat only once its UI is painted and someone asked for it. */
function revealHome(): void {
  if (!homeWin || homeWin.isDestroyed() || !homePainted || !homeWanted) return;
  const revealing = !homeWin.isVisible();
  if (revealing) {
    const [width, height] = homeWin.getSize();
    homeWin.setBounds(centeredBounds({ width, height }));
    homeWin.show();
  }
  bringToFront(homeWin);
  // A real hide and show, not another app covering the window. Sign-in uses
  // this to replay its shot; opening the browser must not.
  if (revealing) send(homeWin, IpcChannels.homeReveal);
}

/** The chat shell has painted. */
export function markHomePainted(): void {
  homePainted = true;
  if (homeTarget && homeWin && !homeWin.isDestroyed()) {
    send(homeWin, IpcChannels.homeShow, homeTarget);
    homeTarget = null;
  }
  revealHome();
}

/**
 * Build the chat window hidden and let it paint, so the first open is
 * instant. Once at startup; closing it hides it from then on, until quit.
 */
export function warmHomeWindow(): void {
  app.once('before-quit', () => {
    quitting = true;
  });
  ensureHomeWindow(null);
}

/** The chat home: conversations, transcripts, and a typed composer. */
export function openHomeWindow(): void {
  openHomeWindowAt(null);
}

/** Where the chat window sits, while it is showing. */
export function homeWindowBounds(): Rect | null {
  return homeWin && !homeWin.isDestroyed() && homeWin.isVisible() ? homeWin.getBounds() : null;
}

/** Put the chat away without closing it (the tour talks from the dot first). */
export function hideHomeWindow(): void {
  homeWanted = false;
  if (homeWin && !homeWin.isDestroyed()) homeWin.hide();
}

/** The boot hash a fresh home window reads its landing target from. */
function homeShowHash(target: HomeShowTarget): string {
  return target.conversationId ? `conversation-${target.conversationId}` : '';
}

function ensureHomeWindow(target: HomeShowTarget | null): void {
  if (homeWin && !homeWin.isDestroyed()) return;
  homePainted = false;
  homeWin = new BrowserWindow({
    ...APP_WINDOW,
    ...centeredBounds(HOME_SIZE),
    title: APP_NAME,
    show: false,
  });
  homeWin.on('focus', () => {
    if (marking && onFocusTakenDuringMark?.()) return;
    setHomeFocused(true);
  });
  homeWin.on('blur', () => setHomeFocused(false));
  // Closing puts it away. The painted window stays, so the next tray click
  // does not rebuild a blank one. Quit is the path that actually closes it.
  homeWin.on('close', (event) => {
    if (quitting || !homeWin || homeWin.isDestroyed()) return;
    event.preventDefault();
    hideHomeWindow();
  });
  homeWin.on('closed', () => {
    homeWin = null;
    homePainted = false;
    setHomeFocused(false);
  });
  loadRenderer(homeWin, 'home', target ? homeShowHash(target) : undefined);
}

/**
 * The same, landing on a page or conversation (notification clicks). A live
 * window gets the target over IPC; a fresh one boots with it in the hash,
 * because a message sent while the renderer is still loading is lost.
 */
export function openHomeWindowAt(target: HomeShowTarget | null): void {
  const fresh = !homeWin || homeWin.isDestroyed();
  homeWanted = true;
  ensureHomeWindow(target);
  if (target && !fresh) {
    if (homePainted && homeWin) send(homeWin, IpcChannels.homeShow, target);
    else homeTarget = target;
  }
  revealHome();
}
