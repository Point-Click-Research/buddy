// The Cua provider: the Rust-backed Cua Driver SDK loaded into Buddy's own
// main process, so macOS attributes Accessibility and Screen Recording to
// Buddy itself and the driver never prompts on its own behalf. Buddy owns
// the session and its limits; the driver is a dumb effector behind them.
//
// This module owns the session and the screen family; the window and element
// families live in cua-window.ts. The driver also has recording abilities;
// those join the descriptor as Buddy builds the actions that use them, so the
// model is never shown something Buddy cannot actually perform.

import {
  ACTIONS,
  actionsForFamilies,
  CLICK_BUTTONS,
  namesElement,
  unknownFields,
  wrongFieldsDetail,
} from './actions';
import { clamp, invalid, locateTarget, number, readPoint, readRegion, sleep, text } from './args';
import { claimKeys, claimMouse, claimTyping, type DriverSafetyHooks } from './claim';
import { runClipboardAction } from './cua-clipboard';
import { observeScreenAfter, toError, type CuaIo, type DriverToolResult } from './cua-io';
import { focusForKeys, runWindowAction, unreadWindowAt } from './cua-window';
import { jev } from '../ai/jev';
import { createDisplayFrames } from './display-capture';
import { openSession } from './driver';
import { computerError, type ComputerError } from './errors';
import { parseKeyCombo, type KeyCombo } from './keys';
import { visibleBounds } from './tree';
import { ObservationRegistry } from './observations';
import {
  SETTLE_MS,
  type ActionFamily,
  type ActionOutcome,
  type ComputerAction,
  type ComputerDescriptor,
  type ComputerProvider,
} from './provider';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';

const log = createLogger('cua');

const FAMILIES: readonly ActionFamily[] = ['screen', 'window', 'element', 'clipboard'];

/**
 * The driver has no sustained desktop mouse hold, so these two never reach
 * the model on this provider (see the tool inventory in listToolsJson).
 */
const MISSING_ACTIONS = ['left_mouse_down', 'left_mouse_up'];

/** Buddy addresses the desktop; "primary" is the only portable display id. */
const DESKTOP_TARGET = { kind: 'desktop', display_id: 'primary' } as const;

const MAX_WAIT_SECONDS = 30;
const MAX_KEY_REPEAT = 50;
const MAX_SCROLL_CLICKS = 50;
/** About one screenful: three clicks left the model inching down long pages. */
const DEFAULT_SCROLL_CLICKS = 10;
/** Characters per type_text call, so a stop request lands between chunks. */
const TYPE_CHUNK = 40;
/** Committing clicks must have looked at the window first; hovers need not. */
const LOOK_FIRST = true;

/** How long the pointer may still be travelling after a click or move. */
const POINTER_TRAVEL_MS = 400;
/** The driver's own default drag duration (drag.duration_ms). */
const DRAG_DURATION_MS = 500;

/** Canonical key names that the driver spells differently. */
const DRIVER_KEYS: Record<string, string> = { enter: 'return' };

export async function createCuaProvider(displayId: number, hooks: DriverSafetyHooks): Promise<ComputerProvider> {
  const session = await openSession('agent');
  const decider = await jev();
  log.info(`driving display ${displayId}${decider ? ' with Jev' : ''}`);

  const descriptor: ComputerDescriptor = {
    id: 'cua',
    label: 'Cua driver',
    families: FAMILIES,
    actions: actionsForFamilies(FAMILIES, MISSING_ACTIONS),
    jev: decider !== null,
  };
  const io: CuaIo = {
    call: (tool, args) => session.call(tool, args),
    frames: createDisplayFrames(displayId),
    observations: new ObservationRegistry(),
    hooks,
    settleMs: SETTLE_MS,
    ...(decider ? { jev: decider } : {}),
  };

  return {
    descriptor: () => descriptor,
    snapshot: () => io.frames.screenshot(),
    locate: ({ input }) => locateTarget(input, io.frames, io.observations),

    elementBox(observationId, ref) {
      const found = io.observations.resolve(observationId, ref);
      const box = 'error' in found ? null : visibleBounds(found.element);
      if (!box) return null;
      const { x, y, w, h } = box;
      return { displayId, rect: { x, y, width: w, height: h } };
    },

    resolveElements(observationId) {
      const observation = io.observations.observationById(observationId);
      if (!observation) return null;
      const { pid, windowId, app, title, rows } = observation;
      return { observationId: observation.observationId, pid, windowId, app, title, rows };
    },

    targetApp: ({ name, input }) => describeTarget(name, input, io),

    // Only this task's session ends; the driver stays up for guide mode.
    close: () => session.end(),

    async act({ name, input }: ComputerAction, signal?: AbortSignal): Promise<ActionOutcome> {
      if (!descriptor.actions.includes(name)) {
        return { error: computerError('UNSUPPORTED_ACTION', `"${name}" is not available on this provider.`) };
      }
      const extra = unknownFields(name, input);
      if (extra.length > 0) {
        return { error: computerError('INVALID_REQUEST', wrongFieldsDetail(name, extra)) };
      }
      try {
        const family = ACTIONS[name]?.family;
        if (family === 'screen') return await runCuaAction(name, input, io, signal);
        if (family === 'clipboard') return await runClipboardAction(name, input, io);
        return await runWindowAction(name, input, io, signal);
      } catch (error) {
        const detail = errorMessage(error);
        return { error: computerError('DRIVER_UNAVAILABLE', detail) };
      }
    },
  };
}

