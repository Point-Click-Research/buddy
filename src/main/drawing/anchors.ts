// Resolving "where" into overlay coordinates.
//
// The model has three ways to name a place: a point in a screenshot it
// measured, an element it read from a window, or one of the user's own marks.
// All three land here and come out as a point on one display, because a shape
// can only be drawn on a single display and every part of it has to agree
// about which. A place described in words ({element: "the Reload button"})
// is bound to an element ref before any of this runs (bindDescribed).
//
// Pure module: the lookups are injected, so this is fully unit-testable.

import { ANCHOR_POINTS, type AnchorPoint, type Point } from '../../shared/drawing';
import { clamp, dipToOverlayLocal, pixelToDip, type Rect } from '../coords';

/** A screenshot the model may have measured in. */
export interface FrameInfo {
  displayId: number;
  imageWidth: number;
  imageHeight: number;
  bounds: Rect;
}

/** An element's box, with the display it was found on. */
export interface ElementBox {
  displayId: number;
  /** The element's box in global screen DIP. */
  rect: Rect;
  /** That display's bounds in global DIP, so the box can be made local. */
  display: Rect;
}

/** What the drawing layer needs to look things up, supplied by the caller. */
export interface AnchorWorld {
  frame(frameId: unknown): FrameInfo | null;
  /** Null when no provider can give element bounds, or the ref is stale. */
  element(observationId: unknown, ref: unknown): ElementBox | null;
  /** The user's marks from this turn; empty until Milestone 10. */
  mark(number: unknown): ElementBox | null;
}

/** A point on one display, in that display's overlay-local coordinates. */
export interface Anchored {
  displayId: number;
  point: Point;
  /** The whole box, when the anchor named an element or a region. */
  box?: Rect;
  /**
   * Display points per screenshot pixel, when this came from a screenshot.
   * It lets a size the model measured in that image — a radius, a width —
   * be scaled the same way its position was.
   */
  scale?: Point;
}

export type AnchorResult = Anchored | { error: string };

export function isError(result: AnchorResult): result is { error: string } {
  return 'error' in result;
}

/**
 * Resolve one anchor. The shapes of anchor the model may send are:
 *   { x, y, frameId }                     a point in a screenshot
 *   { ref, observationId, at?, offset? }  a place on an element
 *   { mark, at? }                         a place on one of the user's marks
 */
export function resolveAnchor(value: unknown, world: AnchorWorld): AnchorResult {
  if (typeof value !== 'object' || value === null) {
    return { error: 'An anchor must be {x, y, frameId}, {ref, observationId} or {mark}.' };
  }
  const anchor = value as Record<string, unknown>;

  if ('element' in anchor) {
    return { error: 'Describing an element in words is not available here. Anchor to a ref or to coordinates.' };
  }

  if ('ref' in anchor || 'observationId' in anchor) {
    const element = world.element(anchor['observationId'], anchor['ref']);
    if (!element) {
      return {
        error:
          `No element ${String(anchor['ref'])} in observation ${String(anchor['observationId'])}. ` +
          'Read the window again and anchor to a ref from the new observation.',
      };
    }
    return onBox(element, anchor);
  }

  if ('mark' in anchor) {
    const mark = world.mark(anchor['mark']);
    if (!mark) {
      return { error: `There is no mark ${String(anchor['mark'])} in this turn.` };
    }
    return onBox(mark, anchor);
  }

  const x = finite(anchor['x']);
  const y = finite(anchor['y']);
  if (x === null || y === null) {
    return { error: 'A screenshot anchor needs numeric x and y.' };
  }
  const frame = world.frame(anchor['frameId']);
  if (!frame) {
    return {
      error: `frameId ${String(anchor['frameId'])} is not a screenshot I can place coordinates in. ` +
        'Use the frame_id from the most recent screenshot.',
    };
  }
  const dip = pixelToDip(x, y, frame.imageWidth, frame.imageHeight, frame.bounds);
  return {
    displayId: frame.displayId,
    point: inside(dipToOverlayLocal(dip, frame.bounds), frame.bounds),
    scale: {
      x: frame.bounds.width / frame.imageWidth,
      y: frame.bounds.height / frame.imageHeight,
    },
  };
}

/** The window a described anchor is looked for in: the front one unless the model named another. */
export interface DescribedWindow {
  pid?: number;
  windowId?: number;
}

/** Each description found in one window, in order, as the ref it is or why it is not one. */
export type DescribeElements = (
  window: DescribedWindow,
  wanted: readonly string[],
) => Promise<Array<{ observationId: string; ref: string } | { error: string }>>;

/** Every {element: "…"} object in a call, wherever it sits. */
function describedIn(value: unknown, found: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const entry of value) describedIn(entry, found);
    return found;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['element'] === 'string') found.push(record);
  else for (const child of Object.values(record)) describedIn(child, found);
  return found;
}

/**
 * Swap each {element: "the Reload button"} anchor for the {ref, observationId}
 * it names, so validation, following and retargeting all see an ordinary
 * element anchor. Each window is read once for all of its descriptions:
 * reading it again would kill the refs the first read gave. The call is
 * copied, never changed, and nothing is drawn unless every description binds.
 */
