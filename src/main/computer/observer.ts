// Reading windows in guide mode.
//
// Guide mode only looks and talks, so it has no ComputerProvider and nothing
// that synthesizes input. But it still needs to know where things are: asked
// to circle a tab, Buddy was guessing from a downscaled screenshot, and a
// guess is visibly off on something 28 points tall.
//
// This is the same window reader the agent uses, with the acting half left
// out. It holds a read-only driver session for the life of the app, because
// reading is the cheap part and starting a session per question is not.

import { screen } from 'electron';
import { jev } from '../ai/jev';
import type { Rect } from '../coords';
import type { DescribedWindow } from '../drawing/anchors';
import { createLogger } from '../log';
import type { CuaIo } from './cua-io';
import { runWindowAction, windowLabel } from './cua-window';
import { pickElement } from './judgement';
import { createDisplayFrames } from './display-capture';
import { openSession } from './driver';
import { ObservationRegistry, type WindowObservation } from './observations';
import { SETTLE_MS, type ActionOutcome } from './provider';
import { visibleBounds, type RefRow } from './tree';
import { parseWindows, usableWindows, windowAt, type WindowRecord } from './window-list';
import { errorMessage } from '../../shared/errors';

const log = createLogger('observer');

/**
 * Nothing here synthesizes input, so there is nothing for the takeover rails
 * to know about. Claiming anything would be a lie that blinds them.
 */
const NO_INPUT = {
  recordKey: () => undefined,
  recordMousePosition: () => undefined,
  markTyping: () => undefined,
  markMouseActivity: () => undefined,
};

/** The actions guide mode may ask for: every one of them read-only. */
const READS = new Set(['list_windows', 'list_apps', 'get_window_state', 'expand_element']);

/**
 * Kept outside the lazy session so a ref can be resolved the instant a
 * drawing names it — anchors are worked out synchronously.
 */
const observations = new ObservationRegistry();

let io: Promise<CuaIo> | null = null;

function reader(displayId: number): Promise<CuaIo> {
  io ??= (async () => {
    const session = await openSession('guide');
    log.info('window reader ready');
    return {
      call: (tool, args) => session.call(tool, args),
      frames: createDisplayFrames(displayId),
      observations,
      hooks: NO_INPUT,
      settleMs: SETTLE_MS,
    } satisfies CuaIo;
  })();
  return io;
}

/** Read a window for guide mode. Refuses anything that would act. */
export async function observeForGuide(
  action: string,
  input: Record<string, unknown>,
  displayId: number,
): Promise<ActionOutcome> {
  if (!READS.has(action)) {
    throw new Error(`${action} is not a read; guide mode cannot act on the computer.`);
  }
  return runWindowAction(action, input, await reader(displayId));
}

/**
 * Bring the observed windows' positions up to date, so element-anchored
 * drawings follow a window that was dragged. One list_windows call — cheap,
 * no accessibility walk — and only worth making while something on screen is
 * anchored, which is the caller's judgement.
 */
export async function refreshWindowPositions(): Promise<void> {
  if (!io) return;
  const reader = await io;
  const listed = await reader.call('list_windows', {});
  if (listed.isError) return;
  observations.followWindows(
    parseWindows(listed.structuredJson).map((window) => ({
      pid: window.pid,
      windowId: window.windowId,
      x: window.bounds.x,
      y: window.bounds.y,
    })),
  );
}

/** The on-screen windows a user could point at, front first. Empty when the driver can't list them. */
export async function listGuideWindows(displayId: number): Promise<WindowRecord[]> {
  const listed = await (await reader(displayId)).call('list_windows', {});
  if (listed.isError) return [];
  return usableWindows(parseWindows(listed.structuredJson)).filter((window) => window.onScreen);
}

/**
 * Read the window under a point and hand back its elements, for naming what
 * sits under a user mark. Best-effort by design: marks work without element
 * context, so any failure here returns null rather than surfacing.
 */
export async function observeWindowForMarks(
  x: number,
  y: number,
  displayId: number,
): Promise<{ observationId: string; rows: RefRow[] } | null> {
  try {
    const window = windowAt(await listGuideWindows(displayId), x, y);
    if (!window) return null;
    const io = await reader(displayId);
    const outcome = await runWindowAction(
      'get_window_state',
      { pid: window.pid, window_id: window.windowId },
      io,
    );
    if (outcome.error) return null;
    const observation = observations.current(window.pid, window.windowId);
    return observation
      ? { observationId: observation.observationId, rows: observation.rows }
      : null;
  } catch (error) {
    log.warn(`mark element read failed: ${errorMessage(error)}`);
    return null;
  }
}

/** Resolve a guide-mode ref against the live observation registry. */
export function resolveGuideRef(
  observationId: unknown,
  ref: unknown,
): { observation: WindowObservation; element: RefRow } | null {
  const found = observations.resolve(observationId, ref);
  return 'error' in found ? null : found;
}

/** Re-walk one window and return the fresh observation (new refs). */
export async function rereadWindow(
  pid: number,
  windowId: number,
  displayId: number,
): Promise<WindowObservation | null> {
  const outcome = await observeForGuide('get_window_state', { pid, window_id: windowId }, displayId);
  if (outcome.error) return null;
  return observations.current(pid, windowId);
}

/**
 * Find each description in one window (the front one unless pid and
 * windowId name another), read once, with Jev picking the element. A pick
 * Jev is unsure of is refused, never matched to a lookalike.
 */
export async function findGuideElements(
  window: DescribedWindow,
  wanted: readonly string[],
  displayId: number,
): Promise<Array<{ observationId: string; ref: string } | { error: string }>> {
  const refuse = (error: string): Array<{ error: string }> => wanted.map(() => ({ error }));
  const judge = await jev();
  if (!judge) return refuse('Finding an element by its words needs Jev, which is not set up. Call read_window and anchor to a ref.');
  const input = window.pid !== undefined && window.windowId !== undefined ? { pid: window.pid, window_id: window.windowId } : {};
  const read = await observeForGuide('get_window_state', input, displayId);
  const observation = read.observation?.kind === 'window' ? observations.observationById(read.observation.observationId) : null;
  if (!observation) return refuse('That window could not be read. Call read_window and anchor to a ref.');
  const label = windowLabel(observation);
  return Promise.all(
    wanted.map(async (description) => {
      const row = await pickElement(judge, observation.rows, label, description);
      return row
        ? { observationId: observation.observationId, ref: row.ref }
        : { error: `Nothing in ${label} confidently matched "${description}". Call read_window and anchor to a ref.` };
    }),
  );
}

/** An element's box in global screen DIP, for anchoring a drawing to it. */
export function guideElementBox(
  observationId: unknown,
  ref: unknown,
): { displayId: number; rect: Rect } | null {
  const found = observations.resolve(observationId, ref);
  const box = 'error' in found ? null : visibleBounds(found.element);
  if (!box) return null;
  const { x, y, w, h } = box;
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + w / 2),
    y: Math.round(y + h / 2),
  });
  return { displayId: display.id, rect: { x, y, width: w, height: h } };
}