/**
 * The app a mutating action will land on, read from what the task has
 * already observed. Element refs know their window exactly; a window action
 * is known once that window has been read. Null means "no window to name" —
 * the excluded-apps check then has nothing to hold it to.
 * Exported for tests; the provider is the only production caller.
 */
function describeTarget(name: string, input: Record<string, unknown>, io: CuaIo): string | null {
  if (!ACTIONS[name]?.mutates) return null;
  if (ACTIONS[name].family === 'element') {
    const found = io.observations.resolve(input['observation_id'], input['ref']);
    if (!('error' in found)) return `${found.observation.app} ${found.observation.title}`.trim() || null;
    // A stale ref may still be acted on after a Jev re-bind, and it would
    // land on that window's current observation — so that is what the
    // excluded-apps check must be told.
    const stale = io.observations.staleElement(input['observation_id'], input['ref']);
    return stale ? `${stale.current.app} ${stale.current.title}`.trim() || null : null;
  }
  const pid = input['pid'];
  const windowId = input['window_id'];
  if (typeof pid !== 'number' || typeof windowId !== 'number') return null;
  const observed = io.observations.current(pid, windowId);
  return observed ? `${observed.app} ${observed.title}`.trim() || null : null;
}

/** Exported for tests; the provider is the only production caller. */
export async function runCuaAction(
  name: string,
  input: Record<string, unknown>,
  io: CuaIo,
  signal?: AbortSignal,
): Promise<ActionOutcome> {
  /**
   * Let the UI settle, then observe: the model sees what the action did.
   * Desktop input has no read-back, so the driver's "unverifiable" verdict
   * is the norm here and is left out; the screenshot is the evidence.
   */
  const observeAfter = (result: DriverToolResult): Promise<ActionOutcome> =>
    observeScreenAfter(io, result, false);

  switch (name) {
    case 'screenshot':
      return { observation: await io.frames.screenshot() };

    case 'zoom': {
      // The driver's zoom is window-scoped, so desktop magnification comes
      // from Buddy's own full-resolution crop of the same frame.
      const region = readRegion(input, (frameId) => io.frames.checkFrame(frameId));
      if ('error' in region) return { error: region.error };
      return { observation: await io.frames.zoom(region.region) };
    }

    case 'cursor_position': {
      const result = await io.call('get_cursor_position', {});
      const failure = toError(result);
      return failure ? { error: failure } : { text: result.text };
    }

    case 'wait': {
      const seconds = clamp(number(input['duration']) ?? 1, 0, MAX_WAIT_SECONDS);
      await sleep(seconds * 1000);
      return { observation: await io.frames.screenshot() };
    }

    case 'mouse_move': {
      const to = await readTarget(io, input, 'coordinate', POINTER_TRAVEL_MS);
      if ('error' in to) return { error: to.error };
      if ('absent' in to) return invalid('mouse_move needs coordinate: [x, y].');
      return observeAfter(await io.call('move_cursor', { target: DESKTOP_TARGET, x: to.x, y: to.y }));
    }

    case 'left_click_drag': {
      // Only the start is gated: one refusal per window, not two.
      const from = await readTarget(io, input, 'start_coordinate', 0, LOOK_FIRST);
      const to = await readTarget(io, input, 'coordinate', DRAG_DURATION_MS);
      if ('error' in from) return { error: from.error };
      if ('error' in to) return { error: to.error };
      if ('absent' in from || 'absent' in to) {
        return invalid('left_click_drag needs start_coordinate and coordinate.');
      }
      return observeAfter(
        await io.call('drag', {
          target: DESKTOP_TARGET,
          from_x: from.x,
          from_y: from.y,
          to_x: to.x,
          to_y: to.y,
        }),
      );
    }

    case 'scroll': {
      const direction = text(input['scroll_direction']);
      if (!['up', 'down', 'left', 'right'].includes(direction)) {
        return invalid('scroll needs scroll_direction: up, down, left or right.');
      }
      const at = await readTarget(io, input, 'coordinate', POINTER_TRAVEL_MS);
      if ('error' in at) return { error: at.error };
      return observeAfter(
        await io.call('scroll', {
          target: DESKTOP_TARGET,
          direction,
          amount: clamp(number(input['scroll_amount']) ?? DEFAULT_SCROLL_CLICKS, 1, MAX_SCROLL_CLICKS),
          ...('absent' in at ? {} : { x: at.x, y: at.y }),
        }),
      );
    }

    case 'type': {
      const value = text(input['text']);
      if (!value) return invalid('type needs text.');
      claimTyping(io.hooks, value.length);
      // Sent in pieces so a stop request lands between them rather than
      // after the whole message has been written.
      let result = await io.call('type_text', { target: DESKTOP_TARGET, text: value.slice(0, TYPE_CHUNK) });
      for (let at = TYPE_CHUNK; at < value.length && !result.isError; at += TYPE_CHUNK) {
        if (signal?.aborted) break;
        result = await io.call('type_text', { target: DESKTOP_TARGET, text: value.slice(at, at + TYPE_CHUNK) });
      }
      return observeAfter(result);
    }

    case 'key': {
      const combo = parseKeyCombo(text(input['text']));
      if (!combo) return invalid('key needs text: one key with optional modifiers, e.g. "cmd+s".');
      const repeat = clamp(number(input['repeat']) ?? 1, 1, MAX_KEY_REPEAT);
      if (namesElement(input)) {
        const refused = await focusForKeys(io, input);
        if (refused) return { error: refused };
      }
      let result = await pressKey(io, combo);
      for (let i = 1; i < repeat && !result.isError; i++) {
        await sleep(40);
        result = await pressKey(io, combo);
      }
      return observeAfter(result);
    }

    default: {
      // A click. The driver takes the button and count directly.
      const click = CLICK_BUTTONS[name]!;
      const modifiers = modifierNames(input['modifiers']);
      if (!modifiers) return invalid('modifiers must be a list of key names, e.g. ["cmd"].');
      const at = await readTarget(io, input, 'coordinate', POINTER_TRAVEL_MS, LOOK_FIRST);
      if ('error' in at) return { error: at.error };
      return observeAfter(
        await io.call('click', {
          target: DESKTOP_TARGET,
          button: click.button,
          count: click.count,
          ...('absent' in at ? {} : { x: at.x, y: at.y }),
          ...(modifiers.length > 0 ? { modifier: modifiers } : {}),
        }),
      );
    }
  }
}

