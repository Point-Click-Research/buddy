// The window and element actions: finding windows, reading one window's
// elements, and acting on an element by ref.
//
// This is the accessibility path, and it is the one Buddy prefers. An
// element action names exactly what it touches, works on a window that isn't
// frontmost, and moves neither the pointer nor the keyboard focus — so the
// model stops guessing pixels and the user keeps their place.

import { clamp, invalid, number, sleep, text, unsupported } from './args';
import { claimTyping } from './claim';
import { effectNote, observeScreenAfter, toError, type CuaIo, type DriverToolResult } from './cua-io';
import { computerError, type ComputerError } from './errors';
import type { ActionOutcome, WindowObservationView } from './provider';
import {
  formatRows,
  inView,
  parseWindowTree,
  PRESS_ACTION,
  renderTree,
  subtreeOf,
  treeCaveat,
  type RefRow,
  type WindowTree,
} from './tree';
import { conditionHolds, needsJev, pickElement, pickNote } from './judgement';
import type { WindowObservation } from './observations';
import {
  activePid,
  formatRunningApps,
  formatWindows,
  frontWindow,
  parseRunningApps,
  parseWindows,
  windowAt,
  type WindowRecord,
} from './window-list';

/**
 * Bound the driver's tree walk. Its own ceiling is 2000 nodes and up to 20
 * seconds, which a menu-heavy Electron app will happily reach; Buddy filters
 * most of that away afterwards, so paying for it twice serves nobody.
 */
const MAX_WALK = 800;

/**
 * Typing is sent in pieces so a stop request lands between them rather than
 * after the whole message has been written.
 */
const TYPE_CHUNK = 40;

/** Exported for tests; the provider is the only production caller. */
export async function runWindowAction(
  name: string,
  input: Record<string, unknown>,
  io: CuaIo,
  signal?: AbortSignal,
): Promise<ActionOutcome> {
  switch (name) {
    case 'list_apps': {
      const result = await io.call('list_apps', {});
      const failure = toError(result);
      return failure ? { error: failure } : { text: formatRunningApps(parseRunningApps(result.structuredJson)) };
    }

    case 'list_windows': {
      const listed = await listWindows(io);
      if ('error' in listed) return { error: listed.error };
      return { text: formatWindows(listed.windows, await frontPid(io)) };
    }

    case 'get_window_state': {
      const target = await resolveWindow(io, input);
      if ('error' in target) return { error: target.error };
      const query = text(input['query']);
      return observeWindow(io, target, query ? { query } : {});
    }

    case 'expand_element': {
      const found = io.observations.resolve(input['observation_id'], input['ref']);
      if ('error' in found) return { error: found.error };
      const rows = subtreeOf(found.observation.rows, found.element.ref);
      if (rows.length <= 1) return { text: `${found.element.ref} has no elements inside it.` };
      // A huge branch gets the same overview treatment as a huge window.
      return { text: `Inside ${found.element.ref}:\n${renderTree(rows.slice(1)).text}` };
    }

    case 'wait_for':
      return waitFor(io, input, signal);

    // Focus and menus change the whole screen, so the screen is what comes
    // back from both, rather than one window's elements.
    case 'bring_to_front': {
      const target = await resolveWindow(io, input);
      if ('error' in target) return { error: target.error };
      return observeScreenAfter(
        io,
        await io.call('bring_to_front', { pid: target.pid, window_id: target.windowId }),
      );
    }

    case 'invoke_menu': {
      const path = menuPath(input['path']);
      if (!path) return invalid('invoke_menu needs path: the menu labels in order, e.g. ["File", "Save"].');
      const target = await resolveWindow(io, input);
      if ('error' in target) return { error: target.error };
      return observeScreenAfter(
        io,
        await io.call('invoke_menu', {
          pid: target.pid,
          window_id: target.windowId,
          path,
        }),
      );
    }

    case 'click_element':
      return actOnElement(
        io,
        input,
        (target) => io.call('click', { ...target }),
        (element, observation) => visible(element, observation) ?? pressable(element),
      );

    // No pressable gate: context menus open on rows and text that answer to
    // no AXPress, and the driver reports its own failure if there is one.
    case 'right_click_element':
      return actOnElement(
        io,
        input,
        (target) => io.call('click', { ...target, button: 'right' }),
        visible,
      );

    case 'set_value': {
      const value = text(input['value']);
      if (!value) return invalid('set_value needs value.');
      return actOnElement(io, input, (target) => io.call('set_value', { ...target, value }));
    }

    case 'type_into': {
      const value = text(input['text']);
      if (!value) return invalid('type_into needs text.');
      return actOnElement(io, input, async (target) => {
        // Claimed only once the ref is known good, so a refused action does
        // not blind the takeover rails for typing that never happens.
        claimTyping(io.hooks, value.length);
        const into = { ...target };
        let result = await io.call('type_text', { ...into, text: value.slice(0, TYPE_CHUNK) });
        for (let at = TYPE_CHUNK; at < value.length && !result.isError; at += TYPE_CHUNK) {
          if (signal?.aborted) break;
          result = await io.call('type_text', { ...into, text: value.slice(at, at + TYPE_CHUNK) });
        }
        return result;
      });
    }

    default:
      return unsupported(`"${name}" is not a window or element action.`);
  }
}

