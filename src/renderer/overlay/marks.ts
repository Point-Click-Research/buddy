// The user's marking layer: while the talk chord is held, main gives this
// overlay the mouse and the user draws directly on the screen. The stroke
// inks live with the pen in the user color; when it ends, main classifies it
// for the model and sends it back, and it stays exactly as it was drawn. The
// mark numbers stay off the user's screen — they only exist in the annotated
// screenshot, where the model matches them to ⟦mark N⟧ in the transcript.
//
// Marks are the user's, not Buddy's: they live on their own SVG layer,
// untouched by annotation clears and drawing erases.

import { DISCO_COLOR } from '../../shared/color';
import { PEN_SIZES, penOutline } from '../../shared/pen';
import type { CleanMark } from '../../shared/types';
import type { BuddyApi } from '../../shared/ipc';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Skip mousemove samples closer than this, so strokes stay light. */
const MIN_SAMPLE_DISTANCE = 1.5;

/** Disco rides the overlay's spinning `--user-marks`; a hex is used as-is. */
function paint(value: string): string {
  return value === DISCO_COLOR ? 'var(--user-marks)' : value;
}

let active = false;
let color = '#3d7bfd';
let drawing = false;
/**
 * Stroke points in GLOBAL screen coordinates (event.screenX/Y), not
 * window-local ones. macOS can move this overlay window mid-stroke — at first
 * boot it parks the window a few pixels off its display and snaps it back
 * around the moment it first takes the mouse — and window-local points
 * recorded across such a move straddle two coordinate spaces, drawing a
 * phantom vertical jog. Global points stay true to the physical screen no
 * matter what the window does; main converts them to display space.
 */
let points: Array<{ x: number; y: number; t: number }> = [];

/** Is the overlay capturing the mouse for marking right now? overlay.ts's
 * mouse-mode logic must stand aside while this is true. */
export function markingActive(): boolean {
  return active;
}

export function initMarks(buddy: BuddyApi): void {
  const layer = document.getElementById('marks-layer')!;
  const liveGroup = document.createElementNS(SVG_NS, 'g');
  const cleanGroup = document.createElementNS(SVG_NS, 'g');
  layer.append(cleanGroup, liveGroup);

  buddy.onMarksMode((mode) => {
    active = mode.active;
    color = mode.color;
    document.body.classList.toggle('marking', active);
    // The chord came up mid-drag: the mouse is about to stop reaching this
    // window, so the stroke ends here rather than being lost.
    if (!active && drawing) finishStroke(buddy);
  });

  window.addEventListener('mousedown', (event) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    drawing = true;
    points = [{ x: event.screenX, y: event.screenY, t: Date.now() }];
    buddy.sendMarkStrokeBegin();
    renderLive(liveGroup);
  });

  window.addEventListener('mousemove', (event) => {
    if (!drawing) return;
    const last = points[points.length - 1]!;
    if (Math.hypot(event.screenX - last.x, event.screenY - last.y) < MIN_SAMPLE_DISTANCE) return;
    points.push({ x: event.screenX, y: event.screenY, t: Date.now() });
    renderLive(liveGroup);
  });

  window.addEventListener('mouseup', (event) => {
    if (!drawing) return;
    points.push({ x: event.screenX, y: event.screenY, t: Date.now() });
    finishStroke(buddy);
  });

  buddy.onMarksSet((marks) => {
    liveGroup.replaceChildren();
    cleanGroup.replaceChildren(...marks.map((mark) => cleanMarkNode(mark)));
  });

  buddy.onMarksClear(() => {
    drawing = false;
    points = [];
    liveGroup.replaceChildren();
    cleanGroup.replaceChildren();
  });

  function finishStroke(api: BuddyApi): void {
    drawing = false;
    api.sendMarkStroke({ points });
    points = [];
    // The raw stroke stays visible until main replies with the clean version.
  }
}

/** The in-progress stroke, inked. */
function renderLive(group: SVGGElement): void {
  // Points are global; the group is shifted by the window's CURRENT position
  // each render, so the ink stays glued to the screen even if the window
  // moves under the stroke.
  group.setAttribute('transform', `translate(${-window.screenX} ${-window.screenY})`);
  group.replaceChildren(ink(points, color));
}

/** A stroke as the pen left it, in the user's colour. */
function ink(stroke: ReadonlyArray<{ x: number; y: number }>, fill: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', penOutline(stroke, PEN_SIZES.medium));
  path.setAttribute('fill', paint(fill));
  path.setAttribute('fill-opacity', '0.9');
  return path;
}

/**
 * One finished mark, as it was drawn; a tap, which leaves almost no ink,
 * becomes a dot. No number badge here: the user knows what they drew, so
 * the numbers live only in the screenshot the model sees.
 */
function cleanMarkNode(mark: CleanMark): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  if (mark.kind === 'tap') {
    const point = mark.points[0] ?? { x: mark.bounds.x, y: mark.bounds.y };
    group.append(
      circle(point.x, point.y, 12, paint(mark.color), 0.25),
      circle(point.x, point.y, 6, paint(mark.color), 1),
    );
  } else {
    group.append(ink(mark.points, mark.color));
  }
  return group;
}

function circle(cx: number, cy: number, r: number, fill: string, opacity: number): SVGCircleElement {
  const node = document.createElementNS(SVG_NS, 'circle');
  node.setAttribute('cx', String(cx));
  node.setAttribute('cy', String(cy));
  node.setAttribute('r', String(r));
  node.setAttribute('fill', fill);
  node.setAttribute('fill-opacity', String(opacity));
  return node;
}
