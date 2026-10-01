// The point tool: refs land exactly, coordinates are estimates, and a bad
// call comes back with a reason.

import { describe, expect, it } from 'vitest';
import { pointAnnotation, type ElementBoxLookup } from '../src/main/annotations';
import type { ScreenshotMeta } from '../src/main/capture';

// Screen 1: a 2x retina display, screenshot downscaled to 1568x1018.
// Screen 2: a plain 1x display to the right, screenshot 1:1.
const screenshots: ScreenshotMeta[] = [
  {
    displayId: 101,
    label: 'Screen 1',
    imageWidth: 1568,
    imageHeight: 1018,
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    scaleFactor: 2,
    isCursorDisplay: true,
    base64: '',
  },
  {
    displayId: 202,
    label: 'Screen 2',
    imageWidth: 1920,
    imageHeight: 1080,
    bounds: { x: 1512, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
    isCursorDisplay: false,
    base64: '',
  },
];

/** One known element: a 96x28 tab on screen 1. */
const elements: ElementBoxLookup = (observationId, ref) =>
  observationId === 's1' && ref === 'e2'
    ? { displayId: 101, rect: { x: 220, y: 33, width: 96, height: 28 } }
    : null;

function point(input: unknown, lookup: ElementBoxLookup = elements) {
  return pointAnnotation(input, screenshots, lookup);
}

function annotationOf(result: ReturnType<typeof pointAnnotation>) {
  if ('error' in result) throw new Error(result.error);
  const annotation = result.annotation;
  if (annotation.kind !== 'point') throw new Error('expected a point');
  return { displayId: result.displayId, ...annotation };
}

describe('pointing at an element', () => {
  it('lands on the centre of the element, not an estimate of it', () => {
    const result = annotationOf(point({ ref: 'e2', observation_id: 's1', label: 'index.html tab' }));
    expect(result.displayId).toBe(101);
    expect(result.x).toBe(268); // 220 + 96 / 2
    expect(result.y).toBe(47); // 33 + 28 / 2
  });

  it('wins over any coordinates sent alongside it', () => {
    const result = annotationOf(
      point({ ref: 'e2', observation_id: 's1', screen: 1, x: 5, y: 5, label: '' }),
    );
    expect(result.x).toBe(268);
  });

  it('says what to do about a ref it cannot find', () => {
    const result = point({ ref: 'e9', observation_id: 'old', label: 'x' });
    expect('error' in result && result.error).toContain('read_window');
  });
});

describe('pointing at a place', () => {
  it('converts screenshot pixels to overlay DIP', () => {
    const result = annotationOf(point({ screen: 1, x: 784, y: 509, label: 'Here' }));
    expect(result.displayId).toBe(101);
    expect(result.x).toBeCloseTo(756, 0); // image centre -> display centre
    expect(result.y).toBeCloseTo(491, 0);
    expect(result.label).toBe('Here');
  });

  it('targets the right display for screen 2', () => {
    const result = annotationOf(point({ screen: 2, x: 960, y: 540, label: '' }));
    expect(result.displayId).toBe(202);
    // Overlay-local: same values since the screenshot is 1:1 for this display.
    expect(result.x).toBe(960);
    expect(result.y).toBe(540);
  });

  it('refuses an unknown screen by name', () => {
    for (const screen of [3, 0]) {
      const result = point({ screen, x: 10, y: 10, label: 'x' });
      expect('error' in result && result.error).toContain('screen');
    }
  });

  it('falls back to the cursor display when screen is omitted', () => {
    const result = annotationOf(point({ x: 784, y: 509, label: 'x' }));
    expect(result.displayId).toBe(101); // the isCursorDisplay screenshot
  });

  it('asks for a ref or coordinates when it got neither', () => {
    const result = point({ screen: 1, x: 'left', y: 10, label: 'x' });
    expect('error' in result && result.error).toContain('ref from read_window');
  });

  it('clamps out-of-bounds coordinates to the display', () => {
    const result = annotationOf(point({ screen: 1, x: 99999, y: -50, label: '' }));
    expect(result.x).toBe(1512);
    expect(result.y).toBe(0);
  });

  it('caps labels at 60 characters', () => {
    const result = annotationOf(point({ screen: 1, x: 1, y: 1, label: 'a'.repeat(100) }));
    expect(result.label).toHaveLength(60);
  });
});