/** The pid and window_id an action addresses: the model's, or the front window. */
interface WindowTarget {
  pid: number;
  windowId: number;
}

/**
 * Which window an action is about. The driver addresses a window by pid and
 * window_id together, but a model will naturally send only the window_id it
 * read off a list — so the missing half is looked up rather than quietly
 * replaced with some other window.
 */
async function resolveWindow(
  io: CuaIo,
  input: Record<string, unknown>,
): Promise<WindowTarget | { error: ComputerError }> {
  const pid = integer(input['pid']);
  const windowId = integer(input['window_id']);
  if (pid !== null && windowId !== null) return { pid, windowId };

  const listed = await listWindows(io);
  if ('error' in listed) return { error: listed.error };
  const { windows } = listed;

  if (windowId !== null) {
    const named = windows.find((window) => window.windowId === windowId);
    if (!named) {
      return {
        error: computerError(
          'INVALID_REQUEST',
          `No window ${windowId} is open. Call list_windows and use a window_id from it.`,
        ),
      };
    }
    return { pid: named.pid, windowId: named.windowId };
  }

  const front = frontWindow(windows, pid ?? (await frontPid(io)));
  if (!front) {
    return {
      error: computerError(
        'INVALID_REQUEST',
        'No window is open to act on. Open the app first, or name a window_id from list_windows.',
      ),
    };
  }
  return { pid: front.pid, windowId: front.windowId };
}

/**
 * The look-before-you-click rule, enforced here rather than asked for in the
 * prompt. Told to prefer elements, a model with a clear screenshot in hand
 * still clicks pixels — two runs of the same task used the element list once
 * and then not at all. So the first committing click in a window is refused
 * until that window has been read.
 *
 * It costs one refusal per window and never blocks a legitimate pixel click:
 * once the window has been read, the very same coordinate goes through, which
 * is what canvases, games and apps like Safari that hide their content need.
 */
export async function unreadWindowAt(io: CuaIo, x: number, y: number): Promise<ComputerError | null> {
  // Somewhere already read covers this point, so no question to ask.
  if (io.observations.covers(x, y)) return null;

  const listed = await listWindows(io);
  // If the driver cannot say what is there, let the action through: this
  // rule exists to make the model look, not to stop it working.
  if ('error' in listed) return null;
  // The frontmost app decides ties, or a stack of null z_indexes attributes
  // a click in the front window to whatever large window sits behind it.
  const under = windowAt(listed.windows, x, y, await frontPid(io));
  if (!under || io.observations.hasLookedAt(under.pid, under.windowId)) return null;

  return computerError(
    'WINDOW_NOT_READ',
    `That point is inside "${under.title || under.app}" (pid ${under.pid}, window_id ${under.windowId}), ` +
      'whose elements you have not read.',
  );
}

/** The open windows, never including Buddy's own: it is not a target. */
async function listWindows(io: CuaIo): Promise<{ windows: WindowRecord[] } | { error: ComputerError }> {
  const result = await io.call('list_windows', {});
  const failure = toError(result);
  if (failure) return { error: failure };
  return { windows: parseWindows(result.structuredJson).filter((window) => window.pid !== process.pid) };
}

/** The frontmost app's pid, or null if the driver won't say. */
async function frontPid(io: CuaIo): Promise<number | null> {
  const result = await io.call('list_apps', {});
  return toError(result) ? null : activePid(parseRunningApps(result.structuredJson));
}

