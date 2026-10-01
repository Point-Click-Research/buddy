// Frame identity and freshness. Every screenshot Buddy delivers is stamped
// with a frameId and the display's shape at capture time, and a coordinate
// action has to name the frame it was measured against. A frame that is no
// longer the latest for its display — or whose display has since changed
// shape — is refused, rather than clicked blindly at whatever moved there.
//
// Pure module: the image hash is supplied by the caller, so this has no
// Electron or Node dependencies and is fully unit-testable.

import { computerError, type ComputerError } from './errors';

export interface FrameMeta {
  frameId: string;
  displayId: number;
  /** The display's shape when this frame was captured (see displayGeometry). */
  geometry: string;
  /** The delivered image size; the model's coordinates are in this space. */
  width: number;
  height: number;
}

export interface Capture {
  displayId: number;
  geometry: string;
  width: number;
  height: number;
  /** A hash of the delivered image bytes, for the unchanged check. */
  hash: string;
}

export interface MintedFrame {
  frame: FrameMeta;
  /**
   * The pixels are identical to the frame already in the model's context, so
   * the image isn't worth sending again. `frame` is that previous frame,
   * which stays valid — minting a new id would invalidate coordinates the
   * model already holds, for no reason.
   */
  unchanged: boolean;
}

/**
 * A display's identity for frame purposes: the same screen at a different
 * size or scale is a different surface, and old coordinates don't apply.
 */
export function displayGeometry(
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
): string {
  return `${bounds.x},${bounds.y},${bounds.width}x${bounds.height}@${scaleFactor}`;
}

/**
 * How many past frames stay resolvable. Coordinates must come from the
 * latest frame, but a drawing may be anchored in one the model saw a moment
 * ago, so a few are kept addressable.
 */
const REMEMBERED = 8;

export class FrameRegistry {
  private latestByDisplay = new Map<number, { frame: FrameMeta; hash: string }>();
  private byId = new Map<string, FrameMeta>();
  private counter = 0;

  /** A frame by the id the model quotes, if it is still remembered. */
  find(frameId: unknown): FrameMeta | null {
    return typeof frameId === 'string' ? (this.byId.get(frameId) ?? null) : null;
  }

  /** Record a capture and get the frame the model should refer to. */
  mint(capture: Capture): MintedFrame {
    const previous = this.latestByDisplay.get(capture.displayId);
    if (
      previous &&
      previous.hash === capture.hash &&
      previous.frame.geometry === capture.geometry
    ) {
      return { frame: previous.frame, unchanged: true };
    }
    const frame: FrameMeta = {
      frameId: `f${++this.counter}`,
      displayId: capture.displayId,
      geometry: capture.geometry,
      width: capture.width,
      height: capture.height,
    };
    this.latestByDisplay.set(capture.displayId, { frame, hash: capture.hash });
    this.byId.set(frame.frameId, frame);
    if (this.byId.size > REMEMBERED) {
      this.byId.delete(this.byId.keys().next().value as string);
    }
    return { frame, unchanged: false };
  }

  latest(displayId: number): FrameMeta | null {
    return this.latestByDisplay.get(displayId)?.frame ?? null;
  }

  /**
   * Whether a frameId the model sent may be used for a coordinate action on
   * this display. Returns the error to hand back, or null when it's good.
   */
  check(frameId: unknown, displayId: number, geometry: string): ComputerError | null {
    const current = this.latestByDisplay.get(displayId);
    if (!current) {
      return computerError('STALE_FRAME', 'No screenshot has been taken on this display yet.');
    }
    const latest = current.frame.frameId;
    if (typeof frameId !== 'string' || !frameId) {
      return computerError(
        'INVALID_REQUEST',
        `Coordinates need the frame_id they were measured in. If that was the latest screenshot, ` +
          `resend this same action with "frame_id": "${latest}"; do not take another screenshot first.`,
      );
    }
    if (frameId !== latest) {
      return computerError('STALE_FRAME', `Frame ${frameId} is no longer current; the latest is ${latest}.`);
    }
    if (geometry !== current.frame.geometry) {
      return computerError('STALE_FRAME', `The display changed shape since frame ${frameId} was captured.`);
    }
    return null;
  }
}
