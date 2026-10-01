// The turn's user marks: what was drawn while the talk chord was held.
//
// This is the stateful coordinator. While the chord is down the overlays
// capture the mouse and report strokes here; each stroke is classified for the
// model, kept for the turn, and sent back to its overlay to stay as drawn.
// The session takes the whole set when it builds the request. The ink stays
// on screen through the answer — it is already the pointer, so Buddy does not
// redraw it — and comes down on a click, a scroll, Escape, or the next ask.
// The data lives on (for `{ mark: n }` drawing anchors) until that clear.

import { screen, type WebContents } from 'electron';
import { type CleanMark, type MarkStrokePayload, type MarksTurnDebug } from '../../shared/types';
import { captureDisplayPng, captureDisplayShot, mintGuideFrame, type ScreenshotMeta } from '../capture';
import { SCREENSHOT_BOX } from '../computer/provider';
import type { Rect } from '../coords';
import { createLogger } from '../log';
import { getSettings } from '../settings';
import { activateApp, frontmostApp, isSelfApp, type FrontmostApp } from '../reader/frontmost';
import {
  broadcast,
  forgetOverlayMarks,
  handFocusBackDuringMarks,
  overlayDisplayId,
  sendMarksToDisplay,
  setOverlayMarking,
} from '../windows';
import { classifyStroke, type ClassifiedStroke } from './classify';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('marks');

/** A stroke can't reasonably need more samples than this. */
const MAX_POINTS = 4_000;

export interface TurnMark {
  number: number;
  displayId: number;
  classified: ClassifiedStroke;
  /** The stroke as the user drew it, in display space: what stays on screen. */
  drawn: Array<{ x: number; y: number }>;
  /** When the stroke started/ended, ms relative to the recording start. */
  startMs: number;
  endMs: number;
}

/** The screenshots taken the moment the first mark on a display started. */
export interface MarkShot {
  displayId: number;
  /** Model-size JPEG, so the image matches what the user was looking at. */
  shot: ScreenshotMeta;
  frameId: string;
  /**
   * Full native resolution for close-up crops. Captured at chord release,
   * not at stroke start: a native capture (and its PNG encode) stalls the
   * main process long enough to freeze the drag mid-stroke.
   */
  native: Buffer | null;
}

export interface MarksTurn {
  marks: TurnMark[];
  shots: MarkShot[];
}

let capturing = false;
let recordingStartAt = 0;
let captureEndedAt = 0;
let marks: TurnMark[] = [];
/** Set once a turn has taken the marks: they stay visible (and anchorable),
 * but no later recording may attach them to itself. */
let consumed = false;
const shots = new Map<number, Promise<MarkShot | null>>();
let lastDebug: MarksTurnDebug | null = null;

/**
 * A stroke that ends at chord release reaches main *after* the chord-up
 * already ended the capture — the overlay's IPC always loses that race — so
 * strokes stay welcome for a moment after the hold ends.
 */
const STROKE_GRACE_MS = 1_500;

function acceptingStrokes(): boolean {
  return capturing || (!consumed && Date.now() - captureEndedAt < STROKE_GRACE_MS);
}

export function isCapturing(): boolean {
  return capturing;
}

export function hasMarks(): boolean {
  return marks.length > 0;
}

/** Marks exist and no turn has taken them yet (cheap, synchronous). */
export function pendingMarks(): boolean {
  return !consumed && marks.length > 0;
}

/** The talk chord went down: last turn's marks go, the overlays take the mouse.
 * Eyes off still allows the ink. The turn just won't include a screenshot,
 * and the reply says the marks can't be seen until that setting is on. */
export function beginCapture(): void {
  const settings = getSettings();
  if (!settings.marksEnabled) return;
  clearMarks();
  capturing = true;
  recordingStartAt = Date.now();
  guardFrontApp();
  setOverlayMarking(true, settings.colorUserMarks);
}

/**
 * The app the user is drawing over. A stroke's click activates Buddy (the
 * overlay is a window of Buddy's), which raises the chat window on top of
 * it; the moment that happens, this app is brought back in front. Read
 * when the chord goes down, well before the first stroke lands.
 */
