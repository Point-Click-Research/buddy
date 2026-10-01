// Pure gesture rules for “the user just selected text”.

export interface PointTime {
  x: number;
  y: number;
  t: number;
}

export function isDragSelect(down: PointTime, up: PointTime, minPx = 8): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) >= minPx;
}

export function isDoubleClick(
  prev: PointTime | null,
  up: PointTime,
  maxMs = 400,
  maxPx = 8,
): boolean {
  if (!prev) return false;
  return up.t - prev.t <= maxMs && Math.hypot(up.x - prev.x, up.y - prev.y) <= maxPx;
}