/**
 * Run one element action. The element is resolved first — by ref, or by the
 * plain words in `element` — so a superseded ref is refused before anything
 * happens, and the window is read again afterwards because the action has
 * just replaced the driver's index map anyway.
 *
 * A stale ref gets one chance at recovery before the refusal: when Jev is
 * configured, the element as it was shown is matched against the window's
 * current rows, and a confident match proceeds — the agent-desktop
 * re-identification contract, without spending a model turn on it.
 */
async function actOnElement(
  io: CuaIo,
  input: Record<string, unknown>,
  run: (target: { pid: number; window_id: number; element_token: string }) => Promise<DriverToolResult>,
  suits: (element: RefRow, observation: WindowObservation) => ComputerError | null = () => null,
): Promise<ActionOutcome> {
  const wanted = text(input['element']);
  let found =
    wanted && input['ref'] === undefined
      ? await describedElement(io, input, wanted)
      : io.observations.resolve(input['observation_id'], input['ref']);
  let note = !('error' in found) && wanted ? pickNote(wanted, found.element) : undefined;
  if ('error' in found && found.error.code === 'STALE_OBSERVATION') {
    const rebound = await rebindStaleRef(io, input['observation_id'], input['ref']);
    if (rebound) {
      found = rebound;
      note =
        `Ref ${String(input['ref'])} was stale; it matched ${rebound.element.ref} in the window's ` +
        'current elements, so the action proceeded there.';
    }
  }
  if ('error' in found) return { error: found.error };
  const { element, observation } = found;
  if (!element.token) {
    return { error: computerError('REFUSED', `${element.ref} has no handle the driver can act on.`) };
  }
  const unsuitable = suits(element, observation);
  if (unsuitable) return { error: unsuitable };

  const result = await run({
    pid: observation.pid,
    window_id: observation.windowId,
    element_token: element.token,
  });
  const failure = toError(result);
  if (failure) return { error: failure };
  await sleep(io.settleMs);
  return observeWindow(
    io,
    { pid: observation.pid, windowId: observation.windowId },
    {},
    [note, effectNote(result)].filter(Boolean).join(' ') || undefined,
  );
}

/**
 * The element `wanted` names, in the window the input addresses (the front
 * one by default): read it fresh, then let Jev pick. The step the model
 * saves is the get_window_state call it would otherwise make just to learn
 * a ref. An unconfident pick is refused rather than guessed.
 */
async function describedElement(
  io: CuaIo,
  input: Record<string, unknown>,
  wanted: string,
): Promise<{ element: RefRow; observation: WindowObservation } | { error: ComputerError }> {
  if (!io.jev) return { error: needsJev('element') };
  const target = await resolveWindow(io, input);
  if ('error' in target) return target;
  const read = await observeWindow(io, target, {});
  const observation =
    read.observation?.kind === 'window' ? io.observations.observationById(read.observation.observationId) : null;
  if (!observation) {
    return { error: computerError('REFUSED', `That window could not be read, so "${wanted}" could not be found in it.`) };
  }
  const element = await pickElement(io.jev, observation.rows, windowLabel(observation), wanted);
  if (!element) {
    return {
      error: computerError(
        'INVALID_REQUEST',
        `Nothing in "${observation.title || observation.app}" confidently matched "${wanted}". Read the window with get_window_state and act by ref.`,
      ),
    };
  }
  return { element, observation };
}

/**
 * Match a stale ref's element against the window's current rows, by Jev.
 * Null — and so the ordinary refusal — when Jev is not configured, the
 * element or window is unknown, or the answer is not confident.
 */
async function rebindStaleRef(
  io: CuaIo,
  observationId: unknown,
  ref: unknown,
): Promise<{ element: RefRow; observation: WindowObservation } | null> {
  if (!io.jev) return null;
  const stale = io.observations.staleElement(observationId, ref);
  if (!stale) return null;
  const sameRole = stale.current.rows.filter((row) => row.role === stale.element.role);
  const element = await pickElement(
    io.jev,
    sameRole.length > 0 ? sameRole : stale.current.rows,
    windowLabel(stale.current),
    `the same control as this element, from before the window was re-read: ${formatRows([stale.element])}`,
  );
  return element ? { element, observation: stale.current } : null;
}

