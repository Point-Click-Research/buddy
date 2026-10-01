// Finding a thing in a picture: a rock in the wallpaper, a face in a photo, a
// product in a video frame. It has no element to read and no text to OCR, and
// a chat model asked for its pixel coordinates lands far off. A model trained
// to ground a description in an image is asked for its box instead, and the
// box is kept like located text so a drawing anchors to it exactly.

import type { ScreenshotMeta } from '../capture';
import { createLogger } from '../log';
import { recordBox } from './locate-text';
import { errorMessage } from '../../shared/errors';

const log = createLogger('locate-object');

/** Allowed on every plan: the Buddy API's TOOL_MODELS. */
const GROUNDING_MODEL = '~google/gemini-flash-latest';
const TIMEOUT_MS = 8_000;

/** A box normalized to the image, 0..1 from the top left. */
export interface PictureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Read Gemini's box_2d, [ymin, xmin, ymax, xmax] on a 0–1000 scale; null when it found nothing. */
export function readBox(text: string): PictureBox | null {
  const match = /\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/.exec(text);
  if (!match) return null;
  const [ymin, xmin, ymax, xmax] = match.slice(1).map((value) => Math.min(1000, Math.max(0, Number(value))) / 1000) as [
    number,
    number,
    number,
    number,
  ];
  if (xmax <= xmin || ymax <= ymin) return null;
  return { x: xmin, y: ymin, w: xmax - xmin, h: ymax - ymin };
}

/** Where `description` is in this screenshot, as a ref a drawing can anchor to. */
export async function locateInPicture(
  description: string,
  shot: ScreenshotMeta,
): Promise<{ observationId: string; ref: string } | { error: string }> {
  // Lazily, so the modules that anchor drawings load without the settings store.
  const { openRouterClient } = await import('./openrouter');
  const client = await openRouterClient(TIMEOUT_MS);
  if (!client) return { error: `"${description}" could not be looked for in the picture.` };
  try {
    const reply = await client.chat.completions.create({
      model: GROUNDING_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot.base64}` } },
            {
              type: 'text',
              text:
                `Find ${description} in this screenshot. Reply with only JSON: {"box_2d": [ymin, xmin, ymax, xmax]}, ` +
                'each 0-1000 across the image, tight around it. If it is not visible, reply {"box_2d": null}.',
            },
          ],
        },
      ],
    });
    const box = readBox(reply.choices[0]?.message?.content ?? '');
    log.info(`"${description}": ${box ? 'found' : 'not found'}`);
    if (!box) return { error: `"${description}" is not visible on screen.` };
    return recordBox(description, box, { id: shot.displayId, bounds: shot.bounds });
  } catch (error) {
    log.warn(`grounding failed: ${errorMessage(error)}`);
    return { error: `"${description}" could not be looked for in the picture.` };
  }
}
