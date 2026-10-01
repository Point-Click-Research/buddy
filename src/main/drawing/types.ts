// The limits Buddy puts on its own drawings, and the shape of a stored one.
//
// The wire format itself lives in shared/drawing.ts, because the overlay
// needs the same definitions. What belongs here is the policy: how much a
// single call may draw, and how long it stays.

import type { DrawCommand } from '../../shared/drawing';

export const MAX_LABEL = 80;
export const MAX_POINTS_PER_SHAPE = 500;
/** Per draw call, across every shape. */
export const MAX_POINTS_PER_CALL = 2_000;
/** Per display, so a response can never bury the screen it is explaining. */
export const MAX_VISIBLE_SHAPES = 40;

/** How long a drawing stays before it fades on its own. */
export const DEFAULT_LIFETIME_MS = 5_000;
/** The ceiling on `persist: true`. */
export const MAX_LIFETIME_MS = 5 * 60_000;

/**
 * A drawing on screen, kept with the call that produced it. update_drawing
 * merges changes into that call and revalidates the whole shape, so an
 * update can never produce geometry a fresh draw would have refused.
 */
export interface StoredShape {
  command: DrawCommand;
  call: Record<string, unknown>;
}
