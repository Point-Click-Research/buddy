// Shapes that aren't made of straight rules: a raw path, a pen stroke, a
// connector that routes around what it joins, and a spotlight.

import { isError, resolveAnchor, sameDisplay } from '../anchors';
import { labelBelow, labelUnder, readBox, type ShapeBuilder } from '../build';
import { inkStrokes } from '../pen';
import { arrowPath, stopAtEdge } from '../geometry';
import { anchorField, anchorList, arrowheads, number, pick } from '../read';
import { parseSvgPath } from '../svg-path';
import { MAX_POINTS_PER_SHAPE } from '../types';

/** How soft a spotlight's edge is, relative to the smaller side of its hole. */
const FEATHER_SHARE = 0.3;
const MIN_FEATHER = 5;
const MAX_FEATHER = 40;
/** How hard a connector bows away from a straight line. */
const CONNECTOR_BEND = 0.32;

/**
 * A path the model wrote. Its coordinates are in one screenshot's pixel
 * space, named by `frameId`, and the string is parsed and rebuilt rather
 * than passed through.
 */
const svgPath: ShapeBuilder = (shape, context) => {
  const anchor = resolveAnchor({ x: 0, y: 0, frameId: shape['frameId'] }, context.world);
  if (isError(anchor)) return { error: anchor.error };
  if (!anchor.scale) return { error: 'svg_path needs a frameId: the screenshot its d was measured in.' };

  const parsed = parseSvgPath(shape['d'], { scale: anchor.scale, origin: anchor.point });
  if ('error' in parsed) return { error: parsed.error };
  const heads = arrowheads(shape['arrowhead']);
  if ('error' in heads) return { error: heads.error };

  return {
    displayId: anchor.displayId,
    geometry: {
      kind: 'path',
      d: parsed.d,
      arrowStart: heads.start,
      arrowEnd: heads.end,
      closed: false,
    },
    labelAt: anchor.point,
    points: parsed.commands,
  };
};

/** A pen stroke through a list of points, thick in the middle like ink. */
const freehand: ShapeBuilder = (shape, context) => {
  const raw = shape['points'];
  if (!Array.isArray(raw)) return { error: 'freehand needs points: a list of anchors.' };
  if (raw.length < 2) return { error: 'freehand needs at least 2 points.' };
  if (raw.length > MAX_POINTS_PER_SHAPE) {
    return { error: `freehand is over the ${MAX_POINTS_PER_SHAPE}-point limit for one shape.` };
  }
  const resolved = anchorList(raw, context.world);
  if ('error' in resolved) return { error: resolved.error };
  const displayId = sameDisplay(resolved.anchors);
  if (typeof displayId !== 'number') return { error: displayId.error };

  const points = resolved.anchors.map((anchor) => anchor.point);
  const width = pick(shape['width'], ['thin', 'medium', 'thick'] as const, 'medium');
  const ink = inkStrokes([points], width ?? 'medium');
  if (!ink) return { error: 'those points are too close together to make a stroke.' };

  return {
    displayId,
    geometry: ink,
    labelAt: labelBelow(points),
    points: points.length,
  };
};

/**
 * Like an arrow, but it bows away from a straight line so it does not run
 * through the two things it joins. Which way it bows depends on how the
 * elements sit, so the curve goes around rather than across.
 */
const connector: ShapeBuilder = (shape, context) => {
  const from = anchorField(shape, 'from', context.world);
  if ('error' in from) return from;
  const to = anchorField(shape, 'to', context.world);
  if ('error' in to) return to;
  const displayId = sameDisplay([from, to]);
  if (typeof displayId !== 'number') return { error: displayId.error };

  const tip = stopAtEdge(from.point, to.point, to.box);
  const tail = stopAtEdge(to.point, from.point, from.box);
  // Bow around the shorter axis: for things side by side that means over or
  // under, and for things stacked it means out to one side.
  const sideways = Math.abs(tip.x - tail.x) >= Math.abs(tip.y - tail.y);
  const bend = (sideways ? 1 : -1) * CONNECTOR_BEND;
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

/** Dim everything except one thing. */
const spotlight: ShapeBuilder = (shape, context) => {
  const box = readBox(shape, context);
  if ('error' in box) return box;
  // The feather is a share of the hole, not a fixed distance. A tab is only
  // about 28 points tall, and a fixed 28-point fade around it made the lit
  // area look twice the size of the thing being pointed at.
  const natural = Math.min(box.rect.width, box.rect.height) * FEATHER_SHARE;
  const feather = number(shape['feather']) ?? Math.min(MAX_FEATHER, Math.max(MIN_FEATHER, natural));
  return {
    displayId: box.displayId,
    geometry: { kind: 'spotlight', hole: box.rect, feather: Math.max(0, Math.min(feather, 200)) },
    labelAt: labelUnder(box.rect),
    points: 1,
  };
};

export const FREEFORM_BUILDERS: Record<string, ShapeBuilder> = {
  svg_path: svgPath,
  freehand,
  connector,
  spotlight,
};
