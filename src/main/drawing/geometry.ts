// The maths behind the shapes: smooth curves through points, arrows that
// stop at the edge of what they point at, and boxes drawn around things.
//
// Every path string the renderer draws is built here, from numbers Buddy has
// already validated. Pure module, fully unit-testable.

import type { Point } from '../../shared/drawing';
import type { Rect } from '../coords';

/** How far short of an element's edge an arrowhead stops, in DIP. */
const ARROW_GAP = 6;

/** Catmull-Rom tension. A half gives the standard, uniform spline. */
const TENSION = 0.5;

export function moveLineTo(points: readonly Point[], closed = false): string {
  const [first, ...rest] = points;
  if (!first) return '';
  const parts = [`M ${round(first.x)} ${round(first.y)}`];
  for (const point of rest) parts.push(`L ${round(point.x)} ${round(point.y)}`);
  if (closed) parts.push('Z');
  return parts.join(' ');
}

/**
 * A smooth curve that passes through every point, as cubic Béziers.
 *
 * Catmull-Rom is the right spline for this: the model names places it wants
 * the line to go through, and unlike a plain Bézier this touches all of
 * them. The ends are handled by duplicating the first and last point, so the
 * curve starts and finishes exactly where it was asked to.
 */
export function smoothPath(points: readonly Point[], closed = false): string {
  if (points.length < 3) return moveLineTo(points, closed);
  const path = closed ? [...points, points[0]!, points[1]!] : points;
  const first = path[0]!;
  const parts = [`M ${round(first.x)} ${round(first.y)}`];

  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[i - 1] ?? path[i]!;
    const p1 = path[i]!;
    const p2 = path[i + 1]!;
    const p3 = path[i + 2] ?? p2;
    const c1 = {
      x: p1.x + ((p2.x - p0.x) * TENSION) / 3,
      y: p1.y + ((p2.y - p0.y) * TENSION) / 3,
    };
    const c2 = {
      x: p2.x - ((p3.x - p1.x) * TENSION) / 3,
      y: p2.y - ((p3.y - p1.y) * TENSION) / 3,
    };
    parts.push(
      `C ${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`,
    );
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

/**
 * An arrow from one point to another, bent sideways by `bend` (-1 to 1).
 * A straight line between two things often crosses what matters in between,
 * so the model can ask the arrow to go around.
 */
export function arrowPath(from: Point, to: Point, bend: number): string {
  if (bend === 0) return moveLineTo([from, to]);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Perpendicular offset, proportional to the span so the bow looks the
  // same whether the arrow is short or long.
  const control = {
    x: midX - dy * bend * 0.5,
    y: midY + dx * bend * 0.5,
  };
  return (
    `M ${round(from.x)} ${round(from.y)} ` +
    `Q ${round(control.x)} ${round(control.y)} ${round(to.x)} ${round(to.y)}`
  );
}

/**
 * Pull an endpoint back to just outside a box, so an arrow pointing at a
 * button stops at its edge with a small gap instead of burying its head in
 * the middle of it.
 */
export function stopAtEdge(from: Point, to: Point, box: Rect | undefined): Point {
  if (!box) return to;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;

  // How far from the centre the box edge is, along this direction.
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const ux = dx / length;
  const uy = dy / length;
  const toEdge = Math.min(
    ux === 0 ? Infinity : Math.abs(halfW / ux),
    uy === 0 ? Infinity : Math.abs(halfH / uy),
  );
  const pullBack = Math.min(length, (Number.isFinite(toEdge) ? toEdge : 0) + ARROW_GAP);
  return { x: to.x - ux * pullBack, y: to.y - uy * pullBack };
}

/** The box around something, grown by padding and kept on the display. */
export function padded(box: Rect, padding: number, display: { width: number; height: number }): Rect {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(display.width - x, box.width + padding * 2),
    height: Math.min(display.height - y, box.height + padding * 2),
  };
}

/** The box two corner points describe, whichever way round they were given. */
export function boxBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** A curved leader line from a label bubble to the thing it describes. */
export function leaderPath(from: Point, to: Point): string {
  const midX = (from.x + to.x) / 2;
  return (
    `M ${round(from.x)} ${round(from.y)} ` +
    `Q ${round(midX)} ${round(from.y)} ${round(to.x)} ${round(to.y)}`
  );
}

/** Two decimals is well under a pixel and keeps the path strings short. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
