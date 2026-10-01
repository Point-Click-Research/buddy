import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { annotateScreenshot, cropCloseUp, imageSize, type ImageMark } from '../src/main/marks/images';

function blank(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .png()
    .toBuffer();
}

const oneOfEach: ImageMark[] = [
  { number: 1, kind: 'tap', points: [{ x: 50, y: 50 }], bounds: { x: 42, y: 42, width: 16, height: 16 }, badge: { x: 70, y: 34 } },
  {
    number: 2,
    kind: 'region',
    points: [
      { x: 100, y: 40 },
      { x: 180, y: 40 },
      { x: 180, y: 90 },
      { x: 100, y: 90 },
      { x: 100, y: 40 },
    ],
    bounds: { x: 100, y: 40, width: 80, height: 50 },
    badge: { x: 190, y: 30 },
  },
  {
    number: 3,
    kind: 'path',
    points: [
      { x: 210, y: 120 },
      { x: 260, y: 100 },
    ],
    bounds: { x: 210, y: 100, width: 50, height: 20 },
    badge: { x: 270, y: 92 },
  },
  {
    number: 4,
    kind: 'underline',
    points: [
      { x: 30, y: 150 },
      { x: 150, y: 152 },
    ],
    bounds: { x: 30, y: 120, width: 120, height: 30 },
    badge: { x: 160, y: 112 },
  },
];

describe('annotateScreenshot', () => {
  it('composites every mark kind and keeps the image size', async () => {
    const image = await blank(300, 200);
    const base64 = await annotateScreenshot(image, { width: 300, height: 200 }, oneOfEach, '#3d7bfd', 1);
    const size = await imageSize(Buffer.from(base64, 'base64'));
    expect(size).toEqual({ width: 300, height: 200 });
    // The composite actually drew something: the result differs from the blank.
    const plain = (await sharp(image).jpeg({ quality: 80 }).toBuffer()).toString('base64');
    expect(base64).not.toBe(plain);
  });
});

describe('cropCloseUp', () => {
  it('crops the requested rect at full resolution', async () => {
    const image = await blank(400, 300);
    const crop = await cropCloseUp(image, { x: 100, y: 50, width: 120, height: 80 });
    expect(crop.width).toBe(120);
    expect(crop.height).toBe(80);
  });
});
