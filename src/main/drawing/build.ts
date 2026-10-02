// What a shape builder is, and where boxes come from.
//
// Every shape type is one function with this signature, so validate.ts only
// has to dispatch. Pure module.

import type { Geometry, Point } from '../../shared/drawing';
import type { Rect } from '../coords';
import { isError, resolveAnchor, sameDisplay, type AnchorWorld } from './anchors';
import { padded } from './geometry';
import { number } from './read';

interface Built {
  displayId: number;
  geometry: Geometry;
  /** Where this shape's label wants to sit. */
  labelAt: Point;
  /**
   * A label the shape itself produced, such as an angle's measurement. The
   * model's own `label` wins if it gave one.
   */
  labelText?: string;
  /** Counted against the per-call point budget. */
  points: number;
}

type BuildResult = Built | { error: string };

export interface BuildContext {
  world: AnchorWorld;
  /** Display bounds by id, for clamping and padding. */
  displays: ReadonlyMap<number, Rect>;
}

export type ShapeBuilder = (shape: Record<string, unknown>, context: BuildContext) => BuildResult;

/** Default padding when a shape is drawn `around` something. */
const DEFAULT_PADDING = 8;

export function displayOf(context: BuildContext, displayId: number): Rect {
  return context.displays.get(displayId) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/**
 * The box a shape covers. Three ways to say it, because enclosing something
 * is the commonest drawing there is and each is the natural call somewhere:
 *
 *   around: <element>       enclose a real control, with padding
 *   from / to               two opposite corners
 *   at + radius (or rx/ry)  a centre and a size
 *
 * A size only makes sense with a screenshot anchor, where it is read in that
 * image's pixels and scaled exactly as the position was — the space the
 * model measured in. `width` is the stroke thickness on every shape, so a
 * box's size is named radius / rx / ry.
 */
const BOX_FORMS =
  'needs one of: around (an element or a mark), from and to as opposite corners, ' +
  'or at plus radius (or rx and ry) measured in the same screenshot';

export function readBox(
  shape: Record<string, unknown>,
  context: BuildContext,
): { rect: Rect; displayId: number } | { error: string } {
  if (shape['around'] !== undefined) {
    const anchor = resolveAnchor(shape['around'], context.world);
    if (isError(anchor)) return { error: `around: ${anchor.error}` };
    if (!anchor.box) {
      return { error: 'around needs an element or a mark, which has a box; a bare point has none.' };
    }
    return {
      rect: padded(
        anchor.box,
        number(shape['padding']) ?? DEFAULT_PADDING,
        displayOf(context, anchor.displayId),
      ),
      displayId: anchor.displayId,
    };
  }

  if (shape['to'] !== undefined) {
    const from = resolveAnchor(shape['from'], context.world);
    if (isError(from)) return { error: `from: ${from.error}` };
    const to = resolveAnchor(shape['to'], context.world);
    if (isError(to)) return { error: `to: ${to.error}` };
    const displayId = sameDisplay([from, to]);
    if (typeof displayId !== 'number') return { error: displayId.error };
    const rect = {
      x: Math.min(from.point.x, to.point.x),
      y: Math.min(from.point.y, to.point.y),
      width: Math.abs(to.point.x - from.point.x),
      height: Math.abs(to.point.y - from.point.y),
    };
    if (rect.width < 1 || rect.height < 1) {
      return { error: 'from and to are the same place, so there is no box to draw.' };
    }
    return { rect, displayId };
  }

  const centre = resolveAnchor(shape['at'] ?? shape['center'], context.world);
  if (isError(centre)) return { error: BOX_FORMS };

  const radius = number(shape['radius']);
  const halfWidth = number(shape['rx']) ?? radius;
  const halfHeight = number(shape['ry']) ?? radius;
  if (halfWidth === null || halfHeight === null || halfWidth <= 0 || halfHeight <= 0) {
    return { error: BOX_FORMS };
  }
  if (!centre.scale) {
    return {
      error:
        'a size goes with a screenshot anchor, whose pixels it is measured in. ' +
        'For an element, use around instead.',
    };
  }
  const rx = halfWidth * centre.scale.x;
  const ry = halfHeight * centre.scale.y;
  return {
    rect: { x: centre.point.x - rx, y: centre.point.y - ry, width: rx * 2, height: ry * 2 },
    displayId: centre.displayId,
  };
}

/** A label under the lowest point of a set of points. */
export function labelBelow(points: readonly Point[]): Point {
  const lowest = points.reduce((a, b) => (b.y > a.y ? b : a), points[0]!);
  const midX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  return { x: midX, y: lowest.y + 14 };
}

/** A label under a box. */
export function labelUnder(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height + 12 };
}
