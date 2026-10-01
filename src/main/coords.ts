// Pure coordinate mapping between a screenshot's pixel space and screen/
// overlay DIP coordinates. Screenshots may be downscaled and displays may
// have any scale factor, so everything maps proportionally through the
// display's DIP bounds. No Electron imports: fully unit-testable.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Map a point in screenshot pixel space to global screen DIP coordinates.
 * The image spans exactly the display's DIP bounds, whatever its pixel size.
 */
export function pixelToDip(
  px: number,
  py: number,
  imageWidth: number,
  imageHeight: number,
  bounds: Rect,
): Point {
  return {
    x: bounds.x + (px / imageWidth) * bounds.width,
    y: bounds.y + (py / imageHeight) * bounds.height,
  };
}

/** Map a global screen DIP point back to screenshot pixels (inverse of pixelToDip). */
export function dipToPixel(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  bounds: Rect,
): Point {
  return {
    x: ((x - bounds.x) / bounds.width) * imageWidth,
    y: ((y - bounds.y) / bounds.height) * imageHeight,
  };
}

/** Map a global DIP point to overlay-local coordinates (origin = display top-left). */
export function dipToOverlayLocal(point: Point, bounds: Rect): Point {
  return { x: point.x - bounds.x, y: point.y - bounds.y };
}

/**
 * Map a screenshot-pixel point straight to overlay-local coordinates,
 * clamped inside the display.
 */
export function pixelToOverlay(
  px: number,
  py: number,
  imageWidth: number,
  imageHeight: number,
  bounds: Rect,
): Point {
  const local = dipToOverlayLocal(pixelToDip(px, py, imageWidth, imageHeight, bounds), bounds);
  return {
    x: clamp(local.x, 0, bounds.width),
    y: clamp(local.y, 0, bounds.height),
  };
}

/** Scale a length (e.g. a radius) from screenshot pixels to DIP. */
export function pixelLengthToDip(length: number, imageWidth: number, bounds: Rect): number {
  return (length / imageWidth) * bounds.width;
}

/**
 * Map a screenshot-pixel rect to an overlay-local rect, clamped to the
 * display so it never draws off-screen.
 */
export function pixelRectToOverlay(
  rect: Rect,
  imageWidth: number,
  imageHeight: number,
  bounds: Rect,
): Rect {
  const topLeft = pixelToOverlay(rect.x, rect.y, imageWidth, imageHeight, bounds);
  const bottomRight = pixelToOverlay(
    rect.x + rect.width,
    rect.y + rect.height,
    imageWidth,
    imageHeight,
    bounds,
  );
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y),
  };
}
