// Where a mark's pieces land: the numbered badge next to the mark, and the
// close-up crop around it. Pure math, unit-tested; no Electron imports.

import type { Rect, StrokePoint } from './classify';

/** The badge circle's radius, matched by the overlay renderer and images.ts. */
export const BADGE_RADIUS = 11;

/** How far outside the mark's corner the badge sits. */
const BADGE_OFFSET = 10;

/**
 * The numbered badge sits just outside the mark's top-right corner, pulled
 * back inside the display when the mark touches an edge.
 */
export function badgePosition(
  bounds: Rect,
  display: { width: number; height: number },
): StrokePoint {
  const x = bounds.x + bounds.width + BADGE_OFFSET;
  const y = bounds.y - BADGE_OFFSET;
  return {
    x: clamp(x, BADGE_RADIUS + 2, display.width - BADGE_RADIUS - 2),
    y: clamp(y, BADGE_RADIUS + 2, display.height - BADGE_RADIUS - 2),
  };
}

/** Padding around a close-up crop, relative to the mark's larger side. */
const CROP_PAD = 0.15;

/** Small marks still deserve context around them (pixels). */
const CROP_PAD_MIN = 24;

/**
 * The close-up crop around a mark: the mark's bounds plus ~15% padding,
 * clamped to the image. Everything in the image's pixel space; the result
 * has integer edges and is never empty.
 */
export function cropRect(bounds: Rect, image: { width: number; height: number }): Rect {
  const pad = Math.max(CROP_PAD * Math.max(bounds.width, bounds.height), CROP_PAD_MIN);
  const left = clamp(Math.floor(bounds.x - pad), 0, Math.max(0, image.width - 1));
  const top = clamp(Math.floor(bounds.y - pad), 0, Math.max(0, image.height - 1));
  const right = clamp(Math.ceil(bounds.x + bounds.width + pad), left + 1, image.width);
  const bottom = clamp(Math.ceil(bounds.y + bounds.height + pad), top + 1, image.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