/** How a window reads to Jev: its title and app. */
export function windowLabel(observation: WindowObservation): string {
  return `${observation.title || 'untitled'} (${observation.app})`;
}

/**
 * Read a window and bind its elements to fresh refs. If the window has gone
 * — a dialog that closed, an app that quit — fall back to the screen, which
 * is the honest answer to "what happened".
 */
async function observeWindow(
  io: CuaIo,
  target: WindowTarget,
  extra: Record<string, unknown>,
  note?: string,
): Promise<ActionOutcome> {
  const read = async (pid: number): Promise<DriverToolResult> =>
    io.call('get_window_state', {
      pid,
      window_id: target.windowId,
      // The window's own picture is deliberately never requested: it has its
      // own pixel space, and a second coordinate space is a misclick waiting
      // to happen. Pixels come from screenshot and zoom, structure from here.
      include_screenshot: false,
      max_elements: MAX_WALK,
      ...extra,
    });

  let result = await read(target.pid);
  // macOS runs a sandboxed app's Open and Save panels in another process, so
  // the window an app appears to own is really the panel service's. The
  // driver refuses it and names the real owner; that retry is the difference
  // between reading a Save dialog and being blind to it.
  const owner = ownerPidOf(result);
  if (owner !== null && owner !== target.pid) result = await read(owner);

  const failure = toError(result);
  const tree = failure ? null : parseWindowTree(result.structuredJson);
  if (!tree || !tree.snapshotId) {
    // Remember the attempt, or the look-before-you-click rule would keep
    // refusing clicks in a window that can never be read.
    io.observations.noteUnreadable(target.pid, target.windowId);
    return {
      text: [note, `That window could not be read (${failure?.detail ?? 'no elements'}), so here is the screen.`]
        .filter(Boolean)
        .join(' '),
      observation: await io.frames.screenshot(),
    };
  }

  const recorded = io.observations.record({
    observationId: tree.snapshotId,
    pid: tree.pid || target.pid,
    windowId: tree.windowId || target.windowId,
    app: tree.app,
    title: tree.title,
    elements: tree.elements,
  });
  const rendered = renderTree(recorded.rows);
  const view: WindowObservationView = {
    kind: 'window',
    observationId: recorded.observationId,
    pid: recorded.pid,
    windowId: recorded.windowId,
    app: recorded.app,
    title: recorded.title,
    tree: rendered.text,
    shown: rendered.shown,
    kept: recorded.rows.length,
    total: tree.total,
    ...caveat(tree.degradedReason || treeCaveat(tree.app, tree.elements)),
  };
  return { ...(note ? { text: note } : {}), observation: view };
}

/** How often wait_for re-reads the window, and how long it may wait. */
const WAIT_POLL_MS = 1_000;
const MAX_WAIT_FOR_SECONDS = 30;
const DEFAULT_WAIT_FOR_SECONDS = 10;

/**
 * Poll a window until something is true of its elements, instead of blind
 * sleeps between screenshots. Exact predicates (element_text + until) need
 * no model at all; a plain-language condition is judged by Jev each poll.
 * Ends with a fresh recorded observation either way — polling reads the
 * window without recording, so the refs the model holds die only once.
 */
