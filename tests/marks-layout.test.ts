import { describe, expect, it } from 'vitest';
import { BADGE_RADIUS, badgePosition, cropRect } from '../src/main/marks/layout';

const display = { width: 1512, height: 982 };

describe('badgePosition', () => {
  it('sits just outside the top-right corner of the mark', () => {
    const badge = badgePosition({ x: 200, y: 300, width: 100, height: 50 }, display);
    expect(badge.x).toBe(310);
    expect(badge.y).toBe(290);
  });

  it('is pulled back inside the display at the right edge', () => {
    const badge = badgePosition({ x: 1450, y: 300, width: 60, height: 40 }, display);
    expect(badge.x).toBeLessThanOrEqual(display.width - BADGE_RADIUS);
    expect(badge.x + BADGE_RADIUS).toBeLessThanOrEqual(display.width);
  });

  it('is pulled down inside the display at the top edge', () => {
    const badge = badgePosition({ x: 200, y: 4, width: 100, height: 40 }, display);
    expect(badge.y - BADGE_RADIUS).toBeGreaterThanOrEqual(0);
  });
});

describe('cropRect', () => {
  const image = { width: 3024, height: 1964 };

  it('pads by 15% of the larger side', () => {
    const crop = cropRect({ x: 1000, y: 800, width: 400, height: 200 }, image);
    expect(crop.x).toBe(1000 - 60); // 15% of 400
    expect(crop.y).toBe(800 - 60);
    expect(crop.width).toBe(400 + 120);
    expect(crop.height).toBe(200 + 120);
  });

  it('keeps a minimum padding around small marks', () => {
    const crop = cropRect({ x: 500, y: 500, width: 20, height: 20 }, image);
    expect(crop.x).toBe(500 - 24);
    expect(crop.width).toBe(20 + 48);
  });

  it('clamps to the image edges', () => {
    const crop = cropRect({ x: 10, y: 5, width: 100, height: 60 }, image);
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(image.width);
  });

  it('clamps at the bottom-right corner too', () => {
    const crop = cropRect({ x: 2990, y: 1940, width: 100, height: 60 }, image);
    expect(crop.x + crop.width).toBeLessThanOrEqual(image.width);
    expect(crop.y + crop.height).toBeLessThanOrEqual(image.height);
    expect(crop.width).toBeGreaterThan(0);
    expect(crop.height).toBeGreaterThan(0);
  });

  it('never returns an empty rect, even for degenerate bounds', () => {
    const crop = cropRect({ x: 3023, y: 1963, width: 0, height: 0 }, image);
    expect(crop.width).toBeGreaterThanOrEqual(1);
    expect(crop.height).toBeGreaterThanOrEqual(1);
  });
});
