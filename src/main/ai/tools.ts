// The tool registry: every tool the model can call in one request, with its
// API definition and its executor. Guide mode registers the annotation tools
// here; MCP and agent tools plug into the same registry in later milestones.

import type { ImageBlockParam, TextBlockParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { toToolOutcome } from '../agent/tool-result';
import { pointAnnotation } from '../annotations';
import type { ScreenshotMeta } from '../capture';
import { findGuideElements, guideElementBox, observeForGuide } from '../computer/observer';
import type { DescribeElements } from '../drawing/anchors';
import { addDrawingTools, type ElementLookup } from '../drawing/tools';
import { createLogger } from '../log';
import { sendAnnotationsToDisplay } from '../windows';
import { locateInPicture } from './locate-object';
import { addLocateTextTool, locateDescribed, locatedTextBox } from './locate-text';
import { errorMessage } from '../../shared/errors';

const log = createLogger('tools');

/** What executing a tool produced, sent back to the model as a tool_result. */
export interface ToolOutcome {
  content: string | Array<TextBlockParam | ImageBlockParam>;
  isError?: boolean;
  /** End the tool loop after this batch (task_complete). */
  endLoop?: boolean;
}

export interface RegisteredTool {
  definition: Tool;
  /**
   * Immediate tools run the moment their block finishes streaming (used for
   * annotations, so drawings appear mid-response instead of after it).
   */
  immediate?: boolean;
  /**
   * The tool waits on the user (a card, a spoken answer). Nothing is being
   * fetched, so the loop's "still working" filler would be nonsense — silence
   * is right while they decide.
   */
  waitsForUser?: boolean;
  /**
   * The model's text in the same turn is the answer, not narration: a draw's
   * explanation, a plan's one-line ack. Implied for immediate tools. Text
   * before any other tool call is "let me check…" and is never spoken.
   */
  spokenAlongside?: boolean;
  execute(input: unknown, signal: AbortSignal): ToolOutcome | Promise<ToolOutcome>;
}

/** Tool name -> tool. Built fresh per request so executors can close over context. */
export type ToolRegistry = Map<string, RegisteredTool>;

export function toolDefinitions(registry: ToolRegistry): Tool[] {
  return [...registry.values()].map((tool) => tool.definition);
}

/**
 * A tool call's input as a plain object. The model's JSON is untyped and
 * may be missing entirely; executors read fields off this and validate each.
 */
export function toolArgs(input: unknown): Record<string, unknown> {
  return (input ?? {}) as Record<string, unknown>;
}

// --- Annotation tools -------------------------------------------------------

const COORDS_NOTE =
  'Coordinates are in the pixel space of that screen\'s screenshot. screen is the screen number (1 = "Screen 1").';

const label = {
  label: { type: 'string', description: 'Very short label shown next to the drawing (max 60 chars).' },
} as const;

/**
 * Only `point` survives from v1: it moves the cursor buddy, which the draw
 * tool deliberately doesn't do. Circles, arrows and highlights are shapes,
 * and shapes belong to `draw` (see src/main/drawing/).
 */
const POINT_TOOL: Tool = {
  name: 'point',
  description:
    'Point at one thing; the buddy dot flies there. Say where with a ref from read_window or ' +
    `locate_text — exact, and the right choice for a tab, button or word — or with coordinates. ${COORDS_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      ref: { type: 'string', description: 'A ref from read_window or locate_text. The dot goes to its centre.' },
      observation_id: { type: 'string', description: 'The observation the ref came from.' },
      screen: { type: 'integer' },
      x: { type: 'number' },
      y: { type: 'number' },
      ...label,
    },
    required: ['label'],
  },
} as Tool;

/**
 * Refs come from two registries: window elements (read_window) and located
 * text (locate_text). Their ids never collide — driver snapshot ids against
 * `text-n` — so one lookup can serve the anchor path for both.
 */
const anchorBox: ElementLookup = (observationId, ref) =>
  locatedTextBox(observationId, ref) ?? guideElementBox(observationId, ref);

/** The guide-mode annotation tools, bound to this request's screenshots. */
export function createAnnotationTools(screenshots: ScreenshotMeta[], oneDraw = false): ToolRegistry {
  const registry: ToolRegistry = new Map();

  registry.set('point', {
    definition: POINT_TOOL,
    immediate: true,
    execute: (input): ToolOutcome => {
      const converted = pointAnnotation(input, screenshots, anchorBox);
      if ('error' in converted) {
        log.warn(`point refused: ${converted.error}`);
        return { content: converted.error, isError: true };
      }
      sendAnnotationsToDisplay(converted.displayId, [converted.annotation]);
      return { content: 'drawn' };
    },
  });

  const displayId = readerDisplay(screenshots);
  addWindowReadingTools(registry, displayId);
  addLocateTextTool(registry);
  // Clearing is `erase` now (see src/main/drawing/), which owns what is on
  // screen; this only has to take the buddy dot's ping with it.
  addDrawingTools(registry, {
    screenshots,
    element: anchorBox,
    ...(displayId === undefined ? {} : { describe: describeOn(displayId, screenshots) }),
    oneDraw,
  });
  return registry;
}

/**
 * Find described elements in the window first. What no window lists is
 * looked for two ways at once: by its label on screen (a desktop icon, a file
 * in a list) and in the picture itself (a rock in the wallpaper, a face in a
 * photo), the label winning when both find it.
 */
function describeOn(displayId: number, screenshots: readonly ScreenshotMeta[]): DescribeElements {
  const shot = screenshots.find((candidate) => candidate.displayId === displayId);
  return async (window, wanted) => {
    const inWindow = await findGuideElements(window, wanted, displayId);
    return Promise.all(
      inWindow.map(async (found, i) => {
        if (!('error' in found)) return found;
        const [label, picture] = await Promise.all([
          locateDescribed(wanted[i]!, displayId),
          shot ? locateInPicture(wanted[i]!, shot) : found,
        ]);
        if (!('error' in label)) return label;
        return 'error' in picture ? found : picture;
      }),
    );
  };
}

/** The display the window reader works on: the one the cursor is on, else the first captured. */
function readerDisplay(screenshots: readonly ScreenshotMeta[]): number | undefined {
  return (screenshots.find((shot) => shot.isCursorDisplay) ?? screenshots[0])?.displayId;
}

/**
 * Reading a window, in guide mode. This is how Buddy stops guessing where
 * something is: the elements come back with a ref each, and a drawing
 * anchored to a ref sits exactly on the real control.
 *
 * It is offered rather than done automatically, because walking a window's
 * accessibility tree costs a beat and most questions do not need it.
 */
function addWindowReadingTools(registry: ToolRegistry, displayId: number | undefined): void {
  registry.set('read_window', {
    definition: {
      name: 'read_window',
      description:
        'List what is in a window — its buttons, tabs, fields and links — each with a ref. Use it ' +
        'before drawing on something small or precise: a shape anchored to a ref sits exactly on ' +
        'the real control instead of where you estimated it. Reads the frontmost window unless you ' +
        'name one from list_windows.',
      input_schema: {
        type: 'object',
        properties: {
          pid: { type: 'integer', description: 'From list_windows. Send it with window_id.' },
          window_id: { type: 'integer', description: 'From list_windows. Send it with pid.' },
          query: { type: 'string', description: 'Only elements whose text matches, for a large window.' },
        },
      },
    },
    execute: (input) => readWindow('get_window_state', input, displayId),
  });

  registry.set('list_windows', {
    definition: {
      name: 'list_windows',
      description: 'List the open windows front to back, with the pid and window_id to read them by.',
      input_schema: { type: 'object', properties: {} },
    },
    execute: (input) => readWindow('list_windows', input, displayId),
  });
}

async function readWindow(
  action: string,
  input: unknown,
  displayId: number | undefined,
): Promise<ToolOutcome> {
  if (displayId === undefined) return { content: 'No screen was captured to read.', isError: true };
  try {
    const outcome = await observeForGuide(action, (input ?? {}) as Record<string, unknown>, displayId);
    return toToolOutcome(outcome, 'this screen');
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`read_window failed: ${detail}`);
    return { content: `That window could not be read: ${detail}`, isError: true };
  }
}
