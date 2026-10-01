// The point tool: where the buddy dot flies when Buddy refers to something.
//
// This is the one v1 annotation still standing — circles, arrows and
// highlights became the draw tool. A point can be said two ways: an element
// ref from read_window, which lands exactly on the control, or a place
// measured in a screenshot, which is an estimate. Refs win whenever they
// exist, because "a bit off" is very visible on something 28 points tall.
//
// Pure module: the element lookup is injected, so this is unit-testable.

import type { Annotation } from '../shared/types';
import type { ScreenshotMeta } from './capture';
import type { Rect } from './coords';
import { dipToOverlayLocal, pixelToOverlay } from './coords';
import { toolArgs } from './ai/tools';

const MAX_LABEL_LENGTH = 60;

export interface DisplayAnnotation {
  displayId: number;
  annotation: Annotation;
}

/** An element's box in global screen DIP, from whoever has read windows. */
export type ElementBoxLookup = (
  observationId: unknown,
  ref: unknown,
) => { displayId: number; rect: Rect } | null;

let nextId = 0;

/**
 * Validate and convert one point call. Returns the annotation, or the
 * sentence that tells the model what to fix.
 */
export function pointAnnotation(
  input: unknown,
  screenshots: ScreenshotMeta[],
  element?: ElementBoxLookup,
): DisplayAnnotation | { error: string } {
  const args = toolArgs(input);
  const label = str(args['label']).slice(0, MAX_LABEL_LENGTH);
  const id = `ann-${nextId++}`;

  // An element ref is exact, so it takes precedence over any coordinates.
  if (args['ref'] !== undefined || args['observation_id'] !== undefined) {
    const found = element?.(args['observation_id'], args['ref']);
    if (!found) {
      return {
        error:
          'That ref is not from a current read_window observation. Read the window again and ' +
          'use a ref it returns, or send screen coordinates instead.',
      };
    }
    const shot = screenshots.find((candidate) => candidate.displayId === found.displayId);
    if (!shot) return { error: 'That element is on a screen that was not captured.' };
    const centre = dipToOverlayLocal(
      { x: found.rect.x + found.rect.width / 2, y: found.rect.y + found.rect.height / 2 },
      shot.bounds,
    );
    return { displayId: found.displayId, annotation: { id, kind: 'point', ...centre, label } };
  }

  // Screens are numbered 1..n matching the "Screen 1" labels sent to the
  // model. A missing number falls back to the cursor's display; an
  // explicitly wrong one is refused.
  const screenNumber = num(args['screen']);
  const shot =
    screenNumber === null
      ? (screenshots.find((s) => s.isCursorDisplay) ?? screenshots[0])
      : screenshots[screenNumber - 1];
  if (!shot) return { error: `There is no screen ${String(args['screen'])}.` };

  const x = num(args['x']);
  const y = num(args['y']);
  if (x === null || y === null) {
    return { error: 'point needs a ref from read_window, or numeric x and y in screenshot pixels.' };
  }
  const place = pixelToOverlay(x, y, shot.imageWidth, shot.imageHeight, shot.bounds);
  return { displayId: shot.displayId, annotation: { id, kind: 'point', ...place, label } };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
