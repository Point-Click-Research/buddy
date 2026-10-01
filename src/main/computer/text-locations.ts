// Where located text lives between a locate_text call and the drawing that
// anchors to it. The ObservationRegistry owns window elements, whose identity
// comes from the driver; an OCR match has no window or driver token, so it
// gets its own registry with the same contract — an observationId, short refs
// (t1, t2, …), and a lookup shaped like the anchor path's element lookup.
//
// Pure module: no Electron imports, fully unit-testable.

import type { Rect } from '../coords';
import type { OcrMatch } from '../reader/ocr';

export interface LocatedText {
  ref: string;
  /** The full recognized line the match sits in. */
  line: string;
  /** The match's box in global screen DIP. */
  rect: Rect;
  displayId: number;
}

export interface TextObservation {
  observationId: string;
  matches: LocatedText[];
}

/**
 * How many locate_text results stay resolvable. Old boxes describe where the
 * text was, not where it is, so they are let go rather than kept true — a
 * model that wants to mark old text again can locate it again.
 */
const MAX_OBSERVATIONS = 8;

export class TextLocationRegistry {
  private byId = new Map<string, TextObservation>();
  private nextId = 0;

  /**
   * Record one locate_text call's matches. They arrive normalized to the
   * image (0..1, origin top-left); the image spans the display exactly, so
   * they leave as global screen DIP.
   */
  record(matches: readonly OcrMatch[], display: { id: number; bounds: Rect }): TextObservation {
    const observation: TextObservation = {
      observationId: `text-${++this.nextId}`,
      matches: matches.map((match, index) => ({
        ref: `t${index + 1}`,
        line: match.line,
        displayId: display.id,
        rect: {
          x: display.bounds.x + match.x * display.bounds.width,
          y: display.bounds.y + match.y * display.bounds.height,
          width: match.w * display.bounds.width,
          height: match.h * display.bounds.height,
        },
      })),
    };
    this.byId.set(observation.observationId, observation);
    while (this.byId.size > MAX_OBSERVATIONS) {
      this.byId.delete(this.byId.keys().next().value as string);
    }
    return observation;
  }

  /**
   * Resolve a ref, in the shape the drawing layer's element lookup wants.
   * Null when the ids aren't ours, so a caller can fall through to the
   * window element registry.
   */
  box(observationId: unknown, ref: unknown): { displayId: number; rect: Rect } | null {
    if (typeof observationId !== 'string' || typeof ref !== 'string') return null;
    const match = this.byId.get(observationId)?.matches.find((entry) => entry.ref === ref);
    return match ? { displayId: match.displayId, rect: match.rect } : null;
  }
}
