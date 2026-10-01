// Shapes for explaining shape: arcs, regular polygons, measured angles,
// dimension lines, brackets, underlines and grids.
//
// These are the ones that make Buddy able to teach rather than just point.

import type { Point } from '../../../shared/drawing';
import { sameDisplay } from '../anchors';
import { labelBelow, labelUnder, readBox, type ShapeBuilder } from '../build';
import { moveLineTo } from '../geometry';
import { anchorField, arrowheads, bounded, number, pick } from '../read';

/** Degrees per straight segment when flattening an arc. */
const ARC_STEP = 4;
/** Where an angle's measuring arc sits, relative to the shorter leg. */
const ANGLE_ARC_FRACTION = 0.35;
const TICK = 6;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Points along an arc. 0 degrees is to the right and angles run clockwise. */
function arcPoints(centre: Point, radius: number, start: number, end: number): Point[] {
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / ARC_STEP));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = radians(start + ((end - start) * i) / steps);
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

const arc: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const start = number(shape['start_angle']);
  const end = number(shape['end_angle']);
  if (start === null || end === null) {
    return { error: 'arc needs start_angle and end_angle in degrees (0 is right, clockwise).' };
  }
  if (Math.abs(end - start) > 360) return { error: 'an arc cannot span more than 360 degrees.' };

  const centre = { x: box.rect.x + box.rect.width / 2, y: box.rect.y + box.rect.height / 2 };
  const points = arcPoints(centre, box.rect.width / 2, start, end);
  const heads = arrowheads(shape['arrowhead']);
  if ('error' in heads) return { error: heads.error };

  return {
    displayId: box.displayId,
    geometry: {
      kind: 'path',
      d: moveLineTo(points),
      arrowStart: heads.start,
      arrowEnd: heads.end,
      closed: false,
    },
    labelAt: labelBelow(points),
    points: points.length,
  };
};

const regularPolygon: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const sides = bounded(shape['sides'], 3, 12);
  if (sides === null) return { error: 'regular_polygon needs sides: 3 to 12.' };

  const centre = { x: box.rect.x + box.rect.width / 2, y: box.rect.y + box.rect.height / 2 };
  const radius = Math.min(box.rect.width, box.rect.height) / 2;
  const rotation = number(shape['rotation']) ?? 0;
  const count = Math.round(sides);
  // Start at the top, which is how a pentagon or hexagon is usually drawn.
  const points = Array.from({ length: count }, (_, i) => {
    const angle = radians(rotation - 90 + (360 * i) / count);
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });

  return {
    displayId: box.displayId,
    geometry: { kind: 'path', d: moveLineTo(points, true), arrowStart: false, arrowEnd: false, closed: true },
    labelAt: labelUnder(box.rect),
    points: count,
  };
};

/**
 * An angle at a vertex between two points, with the little arc that marks
 * it and, if asked, the measurement.
 */
const angle: ShapeBuilder = (shape, context) => {
  const vertex = anchorField(shape, 'vertex', context.world);
  if ('error' in vertex) return vertex;
  const a = anchorField(shape, 'a', context.world);
  if ('error' in a) return a;
  const b = anchorField(shape, 'b', context.world);
  if ('error' in b) return b;
  const displayId = sameDisplay([vertex, a, b]);
  if (typeof displayId !== 'number') return { error: displayId.error };

  const angleTo = (point: Point): number =>
    (Math.atan2(point.y - vertex.point.y, point.x - vertex.point.x) * 180) / Math.PI;
  const legA = Math.hypot(a.point.x - vertex.point.x, a.point.y - vertex.point.y);
  const legB = Math.hypot(b.point.x - vertex.point.x, b.point.y - vertex.point.y);
  if (legA < 1 || legB < 1) return { error: 'the angle\'s points are on top of its vertex.' };

  const from = angleTo(a.point);
  let to = angleTo(b.point);
  // Mark the angle the short way round, which is the one meant.
  while (to - from > 180) to -= 360;
  while (to - from < -180) to += 360;

  const radius = Math.min(legA, legB) * ANGLE_ARC_FRACTION;
  const marker = arcPoints(vertex.point, radius, from, to);
  const d = [
    moveLineTo([a.point, vertex.point, b.point]),
    moveLineTo(marker),
  ].join(' ');

  const midAngle = radians((from + to) / 2);
  return {
    displayId,
    geometry: { kind: 'path', d, arrowStart: false, arrowEnd: false, closed: false },
    labelAt: {
      x: vertex.point.x + Math.cos(midAngle) * (radius + 22),
      y: vertex.point.y + Math.sin(midAngle) * (radius + 22),
    },
    // The measurement is the label, unless the model wrote its own.
    ...(shape['show_degrees'] === true
      ? { labelText: `${Math.round(Math.abs(to - from))}°` }
      : {}),
    points: marker.length + 3,
  };
};

