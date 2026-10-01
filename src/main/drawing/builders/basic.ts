// Lines, arrows, boxes and labels: the shapes most explanations are made of.

import { SIZES, type Geometry, type Size } from '../../../shared/drawing';
import { sameDisplay, type Anchored } from '../anchors';
import { displayOf, labelBelow, labelUnder, readBox, type ShapeBuilder } from '../build';
import { arrowPath, leaderPath, moveLineTo, smoothPath, stopAtEdge } from '../geometry';
import { anchorField, anchorList, arrowheads, number, pick, text } from '../read';
import { MAX_LABEL, MAX_POINTS_PER_SHAPE } from '../types';

const DEFAULT_CORNER_RADIUS = 10;
/** How far a callout bubble sits from what it points at. */
const CALLOUT_GAP = 56;

/** path, line, polyline and polygon all come from a list of anchors. */
function fromPoints(type: string): ShapeBuilder {
  return (shape, context) => {
    const raw = shape['points'];
    if (!Array.isArray(raw)) return { error: `${type} needs points: a list of anchors.` };
    if (raw.length < 2) return { error: `${type} needs at least 2 points.` };
    if (raw.length > MAX_POINTS_PER_SHAPE) {
      return { error: `${type} is over the ${MAX_POINTS_PER_SHAPE}-point limit for one shape.` };
    }

    const resolved = anchorList(raw, context.world);
    if ('error' in resolved) return { error: resolved.error };
    const displayId = sameDisplay(resolved.anchors);
    if (typeof displayId !== 'number') return { error: displayId.error };

    const points = resolved.anchors.map((anchor) => anchor.point);
    // Straight by default, for every type. A model asking for a triangular
    // roof sends three points and means three points; curving them unasked
    // turned the roof into an arch.
    const curve = text(shape['curve'], 20) || 'straight';
    if (!['straight', 'smooth', 'smooth_closed'].includes(curve)) {
      return { error: 'curve must be straight, smooth or smooth_closed.' };
    }
    const closed = type === 'polygon' || curve === 'smooth_closed';
    const heads = arrowheads(shape['arrowhead']);
    if ('error' in heads) return { error: heads.error };

    return {
      displayId,
      geometry: {
        kind: 'path',
        d: curve === 'straight' ? moveLineTo(points, closed) : smoothPath(points, closed),
        arrowStart: heads.start,
        arrowEnd: heads.end,
        closed,
      },
      labelAt: labelBelow(points),
      points: points.length,
    };
  };
}

const arrow: ShapeBuilder = (shape, context) => {
  const from = anchorField(shape, 'from', context.world);
  if ('error' in from) return from;
  const to = anchorField(shape, 'to', context.world);
  if ('error' in to) return to;
  const displayId = sameDisplay([from, to]);
  if (typeof displayId !== 'number') return { error: displayId.error };

  const bend = number(shape['bend']) ?? 0;
  if (bend < -1 || bend > 1) return { error: 'bend must be between -1 and 1.' };

  // An arrow at an element stops at its edge rather than its middle, so the
  // head points at the thing instead of covering it.
  const tip = stopAtEdge(from.point, to.point, to.box);
  const tail = stopAtEdge(to.point, from.point, from.box);
  const heads = arrowheads(shape['arrowhead'] ?? 'end');
  if ('error' in heads) return { error: heads.error };

  return {
    displayId,
    geometry: {
      kind: 'path',
      d: arrowPath(tail, tip, bend),
      arrowStart: heads.start,
      arrowEnd: heads.end,
      closed: false,
    },
    labelAt: { x: (tail.x + tip.x) / 2, y: (tail.y + tip.y) / 2 + 16 },
    points: 2,
  };
};

const rect: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  return {
    displayId: box.displayId,
    geometry: {
      kind: 'rect',
      ...box.rect,
      radius: number(shape['corner_radius']) ?? DEFAULT_CORNER_RADIUS,
    },
    labelAt: labelUnder(box.rect),
    points: 1,
  };
};

const ellipse: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  const { rect: area } = box;
  return {
    displayId: box.displayId,
    geometry: {
      kind: 'ellipse',
      cx: area.x + area.width / 2,
      cy: area.y + area.height / 2,
      rx: area.width / 2,
      ry: area.height / 2,
      rotation: number(shape['rotation']) ?? 0,
    },
    labelAt: labelUnder(area),
    points: 1,
  };
};

const words: ShapeBuilder = (shape, context) => {
  const at = anchorField(shape, 'at', context.world);
  if ('error' in at) return at;
  const content = text(shape['content'], MAX_LABEL);
  if (!content) return { error: `text needs content (up to ${MAX_LABEL} characters).` };
  const size = pick(shape['size'], SIZES, 'medium');
  if (size === null) return { error: `size must be one of: ${SIZES.join(', ')}.` };
  return {
    displayId: at.displayId,
    geometry: { kind: 'text', ...at.point, content, size: size as Size },
    labelAt: at.point,
    points: 1,
  };
};

const callout: ShapeBuilder = (shape, context) => {
  const target = anchorField(shape, 'target', context.world);
  if ('error' in target) return target;
  const content = text(shape['content'], MAX_LABEL);
  if (!content) return { error: `callout needs content (up to ${MAX_LABEL} characters).` };

  const placement = text(shape['placement'], 10) || 'auto';
  if (!['auto', 'above', 'below', 'left', 'right'].includes(placement)) {
    return { error: 'placement must be auto, above, below, left or right.' };
  }
  const bubble = bubbleSpot(target, placement, displayOf(context, target.displayId).height);
  const geometry: Geometry = {
    kind: 'callout',
    ...bubble,
    content,
    leader: leaderPath(bubble, target.point),
  };
  return { displayId: target.displayId, geometry, labelAt: bubble, points: 1 };
};

const stepBadge: ShapeBuilder = (shape, context) => {
  const at = anchorField(shape, 'at', context.world);
  if ('error' in at) return at;
  const value = number(shape['number']);
  if (value === null || value < 1 || value > 99) {
    return { error: 'step_badge needs number: 1 to 99.' };
  }
  return {
    displayId: at.displayId,
    geometry: { kind: 'badge', ...at.point, number: Math.round(value) },
    labelAt: { x: at.point.x, y: at.point.y + 22 },
    points: 1,
  };
};

/** Where a callout bubble sits relative to what it points at. */
function bubbleSpot(target: Anchored, placement: string, displayHeight: number): {
  x: number;
  y: number;
} {
  const box = target.box;
  const halfH = box ? box.height / 2 : 0;
  const halfW = box ? box.width / 2 : 0;
  // Auto keeps the bubble away from the nearer edge of the screen.
  const side = placement === 'auto' ? (target.point.y > displayHeight / 2 ? 'above' : 'below') : placement;
  switch (side) {
    case 'above':
      return { x: target.point.x, y: target.point.y - halfH - CALLOUT_GAP };
    case 'left':
      return { x: target.point.x - halfW - CALLOUT_GAP * 2, y: target.point.y };
    case 'right':
      return { x: target.point.x + halfW + CALLOUT_GAP * 2, y: target.point.y };
    default:
      return { x: target.point.x, y: target.point.y + halfH + CALLOUT_GAP };
  }
}

export const BASIC_BUILDERS: Record<string, ShapeBuilder> = {
  path: fromPoints('path'),
  line: fromPoints('line'),
  polyline: fromPoints('polyline'),
  polygon: fromPoints('polygon'),
  arrow,
  rect,
  ellipse,
  text: words,
  callout,
  step_badge: stepBadge,
};