function guardFrontApp(): void {
  let front: FrontmostApp | null = null;
  void frontmostApp().then((app) => {
    front = app && !isSelfApp(app) ? app : null;
  });
  handFocusBackDuringMarks(() => {
    if (!front) return false;
    void activateApp(front).catch(() => undefined);
    return true;
  });
}

/**
 * The Type to Buddy box opened: marks drawn for it are kept, but the mouse
 * stays with the user's apps so they can still highlight text and click the
 * field. The overlay only takes the pointer while the talk chord is held
 * (see setMarkPointer).
 */
export function prepareQuickAskMarks(): void {
  const settings = getSettings();
  if (!settings.marksEnabled) return;
  clearMarks();
  capturing = true;
  recordingStartAt = Date.now();
}

/** Hand the pointer to the overlays for a mark drag, or give it back. */
export function setMarkPointer(active: boolean): void {
  if (active && !capturing) return;
  setOverlayMarking(active, getSettings().colorUserMarks);
}

/** The chord came up (or cancelled): the mouse goes back to the user's apps. */
export function endCapture(): void {
  if (!capturing) return;
  capturing = false;
  captureEndedAt = Date.now();
  setOverlayMarking(false, getSettings().colorUserMarks);
  handFocusBackDuringMarks(null);
  // Now that nothing is being drawn, take the heavy native-resolution
  // captures the close-up crops need. During the hold they would stall the
  // main process — and with it the drag events feeding the live stroke.
  for (const [displayId, pending] of shots) {
    shots.set(
      displayId,
      pending.then(async (shot) => {
        if (!shot || shot.native) return shot;
        try {
          return { ...shot, native: await captureDisplayPng(displayId) };
        } catch (error) {
          log.warn(
            `native mark screenshot failed on display ${displayId}: ${errorMessage(error)}`,
          );
          return shot; // the annotated screenshot still works; crops just won't
        }
      }),
    );
  }
}

/**
 * Take the marks off every screen without forgetting them. The moment they
 * were pointing at is over, but `{ mark: n }` anchors must still resolve
 * until clearMarks ends the turn for real.
 */
export function hideMarks(): void {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = null;
  forgetOverlayMarks();
  broadcast(IpcChannels.marksClear);
}

/** How long the ink stays up for reading once the answer has finished. */
const MARK_LINGER_MS = 8_000;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The answer just ended (the state came back to idle). The marks stayed up
 * through it as the pointer; give them a reading beat, then take them down.
 * Clicks, scrolls, Escape and the next ask still take them down sooner.
 */
export function lingerThenHideMarks(): void {
  if (!consumed || marks.length === 0) return;
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = setTimeout(hideMarks, MARK_LINGER_MS);
}

/** Take every mark down, everywhere. */
export function clearMarks(): void {
  if (lingerTimer) clearTimeout(lingerTimer);
  lingerTimer = null;
  marks = [];
  consumed = false;
  captureEndedAt = 0; // no trailing strokes for a turn that no longer exists
  shots.clear();
  forgetOverlayMarks();
  broadcast(IpcChannels.marksClear);
}

/** Escape while the chord is held clears the turn's marks. True = handled. */
export function escapeClearsMarks(): boolean {
  if (!capturing || marks.length === 0) return false;
  clearMarks();
  return true;
}

/**
 * A stroke just started on some overlay: screenshot that display now, so the
 * image the model gets matches what the user was looking at when they drew.
 * Only the first stroke per display pays for a capture.
 */
export function onStrokeBegin(sender: WebContents): void {
  if (!capturing) return;
  // Eyes off: the stroke stays on the glass, but a capture would share the
  // screen the setting just refused.
  if (!getSettings().screenAwareness) return;
  const displayId = overlayDisplayId(sender);
  if (displayId === null || shots.has(displayId)) return;
  shots.set(displayId, captureMarkShot(displayId));
}

