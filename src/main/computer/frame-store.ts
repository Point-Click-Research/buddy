// One frame registry for the whole app.
//
// A frameId is the name the model uses for a screenshot, and it has to mean
// the same thing everywhere: a drawing anchored in "f7" must resolve to the
// screenshot the model measured, whether that came from a guide-mode capture
// or from an agent task. Per-provider registries would each start at f1 and
// quietly disagree.

import { screen } from 'electron';
import { FrameRegistry, type FrameMeta } from './frames';

export const frameStore = new FrameRegistry();

/** A frame plus the display it belongs to, for mapping coordinates out of it. */
export interface ResolvedFrame extends FrameMeta {
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Look up a frame the model named, together with its display's current
 * bounds. Null when the id is unknown or its display has gone away.
 */
export function resolveFrame(frameId: unknown): ResolvedFrame | null {
  const frame = frameStore.find(frameId);
  if (!frame) return null;
  const display = screen.getAllDisplays().find((d) => d.id === frame.displayId);
  return display ? { ...frame, bounds: display.bounds } : null;
}
