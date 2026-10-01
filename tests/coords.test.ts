import { describe, expect, it } from 'vitest';
import { SCREENSHOT_BOX } from '../src/main/computer/provider';
import {
  pixelLengthToDip,
  pixelRectToOverlay,
  pixelToDip,
  pixelToOverlay,
  type Rect,
} from '../src/main/coords';

// A screenshot the API shrinks before the model sees it gets coordinates back
// in the smaller image: a 1568x1013 shot put a ring ~15% short, toward the top left.
describe('the screenshot box', () => {
  it('fits every common display shape under the size Claude reads unresized', () => {
    for (const [width, height] of [[1728, 1117], [1512, 982], [1920, 1080], [2560, 1440], [1440, 900]] as const) {
      const fit = Math.min(SCREENSHOT_BOX.width / width, SCREENSHOT_BOX.height / height, 1);
      expect(Math.round(width * fit) * Math.round(height * fit)).toBeLessThanOrEqual(1_150_000);
      expect(Math.max(width, height) * fit).toBeLessThanOrEqual(1568);
    }
  });
});

// A 1x display where the screenshot is the same size as the display.
const plain: Rect = { x: 0, y: 0, width: 1512, height: 982 };

// A 2x retina display: physical 3024x1964, downscaled to 1568px wide.
const retinaImage = { width: 1568, height: 1018 };
const retinaBounds: Rect = { x: 0, y: 0, width: 1512, height: 982 };

// A secondary display positioned to the right of the primary.
const secondary: Rect = { x: 1512, y: 100, width: 1920, height: 1080 };

describe('pixelToDip', () => {
  it('is identity when image size equals DIP bounds at origin', () => {
    expect(pixelToDip(500, 300, 1512, 982, plain)).toEqual({ x: 500, y: 300 });
  });

  it('scales proportionally for downscaled retina screenshots', () => {
    const dip = pixelToDip(784, 509, retinaImage.width, retinaImage.height, retinaBounds);
    expect(dip.x).toBeCloseTo(756, 0); // center of image -> center of display
    expect(dip.y).toBeCloseTo(491, 0);
  });

  it('offsets into a secondary display global position', () => {
    const dip = pixelToDip(0, 0, 1920, 1080, secondary);
    expect(dip).toEqual({ x: 1512, y: 100 });
  });
});

describe('pixelToOverlay', () => {
  it('produces overlay-local coordinates on a secondary display', () => {
    // Overlay windows sit at the display origin, so local (0,0) = bounds top-left.
    expect(pixelToOverlay(960, 540, 1920, 1080, secondary)).toEqual({ x: 960, y: 540 });
  });

  it('clamps points outside the display', () => {
    expect(pixelToOverlay(-50, 5000, 1920, 1080, secondary)).toEqual({ x: 0, y: 1080 });
  });
});

describe('pixelLengthToDip', () => {
  it('scales lengths by the image-to-DIP ratio', () => {
    expect(pixelLengthToDip(100, 1568, retinaBounds)).toBeCloseTo(96.4, 1);
  });
});

describe('pixelRectToOverlay', () => {
  it('maps and clamps rects', () => {
    const rect = pixelRectToOverlay(
      { x: 1800, y: 900, width: 400, height: 400 }, // spills off right/bottom
      1920,
      1080,
      secondary,
    );
    expect(rect.x).toBe(1800);
    expect(rect.y).toBe(900);
    expect(rect.width).toBe(120); // clamped at the display edge
    expect(rect.height).toBe(180);
  });
});