/** An engineering measurement line: a span with ticks at both ends. */
const dimension: ShapeBuilder = (shape, context) => {
  const from = anchorField(shape, 'from', context.world);
  if ('error' in from) return from;
  const to = anchorField(shape, 'to', context.world);
  if ('error' in to) return to;
  const displayId = sameDisplay([from, to]);
  if (typeof displayId !== 'number') return { error: displayId.error };

  const dx = to.point.x - from.point.x;
  const dy = to.point.y - from.point.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return { error: 'a dimension needs two different places.' };
  // Ticks sit across the line at each end.
  const nx = (-dy / length) * TICK;
  const ny = (dx / length) * TICK;

  const d = [
    moveLineTo([from.point, to.point]),
    moveLineTo([
      { x: from.point.x + nx, y: from.point.y + ny },
      { x: from.point.x - nx, y: from.point.y - ny },
    ]),
    moveLineTo([
      { x: to.point.x + nx, y: to.point.y + ny },
      { x: to.point.x - nx, y: to.point.y - ny },
    ]),
  ].join(' ');

  return {
    displayId,
    geometry: { kind: 'path', d, arrowStart: true, arrowEnd: true, closed: false },
    labelAt: { x: (from.point.x + to.point.x) / 2, y: (from.point.y + to.point.y) / 2 - 14 },
    points: 6,
  };
};

/** A square or curly bracket along one side of a box. */
const bracket: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const side = pick(shape['side'], ['left', 'right', 'top', 'bottom'] as const, 'left');
  if (side === null) return { error: 'side must be left, right, top or bottom.' };
  const style = pick(shape['style'], ['square', 'curly'] as const, 'square');
  if (style === null) return { error: 'style must be square or curly.' };

  const { x, y, width, height } = box.rect;
  const lip = 10;
  const vertical = side === 'left' || side === 'right';
  const at = side === 'left' ? x : side === 'right' ? x + width : side === 'top' ? y : y + height;
  const inward = side === 'left' || side === 'top' ? lip : -lip;

  let d: string;
  if (vertical) {
    const ends = [y, y + height];
    d =
      style === 'square'
        ? moveLineTo([
            { x: at + inward, y: ends[0]! },
            { x: at, y: ends[0]! },
            { x: at, y: ends[1]! },
            { x: at + inward, y: ends[1]! },
          ])
        : `M ${at + inward} ${ends[0]} Q ${at} ${ends[0]} ${at} ${(y + height / 2).toFixed(2)} ` +
          `Q ${at} ${ends[1]} ${at + inward} ${ends[1]}`;
  } else {
    const ends = [x, x + width];
    d =
      style === 'square'
        ? moveLineTo([
            { x: ends[0]!, y: at + inward },
            { x: ends[0]!, y: at },
            { x: ends[1]!, y: at },
            { x: ends[1]!, y: at + inward },
          ])
        : `M ${ends[0]} ${at + inward} Q ${ends[0]} ${at} ${(x + width / 2).toFixed(2)} ${at} ` +
          `Q ${ends[1]} ${at} ${ends[1]} ${at + inward}`;
  }

  return {
    displayId: box.displayId,
    geometry: { kind: 'path', d, arrowStart: false, arrowEnd: false, closed: false },
    labelAt: labelUnder(box.rect),
    points: 4,
  };
};