function pressKey(io: CuaIo, combo: KeyCombo): Promise<DriverToolResult> {
  claimKeys(io.hooks, [...combo.modifiers, combo.key]);
  return io.call('press_key', {
    target: DESKTOP_TARGET,
    key: DRIVER_KEYS[combo.key] ?? combo.key,
    ...(combo.modifiers.length > 0 ? { modifiers: combo.modifiers } : {}),
  });
}

/** The keys held during a click, or null when the field is malformed. */
function modifierNames(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const names = value.map((part) => (typeof part === 'string' ? part.trim().toLowerCase() : '')).filter(Boolean);
  return names.length === value.length ? names : null;
}

/**
 * Read a coordinate, check it against the frame it was measured in, and
 * convert it to the native desktop pixels the driver addresses. Also tells
 * the safety rails where the pointer is about to be — without that, the
 * driver's own cursor movement reads as the user grabbing the mouse.
 *
 * `lookFirst` applies the look-before-you-click rule, which is why this is
 * async. Both checks run before anything is claimed: an action that will be
 * refused must not leave the rails believing the pointer moved.
 */
async function readTarget(
  io: CuaIo,
  input: Record<string, unknown>,
  field: string,
  travelMs: number,
  lookFirst = false,
): Promise<{ x: number; y: number } | { error: ComputerError } | { absent: true }> {
  const read = readPoint(input, field, (frameId) => io.frames.checkFrame(frameId));
  if ('error' in read || 'absent' in read) return read;

  const [x, y] = read.point;
  const screen = io.frames.toScreen(x, y);
  if (lookFirst) {
    const unread = await unreadWindowAt(io, screen.x, screen.y);
    if (unread) return { error: unread };
  }
  claimMouse(io.hooks, screen.x, screen.y, travelMs);

  const point = io.frames.toNative(x, y);
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
