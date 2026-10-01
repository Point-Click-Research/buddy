// The pen: the user's marks (in the overlay) and Buddy's drawings (built in
// main) are inked with the same one, so both read as the same hand.
// perfect-freehand turns the line a pen travelled into the outline of the ink
// it left, swelling where the pen moved slowly and thinning where it moved fast.

import { getStroke } from 'perfect-freehand';
import type { Point, Width } from './drawing';

/** Nib sizes in points. The user's marks draw at medium. */
export const PEN_SIZES: Record<Width, number> = { thin: 4, medium: 6, thick: 10 };

const PEN = { thinning: 0.55, smoothing: 0.5, streamline: 0.4, simulatePressure: true };

/** The filled outline of the ink along these points, as a closed path; empty when too short to have one. */
export function penOutline(points: readonly Point[], size: number): string {
  const outline = getStroke(
    points.map((point) => [point.x, point.y]),
    { size, ...PEN },
  );
  if (outline.length < 3) return '';
  // The outline is a polygon; quadratics through its midpoints keep the edge from looking faceted.
  const parts = [`M ${round(outline[0]![0]!)} ${round(outline[0]![1]!)}`];
  for (let i = 0; i < outline.length; i++) {
    const current = outline[i]!;
    const next = outline[(i + 1) % outline.length]!;
    parts.push(
      `Q ${round(current[0]!)} ${round(current[1]!)} ${round((current[0]! + next[0]!) / 2)} ${round((current[1]! + next[1]!) / 2)}`,
    );
  }
  parts.push('Z');
  return parts.join(' ');
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