export async function bindDescribed(
  call: Record<string, unknown>,
  describe: DescribeElements | undefined,
): Promise<{ call: Record<string, unknown> } | { error: string }> {
  const copy = structuredClone(call);
  const anchors = describedIn(copy);
  if (anchors.length === 0) return { call };
  if (!describe) {
    return { error: 'Describing an element in words is not available here. Anchor to a ref or to coordinates.' };
  }
  const byWindow = new Map<string, Array<Record<string, unknown>>>();
  for (const anchor of anchors) {
    const key = `${String(anchor['pid'])}:${String(anchor['window_id'])}`;
    byWindow.set(key, [...(byWindow.get(key) ?? []), anchor]);
  }
  const errors: string[] = [];
  for (const group of byWindow.values()) {
    const pid = finite(group[0]!['pid']) ?? undefined;
    const windowId = finite(group[0]!['window_id']) ?? undefined;
    const found = await describe({ pid, windowId }, group.map((anchor) => String(anchor['element'])));
    group.forEach((anchor, i) => {
      const hit = found[i];
      if (!hit || 'error' in hit) {
        errors.push(hit?.error ?? `"${String(anchor['element'])}" was not found.`);
        return;
      }
      delete anchor['element'];
      delete anchor['pid'];
      delete anchor['window_id'];
      anchor['ref'] = hit.ref;
      anchor['observationId'] = hit.observationId;
    });
  }
  return errors.length > 0 ? { error: errors.join('\n') } : { call: copy };
}

/** Shapes that enclose one thing, where a measured guess is visibly off. */
const ENCLOSING = new Set(['ellipse', 'rect', 'spotlight']);

/** A shape placed by a point measured in the screenshot, rather than on an element or mark. */
function measured(shape: Record<string, unknown>): boolean {
  const around = shape['around'];
  if (around && typeof around === 'object' && !('x' in around)) return false;
  return ['around', 'at', 'from', 'to'].some((key) => {
    const anchor = shape[key];
    return Boolean(anchor && typeof anchor === 'object' && 'x' in anchor);
  });
}

/**
 * A ring, box or spotlight placed by measured coordinates must say what it
 * is on (`what`), and is aimed at that thing instead: a chat model's estimate
 * of where a smile is in a photo lands far off, but the smile can be found.
 * `fallback` is the call as sent, drawn when the thing cannot be found.
 */
export function aimAtNamed(
  call: Record<string, unknown>,
): { call: Record<string, unknown>; fallback: Record<string, unknown> | null } | { error: string } {
  const shapes = Array.isArray(call['shapes']) ? (call['shapes'] as unknown[]) : [];
  let aimed = false;
  const next = shapes.map((raw, index) => {
    if (!raw || typeof raw !== 'object') return raw;
    const shape = raw as Record<string, unknown>;
    if (!ENCLOSING.has(String(shape['type'])) || !measured(shape)) return shape;
    const what = typeof shape['what'] === 'string' ? shape['what'].trim() : '';
    if (!what) {
      return new Error(
        `shape ${index + 1}: say what this ${String(shape['type'])} is on, in words, and Buddy fits it there: ` +
          '"what": "the person\'s smile". Or use around: {"element": "…"}.',
      );
    }
    aimed = true;
    return { ...shape, around: { element: what } };
  });
  const refused = next.find((shape): shape is Error => shape instanceof Error);
  if (refused) return { error: refused.message };
  return aimed ? { call: { ...call, shapes: next }, fallback: call } : { call, fallback: null };
}

/** A point on an element or mark box, with the optional side and offset. */
function onBox(box: ElementBox, anchor: Record<string, unknown>): AnchorResult {
  const at = anchor['at'] ?? 'center';
  if (typeof at !== 'string' || !ANCHOR_POINTS.includes(at as AnchorPoint)) {
    return { error: `at must be one of: ${ANCHOR_POINTS.join(', ')}.` };
  }
  const offset = anchor['offset'];
  let dx = 0;
  let dy = 0;
  if (offset !== undefined) {
    if (typeof offset !== 'object' || offset === null) return { error: 'offset must be {x, y}.' };
    dx = finite((offset as Record<string, unknown>)['x']) ?? 0;
    dy = finite((offset as Record<string, unknown>)['y']) ?? 0;
  }

  const display = box.display;
  const point = pointOn(box.rect, at as AnchorPoint);
  const local = dipToOverlayLocal({ x: point.x + dx, y: point.y + dy }, display);
  return {
    displayId: box.displayId,
    point: inside(local, display),
    box: {
      x: box.rect.x - display.x,
      y: box.rect.y - display.y,
      width: box.rect.width,
      height: box.rect.height,
    },
  };
}

/** Which point of a box a side name refers to. */
export function pointOn(rect: Rect, at: AnchorPoint): Point {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const midX = rect.x + rect.width / 2;
  const midY = rect.y + rect.height / 2;
  switch (at) {
    case 'top':
      return { x: midX, y: top };
    case 'bottom':
      return { x: midX, y: bottom };
    case 'left':
      return { x: left, y: midY };
    case 'right':
      return { x: right, y: midY };
    case 'top_left':
      return { x: left, y: top };
    case 'top_right':
      return { x: right, y: top };
    case 'bottom_left':
      return { x: left, y: bottom };
    case 'bottom_right':
      return { x: right, y: bottom };
    default:
      return { x: midX, y: midY };
  }
}

/**
 * Every anchor in one shape must land on the same display: an SVG overlay
 * covers one screen, so a line between two of them cannot be drawn.
 */
export function sameDisplay(anchors: readonly Anchored[]): number | { error: string } {
  const first = anchors[0];
  if (!first) return { error: 'This shape has no anchors.' };
  return anchors.every((anchor) => anchor.displayId === first.displayId)
    ? first.displayId
    : { error: 'A shape cannot span two displays; keep all of its anchors on one screen.' };
}

function inside(point: Point, bounds: Rect): Point {
  return { x: clamp(point.x, 0, bounds.width), y: clamp(point.y, 0, bounds.height) };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
