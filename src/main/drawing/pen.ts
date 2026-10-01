// The hand-drawn look: Buddy draws with the pen the user marks with.
//
// `sketch` is a stroke style, not a shape, so it applies after the geometry
// is built: the outline the shape produced is traced again as pen strokes and
// filled as ink. A ring is one loop that runs on past where it started, a box
// one stroke round its corners, an arrowhead a quick V at the tip, the way a
// hand draws them. Every stroke is paced slow at its ends and quick in the
// middle, which is what makes the ink swell and thin like a real pen's.
//
// The shape's id seeds where a loop starts and how far it runs on, so the
// same shape always comes out the same way and a redraw never jitters.
// Pure module.

import { pointsOnPath } from 'points-on-path';
import type { Geometry, Point, Width } from '../../shared/drawing';
import { PEN_SIZES, penOutline, round } from '../../shared/pen';

type Ink = Extract<Geometry, { kind: 'ink' }>;

/** Roughly how far apart a stroke's samples fall, in points. */
const SPACING = 3;
const ARROW_LENGTH = 14;
const ARROW_SPREAD = Math.PI / 7;

/** Ink for these strokes, drawn in order; null when none is long enough to leave ink. */
export function inkStrokes(strokes: ReadonlyArray<readonly Point[]>, width: Width): Ink | null {
  const size = PEN_SIZES[width];
  const paced = strokes.filter((stroke) => stroke.length >= 2).map(pace);
  const d = paced.map((stroke) => penOutline(stroke, size)).filter(Boolean).join(' ');
  if (!d) return null;
  const center = paced
    .map((stroke) => stroke.map((point, i) => `${i === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' '))
    .join(' ');
  // The outline swells either side of the centreline, so the reveal is comfortably wider than the nib.
  return { kind: 'ink', d, center, reveal: size * 2.5 };
}

/** Redraw a shape's outline with the pen. Shapes with no outline come back untouched. */
export function penDrawn(geometry: Geometry, width: Width, seed: string): Geometry {
  switch (geometry.kind) {
    case 'path': {
      const strokes = pointsOnPath(geometry.d, 0.5).map((stroke) => stroke.map(([x, y]) => ({ x, y })));
      const first = strokes[0];
      const last = strokes[strokes.length - 1];
      const heads = [
        ...(geometry.arrowEnd && last ? [arrowhead(last)] : []),
        ...(geometry.arrowStart && first ? [arrowhead([...first].reverse())] : []),
      ];
      return inkStrokes([...strokes, ...heads], width) ?? geometry;
    }
    case 'rect':
      return inkStrokes([box(geometry, random(seed))], width) ?? geometry;
    case 'ellipse':
      return inkStrokes([loop(geometry, random(seed))], width) ?? geometry;
    default:
      return geometry;
  }
}

/**
 * Resample a stroke along its length, close together at the ends and further
 * apart in the middle: the pen's pace, which perfect-freehand reads as pressure.
 */
function pace(stroke: readonly Point[]): Point[] {
  const at = [0];
  for (let i = 1; i < stroke.length; i++) {
    at.push(at[i - 1]! + Math.hypot(stroke[i]!.x - stroke[i - 1]!.x, stroke[i]!.y - stroke[i - 1]!.y));
  }
  const total = at[at.length - 1]!;
  if (total < 1) return [...stroke];
  const count = Math.max(8, Math.ceil(total / SPACING));
  const paced: Point[] = [];
  let segment = 1;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const distance = total * (0.5 * t + 0.5 * t * t * (3 - 2 * t));
    while (segment < at.length - 1 && at[segment]! < distance) segment++;
    const from = stroke[segment - 1]!;
    const to = stroke[segment]!;
    const span = at[segment]! - at[segment - 1]! || 1;
    const k = (distance - at[segment - 1]!) / span;
    paced.push({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
  }
  return paced;
}

/** A quick V at the end of a stroke, pointing the way it was travelling. */
function arrowhead(stroke: readonly Point[]): Point[] {
  const tip = stroke[stroke.length - 1]!;
  let back = stroke[0]!;
  for (let i = stroke.length - 2; i >= 0; i--) {
    back = stroke[i]!;
    if (Math.hypot(tip.x - back.x, tip.y - back.y) >= ARROW_LENGTH) break;
  }
  const angle = Math.atan2(tip.y - back.y, tip.x - back.x);
  const wing = (turn: number): Point => ({
    x: tip.x - ARROW_LENGTH * Math.cos(angle + turn),
    y: tip.y - ARROW_LENGTH * Math.sin(angle + turn),
  });
  return [wing(-ARROW_SPREAD), tip, wing(ARROW_SPREAD)];
}

/**
 * One loop around the ellipse, the way a hand rings something: it starts up
 * and to the left, goes round, and runs on past the start, drifting a little
 * wider as it goes so the ends don't meet.
 */
function loop(ellipse: Extract<Geometry, { kind: 'ellipse' }>, next: () => number): Point[] {
  const start = -2.3 + (next() - 0.5) * 0.6;
  const sweep = Math.PI * 2 + 0.35 + next() * 0.3;
  const drift = 0.03 + next() * 0.04;
  const turn = (ellipse.rotation * Math.PI) / 180;
  const steps = 96;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start - sweep * t;
    const grow = 1 + drift * t;
    const x = ellipse.rx * grow * Math.cos(angle);
    const y = ellipse.ry * grow * Math.sin(angle);
    points.push({
      x: ellipse.cx + x * Math.cos(turn) - y * Math.sin(turn),
      y: ellipse.cy + x * Math.sin(turn) + y * Math.cos(turn),
    });
  }
  return points;
}

/** One stroke round a box, corners a touch off true, running on a little along the top. */
function box(rect: Extract<Geometry, { kind: 'rect' }>, next: () => number): Point[] {
  const nudge = (): number => (next() - 0.5) * 3;
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const start = { x: left + nudge(), y: top + nudge() };
  return [
    start,
    { x: right + nudge(), y: top + nudge() },
    { x: right + nudge(), y: bottom + nudge() },
    { x: left + nudge(), y: bottom + nudge() },
    { x: left + nudge(), y: top + nudge() },
    { x: start.x + Math.min(12, rect.width / 4), y: start.y + nudge() },
  ];
}

/** A repeatable sequence in [0, 1) from the shape's id (mulberry32). */
function random(id: string): () => number {
  let state = 0;
  for (const character of id) state = (state * 31 + character.charCodeAt(0)) | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
