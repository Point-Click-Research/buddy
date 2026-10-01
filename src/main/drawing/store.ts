// What is drawn on each display right now.
//
// The model can come back to a shape later — move it, restyle it, erase it —
// so drawings need identity and a lifetime rather than being fired and
// forgotten. Each is kept with the call that produced it, so an update can
// be revalidated from scratch instead of patched blind.
//
// Pure module: it holds state but touches nothing outside itself, so the
// eviction and lifetime rules are unit-testable.

import type { DrawCommand } from '../../shared/drawing';
import { MAX_VISIBLE_SHAPES, type StoredShape } from './types';

export class DrawingStore {
  private byDisplay = new Map<number, StoredShape[]>();
  private counter = 0;

  /** An id for a shape the model didn't name. */
  nextId(): string {
    return `d${++this.counter}`;
  }

  /** What one display should be showing, oldest first. */
  on(displayId: number): DrawCommand[] {
    return (this.byDisplay.get(displayId) ?? []).map((shape) => shape.command);
  }

  displays(): number[] {
    return [...this.byDisplay.keys()];
  }

  /**
   * The shapes anchored to elements, which are the ones that can follow
   * their element around. Anchors live in the original call, so that is
   * where a ref shows up.
   */
  elementAnchored(): Array<{ shape: StoredShape; displayId: number }> {
    const anchored: Array<{ shape: StoredShape; displayId: number }> = [];
    for (const [displayId, shapes] of this.byDisplay) {
      for (const shape of shapes) {
        if (JSON.stringify(shape.call).includes('"ref"')) anchored.push({ shape, displayId });
      }
    }
    return anchored;
  }

  /** One shape by id, with the display it lives on and the call that drew it. */
  find(id: string): { shape: StoredShape; displayId: number } | null {
    for (const [displayId, shapes] of this.byDisplay) {
      const shape = shapes.find((candidate) => candidate.command.id === id);
      if (shape) return { shape, displayId };
    }
    return null;
  }

  /**
   * Add shapes to a display. A shape reusing an existing id replaces it, so
   * the model can redraw one thing without disturbing the rest. Past the
   * per-display ceiling the oldest go, because the newest are what Buddy is
   * talking about now.
   */
  add(displayId: number, shapes: readonly StoredShape[]): void {
    const kept = (this.byDisplay.get(displayId) ?? []).filter(
      (existing) => !shapes.some((shape) => shape.command.id === existing.command.id),
    );
    this.byDisplay.set(displayId, [...kept, ...shapes].slice(-MAX_VISIBLE_SHAPES));
  }

  /** Drop everything on one display, or everywhere. */
  clear(displayId?: number): void {
    if (displayId === undefined) this.byDisplay.clear();
    else this.byDisplay.delete(displayId);
  }

  /** Remove shapes by id. Returns the displays that changed. */
  erase(ids: readonly string[]): number[] {
    return this.removeWhere((shape) => ids.includes(shape.command.id));
  }

  /**
   * Drop drawings whose time is up. Returns the displays that changed, so
   * only those need redrawing.
   */
  expire(now: number): number[] {
    return this.removeWhere((shape) => shape.command.expiresAt <= now);
  }

  private removeWhere(doomed: (shape: StoredShape) => boolean): number[] {
    const changed: number[] = [];
    for (const [displayId, shapes] of this.byDisplay) {
      const next = shapes.filter((shape) => !doomed(shape));
      if (next.length === shapes.length) continue;
      this.byDisplay.set(displayId, next);
      changed.push(displayId);
    }
    return changed;
  }
}