async function captureMarkShot(displayId: number): Promise<MarkShot | null> {
  try {
    const shot = await captureDisplayShot(displayId, SCREENSHOT_BOX);
    return { displayId, shot, frameId: mintGuideFrame(shot), native: null };
  } catch (error) {
    log.warn(
      `mark screenshot failed on display ${displayId}: ${errorMessage(error)}`,
    );
    return null;
  }
}

/** A finished stroke from an overlay: classify it and show the clean version. */
export function onStroke(sender: WebContents, payload: MarkStrokePayload): void {
  if (!acceptingStrokes()) return;
  const displayId = overlayDisplayId(sender);
  if (displayId === null) return;
  // Strokes arrive in global screen coordinates (immune to the overlay
  // window moving mid-stroke); everything downstream — classify, markBox,
  // the annotated screenshots — works in display space, so convert here
  // against the display's authoritative bounds, never the window's.
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!display) return;
  const points = sanitizePoints(payload).map((point) => ({
    ...point,
    x: point.x - display.bounds.x,
    y: point.y - display.bounds.y,
  }));
  if (points.length === 0) return;

  const drawn = points.map(({ x, y }) => ({ x, y }));
  const classified = classifyStroke(drawn);
  const startMs = Math.max(0, points[0]!.t - recordingStartAt);
  const endMs = Math.max(startMs, points[points.length - 1]!.t - recordingStartAt);
  marks.push({ number: marks.length + 1, displayId, classified, drawn, startMs, endMs });
  sendCleanMarks(displayId);
}

function sanitizePoints(payload: MarkStrokePayload): Array<{ x: number; y: number; t: number }> {
  if (!payload || !Array.isArray(payload.points)) return [];
  return payload.points
    .slice(0, MAX_POINTS)
    .filter(
      (point) =>
        point !== null &&
        typeof point === 'object' &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.t),
    );
}

/**
 * Everything one display should show: each stroke as it was drawn. The
 * numbers stay off the user's screen — they only appear in the annotated
 * screenshot, where the model needs them to match ⟦mark N⟧ tokens in the
 * transcript.
 */
function sendCleanMarks(displayId: number): void {
  const color = getSettings().colorUserMarks;
  const clean: CleanMark[] = marks
    .filter((mark) => mark.displayId === displayId)
    .map((mark) => ({
      number: mark.number,
      kind: mark.classified.kind,
      color,
      points: mark.drawn,
      bounds: mark.classified.bounds,
    }));
  sendMarksToDisplay(displayId, clean);
}

/**
 * The whole turn's marks, with their screenshots resolved, for the session
 * to build the request from. The ink stays up through the answer; the data
 * lasts until the next ask.
 */
export async function takeTurnMarks(): Promise<MarksTurn | null> {
  if (consumed || marks.length === 0) return null;
  consumed = true;
  const resolved = (await Promise.all([...shots.values()])).filter(
    (shot): shot is MarkShot => shot !== null,
  );
  return { marks: [...marks], shots: resolved };
}

/**
 * A mark's box in global screen DIP, for `{ mark: n }` drawing anchors.
 * Shaped like the element lookup in src/main/drawing/tools.ts.
 */
export function markBox(value: unknown): { displayId: number; rect: Rect } | null {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) return null;
  const mark = marks.find((entry) => entry.number === number);
  if (!mark) return null;
  const display = screen.getAllDisplays().find((d) => d.id === mark.displayId);
  if (!display) return null;
  const bounds = mark.classified.bounds;
  return {
    displayId: mark.displayId,
    rect: {
      x: display.bounds.x + bounds.x,
      y: display.bounds.y + Math.max(0, bounds.y),
      width: bounds.width,
      height: bounds.height,
    },
  };
}

// --- Dev "Marks" view ---------------------------------------------------------

/** What the model received last turn, kept for the dev Marks view. */
export function setLastTurnDebug(debug: MarksTurnDebug): void {
  lastDebug = debug;
}

export function getLastTurnDebug(): MarksTurnDebug | null {
  return lastDebug;
}
