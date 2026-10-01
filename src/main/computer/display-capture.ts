// Capturing one display and mapping coordinates in and out of it. Both
// providers observe through this, so the model works in a single pixel
// space no matter which one is driving: the delivered screenshot's pixels.
// Buddy's overlays are content-protected, so drawings never appear here.

import { createHash } from 'crypto';
import { screen } from 'electron';
import { captureDisplayShot, captureDisplayZoom, type ScreenshotMeta } from '../capture';
import { dipToPixel, pixelToDip } from '../coords';
import type { ComputerError } from './errors';
import { frameStore } from './frame-store';
import { displayGeometry } from './frames';
import { SCREENSHOT_BOX, type Point2D, type ScreenObservation } from './provider';

export interface DisplayFrames {
  /** Capture the display and make it the frame coordinates refer to. */
  screenshot(): Promise<ScreenObservation>;
  /** Magnify a region of the current frame at the display's full resolution. */
  zoom(region: [number, number, number, number]): Promise<ScreenObservation>;
  /**
   * Whether a frameId the model sent is still good for a coordinate action.
   * Returns the error to hand back, or null.
   */
  checkFrame(frameId: unknown): ComputerError | null;
  /** Frame pixels -> global screen DIP. */
  toScreen(x: number, y: number): Point2D;
  /** Global screen DIP -> frame pixels. */
  toImage(point: Point2D): Point2D;
  /**
   * Frame pixels -> the display's own native pixels, for drivers that
   * address the desktop in its true resolution rather than our downscale.
   */
  toNative(x: number, y: number): Point2D;
}

export function createDisplayFrames(displayId: number): DisplayFrames {
  // The app-wide registry: a frameId has to mean one screenshot everywhere,
  // because drawings anchor to it by name.
  const frames = frameStore;
  let last: ScreenshotMeta | null = null;

  /** The screenshot the model's coordinates refer to. */
  const frame = (): ScreenshotMeta => {
    if (!last) throw new Error('No screenshot has been taken on this display yet.');
    return last;
  };

  /** This display's shape right now, which frames are validated against. */
  const geometryNow = (): string => {
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    return display ? displayGeometry(display.bounds, display.scaleFactor) : 'unknown';
  };

  return {
    async screenshot(): Promise<ScreenObservation> {
      const shot = await captureDisplayShot(displayId, SCREENSHOT_BOX);
      last = shot;
      const { frame: meta, unchanged } = frames.mint({
        displayId,
        geometry: displayGeometry(shot.bounds, shot.scaleFactor),
        width: shot.imageWidth,
        height: shot.imageHeight,
        hash: createHash('sha1').update(shot.base64).digest('hex'),
      });
      // An identical screen is reported as such instead of resending the same
      // image: screenshots dominate the context, and a duplicate adds nothing.
      if (unchanged) {
        return { kind: 'screen', frameId: meta.frameId, width: meta.width, height: meta.height, unchanged: true };
      }
      return {
        kind: 'screen',
        frameId: meta.frameId,
        width: shot.imageWidth,
        height: shot.imageHeight,
        base64: shot.base64,
      };
    },

    checkFrame(frameId) {
      return frames.check(frameId, displayId, geometryNow());
    },

    async zoom([x0, y0, x1, y1]): Promise<ScreenObservation> {
      // Region corners are in the frame's pixel space -> display-local DIP.
      const { imageWidth, imageHeight, bounds } = frame();
      const topLeft = pixelToDip(x0, y0, imageWidth, imageHeight, bounds);
      const bottomRight = pixelToDip(x1, y1, imageWidth, imageHeight, bounds);
      const zoomed = await captureDisplayZoom(
        displayId,
        {
          x: topLeft.x - bounds.x,
          y: topLeft.y - bounds.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y,
        },
        SCREENSHOT_BOX,
      );
      // A zoom is extra detail on the frame it was cropped from, not a new
      // one: coordinates still belong to the full screenshot, so it carries
      // that frame's id rather than minting one of its own.
      return {
        kind: 'screen',
        frameId: frames.latest(displayId)?.frameId ?? '',
        base64: zoomed.base64,
        width: zoomed.width,
        height: zoomed.height,
      };
    },

    toScreen(x, y) {
      const { imageWidth, imageHeight, bounds } = frame();
      return pixelToDip(x, y, imageWidth, imageHeight, bounds);
    },

    toImage(point) {
      const { imageWidth, imageHeight, bounds } = frame();
      return dipToPixel(point.x, point.y, imageWidth, imageHeight, bounds);
    },

    toNative(x, y) {
      const { imageWidth, imageHeight, scaleFactor, bounds } = frame();
      const scale = (bounds.width * scaleFactor) / imageWidth;
      return { x: x * scale, y: y * ((bounds.height * scaleFactor) / imageHeight) };
    },
  };
}

/** Cua drives the primary display only, so tasks elsewhere need the fallback. */
export function isPrimaryDisplay(displayId: number): boolean {
  return screen.getPrimaryDisplay().id === displayId;
}
