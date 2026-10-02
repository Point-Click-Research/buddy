// Drawing the user's marks onto screenshots, in the main process. The live
// overlay is excluded from capture (content protection), so what the model sees
// is the clean screenshot with the marks composited here: the cleaned stroke
// in the user color plus a numbered badge. The badge exists only here — the
// user's own screen shows the clean stroke without a number; the model needs
// the numbers to match ⟦mark N⟧ tokens in the transcript.
//
// The SVG is built entirely from validated geometry and a still hex color
// (disco snapshots to the preview pink) — nothing model- or renderer-authored
// reaches it.

import sharp from 'sharp';
import { solidHexColor } from '../../shared/color';
import { round } from '../../shared/pen';
import { BADGE_RADIUS } from './layout';
import type { ClassifiedStroke, Rect, StrokePoint } from './classify';

/** Models read images best when the longest side is at most 1568px. */
const MAX_IMAGE_SIDE = 1568;
const JPEG_QUALITY = 80;

/** An image buffer's pixel dimensions (a native mark screenshot's, usually). */
export async function imageSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(buffer).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** One mark, already converted to the target image's pixel space. */
export interface ImageMark {
  number: number;
  kind: ClassifiedStroke['kind'];
  points: StrokePoint[];
  bounds: Rect;
  badge: StrokePoint;
}

/** The marks drawn over a screenshot; returns JPEG base64. */
export async function annotateScreenshot(
  image: Buffer,
  size: { width: number; height: number },
  marks: readonly ImageMark[],
  color: string,
  /** Image pixels per DIP, so stroke weights match the on-screen look. */
  scale: number,
): Promise<string> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">` +
    marks.map((mark) => markSvg(mark, solidHexColor(color), scale)).join('') +
    '</svg>';
  const composed = await sharp(image)
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return composed.toString('base64');
}

/**
 * A close-up of one mark at the screenshot's full native resolution,
 * downscaled only if it would exceed what the model reads well.
 */
export async function cropCloseUp(
  native: Buffer,
  rect: Rect,
): Promise<{ base64: string; width: number; height: number }> {
  let image = sharp(native).extract({
    left: Math.round(rect.x),
    top: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  });
  if (Math.max(rect.width, rect.height) > MAX_IMAGE_SIDE) {
    image = image.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside' });
  }
  const buffer = await image.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  const meta = await sharp(buffer).metadata();
  return { base64: buffer.toString('base64'), width: meta.width ?? 0, height: meta.height ?? 0 };
}

function markSvg(mark: ImageMark, color: string, scale: number): string {
  const stroke = Math.max(2, 3 * scale);
  let shape = '';
  if (mark.kind === 'tap') {
    const point = mark.points[0]!;
    const radius = Math.max(4, 6 * scale);
    shape =
      `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${round(radius * 2)}" fill="${color}" fill-opacity="0.25"/>` +
      `<circle cx="${round(point.x)}" cy="${round(point.y)}" r="${round(radius)}" fill="${color}"/>`;
  } else {
    const line = mark.points
      .map((point, i) => `${i === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`)
      .join(' ');
    const fill = mark.kind === 'region' ? ` fill="${color}" fill-opacity="0.12"` : ' fill="none"';
    shape = `<path d="${line}"${fill} stroke="${color}" stroke-width="${round(stroke)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (mark.kind === 'path' && mark.points.length >= 2) {
      shape += arrowhead(mark.points, color, scale);
    }
  }
  const badgeRadius = Math.max(8, BADGE_RADIUS * scale);
  const badge =
    `<circle cx="${round(mark.badge.x)}" cy="${round(mark.badge.y)}" r="${round(badgeRadius)}" fill="${color}"/>` +
    `<text x="${round(mark.badge.x)}" y="${round(mark.badge.y)}" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="${round(badgeRadius * 1.2)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${mark.number}</text>`;
  return shape + badge;
}

/** A filled triangle at the path's end, pointing where the stroke went. */
function arrowhead(points: readonly StrokePoint[], color: string, scale: number): string {
  const tip = points[points.length - 1]!;
  const previous = points[points.length - 2]!;
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const size = Math.max(8, 12 * scale);
  const left = {
    x: tip.x - size * Math.cos(angle - Math.PI / 6),
    y: tip.y - size * Math.sin(angle - Math.PI / 6),
  };
  const right = {
    x: tip.x - size * Math.cos(angle + Math.PI / 6),
    y: tip.y - size * Math.sin(angle + Math.PI / 6),
  };
  return (
    `<path d="M ${round(tip.x)} ${round(tip.y)} L ${round(left.x)} ${round(left.y)} ` +
    `L ${round(right.x)} ${round(right.y)} Z" fill="${color}"/>`
  );
}
