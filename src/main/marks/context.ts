// Building what the brain receives for a turn with user marks (whichever
// provider is answering — see src/main/ai/brain.ts):
//
//   1. per display: an annotated screenshot — the capture from when the
//      first mark on that display started, with the marks composited in the
//      user color — plus the release screenshot only if the screen changed
//   2. a close-up crop per region/underline mark (at most four)
//   3. a text block per mark: number, type, bounds in screenshot pixels with
//      the frameId, direction for paths, and the accessibility elements
//      under the mark when the window reader can provide them
//
// The transcript gets ⟦mark N⟧ tokens inserted where each mark was drawn.

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import type { MarksTurnDebug } from '../../shared/types';
import type { ScreenshotMeta } from '../capture';
import { dipToPixel } from '../coords';
import { createLogger } from '../log';
import type { Rect, StrokePoint } from './classify';
import { directionName } from './classify';
import { badgePosition, cropRect } from './layout';
import { elementsUnderMark } from './elements';
import { annotateScreenshot, cropCloseUp, imageSize, type ImageMark } from './images';
import type { MarkShot, MarksTurn, TurnMark } from './marks';
import { insertMarkTokens, markToken, type WordTiming } from './transcript';
import { errorMessage } from '../../shared/errors';

const log = createLogger('marks');

/** At most this many close-up crops per turn. */
const MAX_CROPS = 4;

/** Elements under marks are a bonus; never hold the answer up long for them. */
const ELEMENTS_BUDGET_MS = 4_000;

/** How the session lets this module read the window under a mark. */
export type MarkElementLookup = (
  x: number,
  y: number,
  displayId: number,
) => Promise<{ observationId: string; rows: Parameters<typeof elementsUnderMark>[0] } | null>;

export interface MarksRequest {
  /** Screenshot and crop blocks, in the order the model should read them. */
  imageBlocks: ContentBlockParam[];
  /** The per-mark text context, one block. */
  contextBlock: ContentBlockParam;
  /** The transcript with ⟦mark N⟧ tokens inserted. */
  transcript: string;
  /** For the dev Marks view. */
  debug: MarksTurnDebug;
}

