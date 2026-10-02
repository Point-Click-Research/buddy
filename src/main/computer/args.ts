// Reading the model's action arguments safely. Every provider validates the
// same loosely-typed JSON, so the checks live here once and a malformed call
// becomes an INVALID_REQUEST the model can correct rather than a thrown error.

import type { DisplayFrames } from './display-capture';
import { computerError, type ComputerError } from './errors';
import type { ObservationRegistry } from './observations';
import type { ActionOutcome, TargetArea } from './provider';

export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A fixed-length array of finite numbers, or null. */
function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  return value.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (value as number[]) : null;
}

export { clamp } from '../coords';
export { setTimeout as sleep } from 'node:timers/promises';

export function invalid(detail: string): ActionOutcome {
  return { error: computerError('INVALID_REQUEST', detail) };
}

export function unsupported(detail: string): ActionOutcome {
  return { error: computerError('UNSUPPORTED_ACTION', detail) };
}

/** A coordinate pair together with the frame it was measured in. */
export type PointRead =
  /** The field wasn't sent; for a click that means "where the cursor is". */
  | { absent: true }
  | { point: [number, number] }
  | { error: ComputerError };

/**
 * Read a coordinate pair and check it against the frame the model says it
 * came from. Coordinates are only meaningful relative to a screenshot, so a
 * pair without a current frame_id is refused rather than acted on.
 */
export function readPoint(
  input: Record<string, unknown>,
  field: string,
  checkFrame: (frameId: unknown) => ComputerError | null,
): PointRead {
  const pair = numbers(input[field], 2);
  if (!pair) {
    return field in input
      ? { error: computerError('INVALID_REQUEST', `${field} must be [x, y] in screenshot pixels.`) }
      : { absent: true };
  }
  const stale = checkFrame(input['frame_id']);
  if (stale) return { error: stale };
  return { point: [pair[0]!, pair[1]!] };
}

/** Read a zoom region and check it against the frame it was measured in. */
export function readRegion(
  input: Record<string, unknown>,
  checkFrame: (frameId: unknown) => ComputerError | null,
): { region: [number, number, number, number] } | { error: ComputerError } {
  const corners = numbers(input['region'], 4);
  if (!corners) {
    return { error: computerError('INVALID_REQUEST', 'zoom needs region: [x0, y0, x1, y1].') };
  }
  const [x0, y0, x1, y1] = corners as [number, number, number, number];
  if (x1 <= x0 || y1 <= y0) {
    return { error: computerError('INVALID_REQUEST', 'The zoom region corners are inverted or empty.') };
  }
  const stale = checkFrame(input['frame_id']);
  if (stale) return { error: stale };
  return { region: [x0, y0, x1, y1] };
}

/**
 * Where an action is about to land, in global screen DIP, so the HUD can
 * show the user before it happens. An element knows its own box; a
 * coordinate is a point in the frame it was measured in. Read-only: this
 * never validates, because an action that is going to be refused should be
 * refused by the provider rather than pre-empted here.
 */
export function locateTarget(
  input: Record<string, unknown>,
  frames: DisplayFrames,
  observations?: ObservationRegistry,
): TargetArea | null {
  if (observations && typeof input['ref'] === 'string') {
    const found = observations.resolve(input['observation_id'], input['ref']);
    if ('error' in found || !found.element.bounds) return null;
    const { x, y, w, h } = found.element.bounds;
    return { x, y, width: w, height: h };
  }
  const pair = numbers(input['coordinate'], 2);
  if (!pair) return null;
  try {
    const point = frames.toScreen(pair[0]!, pair[1]!);
    return { x: point.x, y: point.y, width: 0, height: 0 };
  } catch {
    // No screenshot has been taken yet, so there is nothing to point at.
    return null;
  }
}
