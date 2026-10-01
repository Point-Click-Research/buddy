// Classifying a user-drawn stroke into what the user meant by it:
//
//   tap       press and release with almost no movement — a point
//   region    a roughly closed loop (or a dense scribble) — "this area"
//   underline a mostly horizontal open stroke — the text band just above it
//   path      any other open stroke — a direction from start to end
//
// Pure module: points in, geometry out. Coordinates are overlay-local DIP;
// nothing here knows about displays or screenshots.

import type { MarkKind } from '../../shared/types';

export interface StrokePoint {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClassifiedStroke {
  kind: MarkKind;
  /**
   * The cleaned geometry: a tap's single point, a region's closed polygon,
   * an underline's simplified stroke, or a path's simplified polyline.
   */
  points: StrokePoint[];
  /**
   * What the mark refers to: a small box around a tap, a region's bounding
   * box, the text band above an underline, or a path's bounding box. May
   * poke past the display edge (an underline near the top); callers clamp.
   */
  bounds: Rect;
  /** Path marks only: unit direction from start to end. */
  direction?: { dx: number; dy: number };
}

/** Movement under this is a tap, not a stroke. */
const TAP_RADIUS = 6;

/** What a tap refers to: a small square around the point. */
const TAP_BOX = 16;

/** An underline must be this much wider than tall. */
const UNDERLINE_RATIO = 3.5;

/** The band above an underline: proportional to its width, within reason. */
const BAND_MIN = 14;
const BAND_MAX = 44;

export function classifyStroke(raw: readonly StrokePoint[]): ClassifiedStroke {
  const points = raw.length > 0 ? [...raw] : [{ x: 0, y: 0 }];
  const box = bbox(points);
  const diagonal = Math.hypot(box.width, box.height);

  if (diagonal < TAP_RADIUS) {
    const center = centroid(points);
    return {
      kind: 'tap',
      points: [center],
      bounds: {
        x: center.x - TAP_BOX / 2,
        y: center.y - TAP_BOX / 2,
        width: TAP_BOX,
        height: TAP_BOX,
      },
    };
  }

  const length = strokeLength(points);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const endGap = Math.hypot(last.x - first.x, last.y - first.y);

  // A loop whose ends nearly meet, a stroke that encloses a clear area
  // (rectangles and messy lassos never quite close), or a dense scribble
  // that shades an area — all mean "the thing inside this".
  const closed = endGap <= Math.max(0.2 * length, 0.3 * diagonal);
  const boxArea = box.width * box.height;
  const enclosesArea = boxArea > 0 && Math.abs(signedArea(points)) >= 0.35 * boxArea;
  const scribbles =
    box.width > 12 && box.height > 12 && length > 2.5 * (2 * (box.width + box.height));

  if (closed || enclosesArea || scribbles) {
    const polygon = simplify(points, Math.max(2, diagonal * 0.015));
    // Close the outline so the polygon reads as one.
    const start = polygon[0]!;
    const end = polygon[polygon.length - 1]!;
    if (start.x !== end.x || start.y !== end.y) polygon.push({ ...start });
    return { kind: 'region', points: polygon, bounds: box };
  }

  if (box.width >= UNDERLINE_RATIO * Math.max(box.height, 1) && box.width > 20) {
    const band = clampNumber(box.width / 8, BAND_MIN, BAND_MAX);
    return {
      kind: 'underline',
      points: simplify(points, Math.max(2, diagonal * 0.01)),
      bounds: { x: box.x, y: box.y - band, width: box.width, height: band },
    };
  }

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const norm = Math.hypot(dx, dy) || 1;
  return {
    kind: 'path',
    points: simplify(points, Math.max(2, diagonal * 0.01)),
    bounds: box,
    direction: { dx: dx / norm, dy: dy / norm },
  };
}

/** A compass word for a path's direction ("right", "down-left"). */
export function directionName(direction: { dx: number; dy: number }): string {
  const horizontal = Math.abs(direction.dx) > 0.38 ? (direction.dx > 0 ? 'right' : 'left') : '';
  const vertical = Math.abs(direction.dy) > 0.38 ? (direction.dy > 0 ? 'down' : 'up') : '';
  return vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal || 'right';
}

function bbox(points: readonly StrokePoint[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function centroid(points: readonly StrokePoint[]): StrokePoint {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function strokeLength(points: readonly StrokePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/** Shoelace area; large relative to the bbox means the stroke encloses it. */
function signedArea(points: readonly StrokePoint[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Ramer–Douglas–Peucker: the stroke with every point that matters, only. */
export function simplify(points: readonly StrokePoint[], epsilon: number): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;

  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointToSegment(points[i]!, first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [first, last];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function pointToSegment(point: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