/** A line under or through something, straight or wavy. */
function ruleThrough(type: 'underline' | 'strike'): ShapeBuilder {
  return (shape, context) => {
    const box = readBox(shape, context);
    if ('error' in box) return box;
    const style = pick(shape['style'], ['straight', 'wavy'] as const, 'straight');
    if (style === null) return { error: 'style must be straight or wavy.' };

    const { x, y, width, height } = box.rect;
    const level = type === 'underline' ? y + height : y + height / 2;
    const d =
      style === 'straight'
        ? moveLineTo([
            { x, y: level },
            { x: x + width, y: level },
          ])
        : wavy(x, x + width, level);

    return {
      displayId: box.displayId,
      geometry: { kind: 'path', d, arrowStart: false, arrowEnd: false, closed: false },
      labelAt: { x: x + width / 2, y: level + 16 },
      points: 2,
    };
  };
}

/** A gentle wave, the way a spellchecker underlines. */
function wavy(from: number, to: number, level: number): string {
  const wavelength = 12;
  const amplitude = 3;
  const parts = [`M ${round(from)} ${round(level)}`];
  for (let x = from; x < to; x += wavelength) {
    const mid = Math.min(x + wavelength / 2, to);
    const end = Math.min(x + wavelength, to);
    const lift = (Math.round((x - from) / wavelength) % 2 === 0 ? -1 : 1) * amplitude;
    parts.push(`Q ${round(mid)} ${round(level + lift)} ${round(end)} ${round(level)}`);
  }
  return parts.join(' ');
}

/** Graph paper over a region, for sketching on top of. */
const grid: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const spacing = bounded(shape['spacing'], 4, 400);
  if (spacing === null) return { error: 'grid needs spacing: 4 to 400 points.' };

  const { x, y, width, height } = box.rect;
  const lines: string[] = [];
  for (let at = x; at <= x + width + 0.5; at += spacing) {
    lines.push(moveLineTo([{ x: at, y }, { x: at, y: y + height }]));
  }
  for (let at = y; at <= y + height + 0.5; at += spacing) {
    lines.push(moveLineTo([{ x, y: at }, { x: x + width, y: at }]));
  }
  return {
    displayId: box.displayId,
    geometry: { kind: 'path', d: lines.join(' '), arrowStart: false, arrowEnd: false, closed: false },
    labelAt: labelUnder(box.rect),
    points: lines.length,
  };
};

/** Axes across a region, with ticks and optional end labels. */
const axes: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const { x, y, width, height } = box.rect;

  const parts = [
    // The x axis along the bottom, the y axis up the left.
    moveLineTo([{ x, y: y + height }, { x: x + width, y: y + height }]),
    moveLineTo([{ x, y }, { x, y: y + height }]),
  ];
  const ticks = bounded(shape['ticks'], 2, 20) ?? 5;
  for (let i = 1; i <= ticks; i++) {
    const tx = x + (width * i) / ticks;
    const ty = y + height - (height * i) / ticks;
    parts.push(moveLineTo([{ x: tx, y: y + height - TICK }, { x: tx, y: y + height + TICK }]));
    parts.push(moveLineTo([{ x: x - TICK, y: ty }, { x: x + TICK, y: ty }]));
  }

  return {
    displayId: box.displayId,
    geometry: {
      kind: 'path',
      d: parts.join(' '),
      arrowStart: false,
      arrowEnd: false,
      closed: false,
    },
    labelAt: { x: x + width / 2, y: y + height + 20 },
    points: parts.length,
  };
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export const GEOMETRY_BUILDERS: Record<string, ShapeBuilder> = {
  arc,
  regular_polygon: regularPolygon,
  angle,
  dimension,
  bracket,
  underline: ruleThrough('underline'),
  strike: ruleThrough('strike'),
  grid,
  axes,
};