async function waitFor(
  io: CuaIo,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ActionOutcome> {
  const target = await resolveWindow(io, input);
  if ('error' in target) return { error: target.error };
  const wanted = text(input['element_text']).toLowerCase();
  const condition = text(input['condition']);
  const until = text(input['until']) || 'appears';
  if (!['appears', 'gone', 'changed'].includes(until)) {
    return invalid('until must be appears, gone or changed.');
  }
  if (!wanted && !condition) return invalid('wait_for needs element_text (with until) or condition.');
  if (condition && !io.jev) return { error: needsJev('condition') };

  const timeoutMs = clamp(number(input['duration']) ?? DEFAULT_WAIT_FOR_SECONDS, 1, MAX_WAIT_FOR_SECONDS) * 1000;
  const started = Date.now();
  /** The matched element's state on the first poll, for until: changed. */
  let baseline: string | null | undefined;
  let met = false;
  for (;;) {
    if (signal?.aborted) break;
    const tree = await peekTree(io, target);
    if (tree) {
      if (condition) {
        met = await conditionHolds(io.jev!, tree.elements, `${tree.title} (${tree.app})`, condition);
      } else {
        const match = tree.elements.find((element) =>
          `${element.name} ${element.value} ${element.role}`.toLowerCase().includes(wanted),
        );
        if (until === 'appears') met = match !== undefined;
        else if (until === 'gone') met = match === undefined;
        else {
          const state = match ? `${match.value}|${match.selected}` : null;
          if (baseline === undefined) baseline = state;
          else met = state !== baseline;
        }
      }
    }
    const left = timeoutMs - (Date.now() - started);
    if (met || left <= 0) break;
    await sleep(Math.min(WAIT_POLL_MS, left));
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const what = condition || `"${text(input['element_text'])}" to ${until === 'appears' ? 'appear' : until === 'gone' ? 'disappear' : 'change'}`;
  return observeWindow(
    io,
    target,
    {},
    met
      ? `Condition met after ${elapsed}s. Here is the window now (fresh refs).`
      : `Timed out after ${elapsed}s still waiting for ${what}. Here is the window now (fresh refs).`,
  );
}

/**
 * Read a window's tree without recording it. Polling must not supersede the
 * observation the model is parked on; only wait_for's final read does that.
 */
async function peekTree(io: CuaIo, target: WindowTarget): Promise<WindowTree | null> {
  const result = await io.call('get_window_state', {
    pid: target.pid,
    window_id: target.windowId,
    include_screenshot: false,
    max_elements: MAX_WALK,
  });
  return toError(result) ? null : parseWindowTree(result.structuredJson);
}

/**
 * Not everything can be pressed. A text area answers to having its value
 * set, not to a press, and the driver's own failure for that is a raw AX
 * error code. The element told us which actions it takes when it was read,
 * so the answer is available before the call rather than after it.
 */
/** Roles a keystroke lands in once they have focus. */
const EDITABLE_ROLES = new Set(['textfield', 'searchfield', 'textarea', 'combobox', 'securetextfield']);

/**
 * `key` with an element named: a text field is clicked so the keys land in
 * it (what "press Return in the search box" means). Anything else is refused
 * with the action that would do it, since a click on a button would already
 * be the whole step. Returns the refusal, or null once the field has focus.
 */
export async function focusForKeys(io: CuaIo, input: Record<string, unknown>): Promise<ComputerError | null> {
  const focused = await actOnElement(
    io,
    input,
    (target) => io.call('click', { ...target }),
    (element, observation) =>
      visible(element, observation) ??
      (EDITABLE_ROLES.has(element.role)
        ? null
        : computerError(
            'INVALID_REQUEST',
            `${element.ref} is a ${element.role}, not a text field, so keys cannot be sent into it. To press it, click_element it; to press keys where focus already is, send key without a ref.`,
          )),
  );
  return focused.error ?? null;
}

/**
 * A click by ref goes to the element's screen coordinates, so an element the
 * page has scrolled past the window's edge is refused: the click would land
 * on whatever is really there — on a checkout it was the Dock, sliding up
 * under a pointer parked at the bottom of the screen.
 */
function visible(element: RefRow, observation: WindowObservation): ComputerError | null {
  if (inView(element.bounds, observation.bounds)) return null;
  return computerError(
    'OFF_VIEW',
    `${element.ref} is outside the window's visible area, so a click there would not reach it.`,
  );
}

function pressable(element: RefRow): ComputerError | null {
  if (element.actions.length === 0 || element.actions.includes(PRESS_ACTION)) return null;
  return computerError(
    'INVALID_REQUEST',
    `${element.ref} is a ${element.role} and cannot be pressed. ` +
      'Use set_value or type_into to put text in it, or click its coordinate if it only responds to a real click.',
  );
}

/** The real owner the driver names when a window belongs to another process. */
function ownerPidOf(result: DriverToolResult): number | null {
  if (!result.isError) return null;
  const said = `${result.errorCode ?? ''} ${result.text} ${result.structuredJson ?? ''}`;
  const found = /owner_pid\D{0,4}(\d+)/.exec(said);
  return found ? Number(found[1]) : null;
}

function caveat(reason: string): { degradedReason?: string } {
  return reason ? { degradedReason: reason } : {};
}

function menuPath(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const path = value.map((part) => (typeof part === 'string' ? part.trim() : '')).filter(Boolean);
  return path.length === value.length ? path : null;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}
