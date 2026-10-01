// The locate_text tool: pointing at words, exactly.
//
// read_window covers controls, but the words inside an editor, a terminal or
// a page have no element of their own, and a coordinate estimated off a
// downscaled screenshot misses small text by whole lines. This tool OCRs one
// display at full resolution, finds the requested characters, and mints refs
// that a point or drawing anchors to exactly like element refs.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { screen } from 'electron';
import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { captureDisplayPng } from '../capture';
import { TextLocationRegistry, type LocatedText } from '../computer/text-locations';
import type { Rect } from '../coords';
import { createLogger } from '../log';
import { findTextInImage, type OcrMatch } from '../reader/ocr';
import { toolArgs, type ToolOutcome, type ToolRegistry } from './tools';
import { errorMessage } from '../../shared/errors';

const log = createLogger('locate-text');

const locations = new TextLocationRegistry();

/** Keep a box found in a picture (not by OCR), so a drawing anchors to it like located text. */
export function recordBox(
  label: string,
  box: Omit<OcrMatch, 'line'>,
  display: { id: number; bounds: Rect },
): { observationId: string; ref: string } {
  const observation = locations.record([{ line: label, ...box }], display);
  return { observationId: observation.observationId, ref: observation.matches[0]!.ref };
}

/** Resolve a locate_text ref; null when the ids aren't ours. For composing with an element lookup. */
export function locatedTextBox(
  observationId: unknown,
  ref: unknown,
): { displayId: number; rect: Rect } | null {
  return locations.box(observationId, ref);
}

/** Beyond this the query was too common to point at one thing anyway. */
const MAX_MATCHES = 8;
/** Long lines are context, not the target; show their start like read_window does. */
const MAX_LINE = 80;

const LOCATE_TEXT_TOOL: Tool = {
  name: 'locate_text',
  description:
    'Find exactly where specific text is on screen, by OCR at full resolution. Use it before ' +
    'pointing at or drawing on a word or phrase — code in an editor, a sentence in a document — ' +
    'which read_window has no element for. Each match comes back as a ref that anchors a point ' +
    'or drawing exactly. Send the exact characters as they are visible, from one line. ' +
    'It reports where text is, not what it says: to read or copy text out of an app, read its ' +
    'window instead.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The exact visible text to find. Case-insensitive.' },
      screen: {
        type: 'integer',
        description: 'Screen number (1 = "Screen 1"). Defaults to the screen with the cursor.',
      },
    },
    required: ['text'],
  },
} as Tool;

/** Register locate_text. A no-op off macOS, where Vision does not exist. */
export function addLocateTextTool(tools: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  tools.set('locate_text', { definition: LOCATE_TEXT_TOOL, execute: locateText });
}

async function locateText(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const query = typeof args['text'] === 'string' ? args['text'].replace(/\s+/g, ' ').trim() : '';
  if (!query) return { content: 'locate_text needs the text to find.', isError: true };

  const display = pickDisplay(args['screen']);
  if (!display) return { content: `There is no screen ${String(args['screen'])}.`, isError: true };

  const found = await findOnScreen(query, display);
  if ('error' in found) return { content: found.error, isError: true };
  return { content: describe(query, found.observationId, found.matches, found.capped) };
}

/** OCR one display for `query` and record the matches as refs. */
async function findOnScreen(
  query: string,
  display: Electron.Display,
): Promise<{ observationId: string; matches: readonly LocatedText[]; capped: boolean } | { error: string }> {
  const file = join(tmpdir(), `buddy-ocr-${Date.now()}.png`);
  try {
    await writeFile(file, await captureDisplayPng(display.id));
    const matches = await findTextInImage(file, query);
    if (matches.length === 0) {
      return {
        error:
          `"${query}" is not in the text recognized on this screen. OCR is literal: check the ` +
          'exact characters, try a shorter distinctive phrase, or make sure it is visible.',
      };
    }
    const observation = locations.record(matches.slice(0, MAX_MATCHES), {
      id: display.id,
      bounds: display.bounds,
    });
    return { ...observation, capped: matches.length > MAX_MATCHES };
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`locate_text failed: ${detail}`);
    return { error: `The screen could not be read for text: ${detail}` };
  } finally {
    void unlink(file).catch(() => {});
  }
}

/** The words that name something on screen, out of how it was described: `the "Stuff" folder` → Stuff. */
export function visibleName(description: string): string {
  const quoted = /["“”']([^"“”']+)["“”']/.exec(description)?.[1];
  if (quoted) return quoted.trim();
  return description
    .trim()
    .replace(/^(the|a|an|my|your)\s+/i, '')
    .replace(/\s+(button|folder|file|icon|tab|link|field|menu|item|label|option|checkbox|app|window|text)$/i, '')
    .trim();
}

/**
 * Where something described in words is, by the text on screen: the name a
 * desktop icon, a file or a canvas label shows. Only a match whose whole line
 * is the name counts, so "Stuff" under a folder is found and "the rock" in a
 * sentence is not mistaken for the rock in a photo.
 */
export async function locateDescribed(
  description: string,
  displayId: number,
): Promise<{ observationId: string; ref: string } | { error: string }> {
  const name = visibleName(description);
  const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
  if (!name || !display) return { error: `"${description}" is not on screen.` };
  const found = await findOnScreen(name, display);
  if ('error' in found) return found;
  const best = found.matches.find((match) => match.line.trim().toLowerCase() === name.toLowerCase());
  return best ? { observationId: found.observationId, ref: best.ref } : { error: `No label on screen reads "${name}".` };
}

/** Screens are numbered 1..n matching the "Screen 1" labels sent to the model. */
function pickDisplay(screenNumber: unknown): Electron.Display | null {
  if (typeof screenNumber !== 'number' || !Number.isFinite(screenNumber)) {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }
  return screen.getAllDisplays()[screenNumber - 1] ?? null;
}

/** One match per line, read_window style, plus how to anchor to one. */
function describe(
  query: string,
  observationId: string,
  matches: readonly LocatedText[],
  capped: boolean,
): string {
  const rows = matches.map((match) => {
    const { x, y, width, height } = match.rect;
    const context = match.line.length <= MAX_LINE ? match.line : `${match.line.slice(0, MAX_LINE)}…`;
    return `${match.ref} | ${Math.round(x)},${Math.round(y)} ${Math.round(width)}x${Math.round(height)} | in: ${context}`;
  });
  return [
    `Found "${query}" in ${matches.length} place(s) — observation_id: ${observationId}`,
    ...rows,
    capped ? `Only the first ${MAX_MATCHES} are listed; include more surrounding text to narrow it.` : '',
    `Point or draw with {"ref": "t1", "observationId": "${observationId}"}. These are where the text is now — if the window scrolls or moves, locate it again.`,
  ]
    .filter(Boolean)
    .join('\n');
}