export async function buildMarksRequest(params: {
  turn: MarksTurn;
  /** This turn's normal captures, taken at chord release. */
  releaseShots: readonly ScreenshotMeta[];
  transcript: string;
  words: readonly WordTiming[] | null;
  recordingMs: number;
  color: string;
  lookupElements?: MarkElementLookup;
}): Promise<MarksRequest> {
  const { turn, releaseShots, color } = params;

  const marked = insertMarkTokens(
    params.transcript,
    params.words,
    turn.marks.map((mark) => ({ number: mark.number, endMs: mark.endMs })),
    params.recordingMs,
  );

  const imageBlocks: ContentBlockParam[] = [];
  const debugImages: MarksTurnDebug['images'] = [];
  const debugCrops: MarksTurnDebug['crops'] = [];

  // Screenshots: annotated per marked display, plain for the others.
  const markedDisplays = new Set(turn.marks.map((mark) => mark.displayId));
  const shotsByDisplay = new Map(turn.shots.map((shot) => [shot.displayId, shot]));
  const releaseByDisplay = new Map(releaseShots.map((shot) => [shot.displayId, shot]));

  for (const release of releaseShots) {
    const markShot = markedDisplays.has(release.displayId)
      ? shotsByDisplay.get(release.displayId)
      : undefined;
    if (!markShot) {
      pushShot(imageBlocks, release, `${release.label}${release.isCursorDisplay ? ' (cursor is here)' : ''}`);
      continue;
    }
    const annotated = await annotateDisplay(markShot, turn.marks, color);
    const label =
      `${release.label} with the user's marks drawn on ` +
      `(captured when they started drawing), ${markShot.shot.imageWidth}x${markShot.shot.imageHeight}, ` +
      `frame_id ${markShot.frameId}`;
    imageBlocks.push({ type: 'text', text: label });
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: annotated },
    });
    debugImages.push({ label, base64: annotated });

    // The release screenshot adds nothing unless the screen changed under them.
    if (release.base64 !== markShot.shot.base64) {
      pushShot(
        imageBlocks,
        release,
        `${release.label} at release (the screen changed while the user was talking)`,
      );
      debugImages.push({ label: `${release.label} at release`, base64: release.base64 });
    }
  }
  // A marked display missing from the release captures still gets its shot.
  for (const shot of turn.shots) {
    if (releaseByDisplay.has(shot.displayId)) continue;
    const annotated = await annotateDisplay(shot, turn.marks, color);
    const label = `Screen with the user's marks, ${shot.shot.imageWidth}x${shot.shot.imageHeight}, frame_id ${shot.frameId}`;
    imageBlocks.push({ type: 'text', text: label });
    imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: annotated } });
    debugImages.push({ label, base64: annotated });
  }

  // Close-up crops for region and underline marks, in drawing order.
  const cropWorthy = turn.marks.filter(
    (mark) => mark.classified.kind === 'region' || mark.classified.kind === 'underline',
  );
  let skippedCrops = 0;
  for (const mark of cropWorthy) {
    if (debugCrops.length >= MAX_CROPS) {
      skippedCrops++;
      continue;
    }
    const shot = shotsByDisplay.get(mark.displayId);
    // No native capture (it failed, or the display vanished): the annotated
    // screenshot still shows the mark, there is just no close-up.
    if (!shot?.native) continue;
    try {
      const native = await imageSize(shot.native);
      const bounds = shot.shot.bounds;
      const scaleX = native.width / bounds.width;
      const scaleY = native.height / bounds.height;
      const box = mark.classified.bounds;
      const rect = cropRect(
        { x: box.x * scaleX, y: box.y * scaleY, width: box.width * scaleX, height: box.height * scaleY },
        native,
      );
      const crop = await cropCloseUp(shot.native, rect);
      const label = `Mark ${mark.number} close-up (full resolution)`;
      imageBlocks.push({ type: 'text', text: label });
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: crop.base64 } });
      debugCrops.push({ label, base64: crop.base64 });
    } catch (error) {
      log.warn(`crop failed for mark ${mark.number}: ${errorMessage(error)}`);
    }
  }

  // One text block covering every mark.
  const contextText = await marksContextText(params, shotsByDisplay, releaseByDisplay, marked.approximate, skippedCrops);
  const contextBlock: ContentBlockParam = { type: 'text', text: contextText };

  const debug: MarksTurnDebug = {
    at: Date.now(),
    transcript: marked.text,
    images: debugImages,
    crops: debugCrops,
    context: contextText,
  };
  return { imageBlocks, contextBlock, transcript: marked.text, debug };
}

function pushShot(blocks: ContentBlockParam[], shot: ScreenshotMeta, label: string): void {
  blocks.push({
    type: 'text',
    text: `${label}, ${shot.imageWidth}x${shot.imageHeight}, frame_id ${shot.frameId}`,
  });
  blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.base64 } });
}

/** Composite one display's marks onto its start-of-drawing screenshot. */
async function annotateDisplay(shot: MarkShot, marks: readonly TurnMark[], color: string): Promise<string> {
  const meta = shot.shot;
  const bounds = meta.bounds;
  const scale = meta.imageWidth / bounds.width;
  const toPixels = (point: StrokePoint): StrokePoint =>
    dipToPixel(bounds.x + point.x, bounds.y + point.y, meta.imageWidth, meta.imageHeight, bounds);
  const imageMarks: ImageMark[] = marks
    .filter((mark) => mark.displayId === shot.displayId)
    .map((mark) => {
      const box = mark.classified.bounds;
      const badge = badgePosition(box, { width: bounds.width, height: bounds.height });
      return {
        number: mark.number,
        kind: mark.classified.kind,
        points: mark.classified.points.map(toPixels),
        bounds: pixelRect(box, toPixels),
        badge: toPixels(badge),
      };
    });
  return annotateScreenshot(
    Buffer.from(meta.base64, 'base64'),
    { width: meta.imageWidth, height: meta.imageHeight },
    imageMarks,
    color,
    scale,
  );
}

