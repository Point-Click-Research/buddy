// Captures a screenshot of every display with the metadata needed to map
// Claude's screenshot-pixel coordinates back onto the screen.

import { createHash } from 'crypto';
import { desktopCapturer, screen } from 'electron';
import { frameStore } from './computer/frame-store';
import { displayGeometry } from './computer/frames';
import { SCREENSHOT_BOX } from './computer/provider';
import { dismissAll } from './drawing/tools';
import { createLogger } from './log';

const log = createLogger('capture');

const JPEG_QUALITY = 80;

export interface ScreenshotMeta {
  displayId: number;
  /** "Screen 1", "Screen 2", … in getAllDisplays() order. */
  label: string;
  /**
   * What a drawing anchors to when it names the screenshot it measured.
   * Set by whoever minted the frame: guide captures do it here, agent
   * captures in DisplayFrames, which owns the staleness rules.
   */
  frameId?: string;
  imageWidth: number;
  imageHeight: number;
  /** Display bounds in DIP (global coordinates). */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isCursorDisplay: boolean;
  /** JPEG bytes, base64-encoded. */
  base64: string;
}

export async function captureAllDisplays(box = SCREENSHOT_BOX): Promise<ScreenshotMeta[]> {
  // Our overlays are content-protected (excluded from capture), but clear
  // anyway: a new request means the last answer's drawings are done, and
  // stale ones on screen would only confuse the user.
  dismissAll();

  const displays = screen.getAllDisplays();
  const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

  // Electron scales each thumbnail to fit this box, preserving aspect ratio.
  // It must stay under what the model's API accepts unresized (about 1.15
  // megapixels for Claude): a larger image is shrunk before the model sees
  // it, and every coordinate it measures then lands short, toward the top left.
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: box });

  const shots: ScreenshotMeta[] = [];
  for (const [index, display] of displays.entries()) {
    // Sources carry the display id as a string; fall back to list order.
    const source =
      sources.find((s) => s.display_id === String(display.id)) ?? sources[index];
    if (!source || source.thumbnail.isEmpty()) continue;

    const size = source.thumbnail.getSize();
    const base64 = source.thumbnail.toJPEG(JPEG_QUALITY).toString('base64');
    shots.push({
      displayId: display.id,
      label: `Screen ${index + 1}`,
      frameId: mintFrame(display, size, base64),
      imageWidth: size.width,
      imageHeight: size.height,
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
      isCursorDisplay: display.id === cursorDisplayId,
      base64,
    });
  }

  if (shots.length === 0) {
    throw new Error('No displays captured — check the Screen Recording permission.');
  }
  log.info(`captured ${shots.length} display(s)`);
  return shots;
}

// --- Agent-mode captures (one display, agent-chosen sizes) --------------------

/** Screenshot one display, scaled to fit the box with its aspect ratio kept. */
export async function captureDisplayShot(
  displayId: number,
  box: { width: number; height: number },
): Promise<ScreenshotMeta> {
  const { display, index, source } = await displaySource(displayId, box);
  const size = source.thumbnail.getSize();
  const base64 = source.thumbnail.toJPEG(JPEG_QUALITY).toString('base64');
  return {
    displayId,
    label: `Screen ${index + 1}`,
    imageWidth: size.width,
    imageHeight: size.height,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    isCursorDisplay: true,
    base64,
  };
}

/** Give a guide-mode screenshot a frameId, so a drawing can anchor in it. */
function mintFrame(
  display: Electron.Display,
  size: { width: number; height: number },
  base64: string,
): string {
  return mintGuideFrame({
    displayId: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    imageWidth: size.width,
    imageHeight: size.height,
    base64,
  });
}

/**
 * The same, for a screenshot already captured (a user-mark shot): coordinates
 * measured in it can then anchor drawings and be reported to the model.
 */
export function mintGuideFrame(
  shot: Pick<ScreenshotMeta, 'displayId' | 'bounds' | 'scaleFactor' | 'imageWidth' | 'imageHeight' | 'base64'>,
): string {
  return frameStore.mint({
    displayId: shot.displayId,
    geometry: displayGeometry(shot.bounds, shot.scaleFactor),
    width: shot.imageWidth,
    height: shot.imageHeight,
    hash: createHash('sha1').update(shot.base64).digest('hex'),
  }).frame.frameId;
}

/**
 * One display at its full pixel resolution, as PNG. This is what OCR reads:
 * the downscaled JPEG the model sees blurs small text past recognizing.
 */
export async function captureDisplayPng(displayId: number): Promise<Buffer> {
  const { source } = await displaySource(displayId, displayPixelSize(displayId));
  return source.thumbnail.toPNG();
}

/**
 * The computer tool's zoom: capture a display-relative DIP region at the
 * display's full resolution, scaled to fit the box. Lets the model read
 * text that is illegible in the downscaled full screenshot.
 */
export async function captureDisplayZoom(
  displayId: number,
  region: { x: number; y: number; width: number; height: number },
  box: { width: number; height: number },
): Promise<{ base64: string; width: number; height: number }> {
  const { display, source } = await displaySource(displayId, displayPixelSize(displayId));
  const size = source.thumbnail.getSize();
  // The thumbnail may not be exactly the requested size; derive px-per-DIP.
  const scaleX = size.width / display.bounds.width;
  const scaleY = size.height / display.bounds.height;
  const crop = source.thumbnail.crop({
    x: Math.max(0, Math.round(region.x * scaleX)),
    y: Math.max(0, Math.round(region.y * scaleY)),
    width: Math.max(1, Math.round(region.width * scaleX)),
    height: Math.max(1, Math.round(region.height * scaleY)),
  });
  const cropSize = crop.getSize();
  const fit = Math.min(box.width / cropSize.width, box.height / cropSize.height, 1);
  const resized = fit < 1 ? crop.resize({ width: Math.round(cropSize.width * fit) }) : crop;
  const finalSize = resized.getSize();
  return {
    base64: resized.toJPEG(JPEG_QUALITY).toString('base64'),
    width: finalSize.width,
    height: finalSize.height,
  };
}

function displayPixelSize(displayId: number): { width: number; height: number } {
  const display = screen.getAllDisplays().find((d) => d.id === displayId);
  if (!display) throw new Error(`Display ${displayId} not found.`);
  return {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

async function displaySource(
  displayId: number,
  thumbnailSize: { width: number; height: number },
): Promise<{ display: Electron.Display; index: number; source: Electron.DesktopCapturerSource }> {
  const displays = screen.getAllDisplays();
  const index = displays.findIndex((d) => d.id === displayId);
  const display = displays[index];
  if (!display) throw new Error(`Display ${displayId} not found.`);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
  const source = sources.find((s) => s.display_id === String(displayId)) ?? sources[index];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Screen capture failed — check the Screen Recording permission.');
  }
  return { display, index, source };
}