function pixelRect(rect: Rect, toPixels: (point: StrokePoint) => StrokePoint): Rect {
  const topLeft = toPixels({ x: rect.x, y: rect.y });
  const bottomRight = toPixels({ x: rect.x + rect.width, y: rect.y + rect.height });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(0, bottomRight.x - topLeft.x),
    height: Math.max(0, bottomRight.y - topLeft.y),
  };
}

/** The per-mark text blocks, with element context when it can be had cheaply. */
async function marksContextText(
  params: Parameters<typeof buildMarksRequest>[0],
  shotsByDisplay: ReadonlyMap<number, MarkShot>,
  releaseByDisplay: ReadonlyMap<number, ScreenshotMeta>,
  approximate: boolean,
  skippedCrops: number,
): Promise<string> {
  const lines: string[] = [
    'The user drew marks on the screen while speaking. Each appears in the transcript as ' +
      '⟦mark N⟧ right after the words being said when it was drawn, and in the annotated ' +
      'screenshot as a numbered stroke in the user color.',
  ];
  if (approximate) {
    lines.push(
      'The transcript positions of the marks are approximate: the ear gave no word timestamps, so they were placed proportionally by time.',
    );
  }
  if (skippedCrops > 0) {
    lines.push(`(${skippedCrops} more mark(s) have no close-up; see the annotated screenshot.)`);
  }

  // One accessibility read per display, reused for its marks: most turns mark
  // one window, and a mark over some other window simply matches no elements.
  const observations = new Map<number, { observationId: string; rows: Parameters<typeof elementsUnderMark>[0] } | null>();
  const deadline = Date.now() + ELEMENTS_BUDGET_MS;

  for (const mark of params.turn.marks) {
    const kind = mark.classified.kind;
    const shot = shotsByDisplay.get(mark.displayId);
    const meta = shot?.shot ?? releaseByDisplay.get(mark.displayId);
    const frameId = shot?.frameId ?? meta?.frameId ?? 'unknown';
    const parts: string[] = [`${markToken(mark.number)} — ${kind}`];

    if (meta) {
      const toPixels = (point: StrokePoint): StrokePoint =>
        dipToPixel(meta.bounds.x + point.x, meta.bounds.y + point.y, meta.imageWidth, meta.imageHeight, meta.bounds);
      if (kind === 'tap') {
        const point = toPixels(mark.classified.points[0]!);
        parts.push(`at (${Math.round(point.x)}, ${Math.round(point.y)}) in frame_id ${frameId}`);
      } else {
        const box = pixelRect(mark.classified.bounds, toPixels);
        parts.push(
          `bounds (${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.width)}x${Math.round(box.height)}) in frame_id ${frameId}`,
        );
      }
    }
    if (kind === 'path' && mark.classified.direction) {
      parts.push(`direction: ${directionName(mark.classified.direction)} (from its start to its arrowhead)`);
    }
    if (kind === 'underline') {
      parts.push('it refers to the text just above the stroke');
    }

    let line = `- ${parts.join(', ')}`;

    if (params.lookupElements && meta && Date.now() < deadline) {
      if (!observations.has(mark.displayId)) {
        const box = mark.classified.bounds;
        const center = {
          x: meta.bounds.x + box.x + box.width / 2,
          y: meta.bounds.y + Math.max(0, box.y) + box.height / 2,
        };
        observations.set(
          mark.displayId,
          await params.lookupElements(center.x, center.y, mark.displayId),
        );
      }
      const observed = observations.get(mark.displayId);
      if (observed) {
        const box = mark.classified.bounds;
        const globalRect: Rect = {
          x: meta.bounds.x + box.x,
          y: meta.bounds.y + Math.max(0, box.y),
          width: box.width,
          height: box.height,
        };
        const rows = elementsUnderMark(observed.rows, globalRect);
        if (rows.length > 0) {
          const elements = rows
            .map((row) => `${row.ref} ${row.role}${row.name ? ` "${row.name}"` : ''}${row.value ? ` value="${row.value}"` : ''}`)
            .join('; ');
          line += `\n  elements under it (observationId ${observed.observationId}): ${elements}`;
        }
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}
