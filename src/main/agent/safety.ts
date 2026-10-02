// Safety rails for anything that drives the computer: the kill switch
// (Escape in Watch mode, Ctrl+Option+Escape in Buddy's browser), action/time
// limits, user-takeover detection, the excluded-apps list, the screen-lock/
// sleep stop, and the visible "Buddy is driving" state. Coding rule: every
// agent action must pass beforeAction() before the input driver may run.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { powerMonitor } from 'electron';
import { activeWindow } from 'get-windows';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { APP_NAME, type AgentTaskMode } from '../../shared/types';
import { createLogger } from '../log';
import { getSettings } from '../settings';
import { isConfirmationPending } from '../mcp/confirm';
import { isQuestionPending } from './control-tools';
import { setDrivingHud } from '../windows';
import type { DriverSafetyHooks } from '../computer/claim';
import { AgentMouseTracker, SyntheticKeyFilter } from './synthetic';

const log = createLogger('safety');

export type DrivingEvent =
  | { type: 'kill'; message: string }
  | { type: 'takeover'; message: string }
  | { type: 'excluded-app'; message: string }
  | { type: 'stalled'; message: string }
  | { type: 'limit'; message: string };

/** Mutating actions in a row that changed nothing on screen before the task pauses to ask. */
const STALL_LIMIT = 3;
/**
 * The same action this many times in a row gets a nudge, and twice as many
 * pauses the task. Scrolling moves the screen, so the stall check never sees
 * a hunt down a long list; this does, before it spends the whole budget.
 */
const REPEAT_NUDGE = 5;
const REPEAT_LIMIT = REPEAT_NUDGE * 2;
/**
 * The same action failing this many times running pauses the task. A model
 * that retries a refused call word for word (set_value on a field that will
 * not take it, nine times in a Spotify run) is not getting closer, and the
 * coarser repeat count above would let it spend ten turns finding out.
 */
const FAILURE_LIMIT = 3;

interface DrivingSession {
  displayId: number;
  /**
   * Watch: Escape kills, takeover pauses, the frontmost app is checked
   * against the excluded list. Browser: the user keeps working elsewhere, so
   * takeover is off, only Ctrl+Option+Escape kills, and the excluded check
   * holds the page the action lands on instead.
   */
  mode: AgentTaskMode;
  startedAt: number;
  actionsUsed: number;
  /** Consecutive mutating actions whose screen came back unchanged. */
  stalled: number;
  /** The last mutating action and how many times in a row it has run. */
  repeat: { name: string; count: number };
  /** The last action to fail and how many times in a row it has. */
  failing: { name: string; count: number };
  /** Stop reason; once set, no further action may run. */
  stopped: string | null;
  /** Paused (takeover / excluded app): resumable, but actions are blocked. */
  paused: boolean;
}

let session: DrivingSession | null = null;
let listener: ((event: DrivingEvent) => void) | null = null;
let tapsInstalled = false;

const keyFilter = new SyntheticKeyFilter();
const mouseTracker = new AgentMouseTracker();

/** The input driver reports its own activity here (see DriverSafetyHooks). */
export const driverHooks: DriverSafetyHooks = {
  recordKey: (keycode, direction) => keyFilter.record(keycode, direction, Date.now()),
  recordMousePosition: (x, y) => mouseTracker.recordPosition(x, y),
  markTyping: (ms) => keyFilter.markTyping(Date.now() + ms),
  markMouseActivity: (ms) => mouseTracker.markActivity(Date.now() + ms),
};

/** Start a driving session on one display: shows the HUD, arms the rails. */
export function startDriving(
  displayId: number,
  mode: AgentTaskMode,
  onEvent: (event: DrivingEvent) => void,
): void {
  installUiohookTaps();
  installPowerTaps();
  keyFilter.reset();
  mouseTracker.reset();
  session = {
    displayId,
    mode,
    startedAt: Date.now(),
    actionsUsed: 0,
    stalled: 0,
    repeat: { name: '', count: 0 },
    failing: { name: '', count: 0 },
    stopped: null,
    paused: false,
  };
  listener = onEvent;
  // One fresh chance per task, not three: the diagnostic lookup below spends
  // it while the first model call is still thinking, so a helper that
  // recovered is noticed and one that still hangs never blocks actions for
  // 3 x 1.5s again.
  lookupFailures = Math.min(lookupFailures, MAX_LOOKUP_FAILURES - 1);
  applyHud(displayId, mode);
  log.info(`driving started on display ${displayId} (${mode} mode)`);
  // Diagnostic: what the excluded-apps check sees (and that it works at all).
  void frontmostWindow().then((front) => {
    log.info(front ? `frontmost: ${front.name} — "${front.title}"` : 'frontmost: unavailable');
  });
}

export function stopDriving(): void {
  if (session) log.info(`driving stopped after ${session.actionsUsed} action(s)`);
  session = null;
  listener = null;
  setDrivingHud(null);
}

function isDriving(): boolean {
  return session !== null && session.stopped === null;
}

/** The live task's mode, or null when nothing is driving. */
export function drivingMode(): AgentTaskMode | null {
  return isDriving() ? session!.mode : null;
}

/**
 * The "Buddy is driving" border and pill belong to a task on the user's own
 * screen. Buddy's browser has its own window to show for itself.
 */
function applyHud(displayId: number, mode: AgentTaskMode): void {
  setDrivingHud(mode === 'watch' ? displayId : null);
}

/** Resume after a takeover / excluded-app / stall pause. Stale trackers are reset. */
export function resumeDriving(): void {
  if (!session) return;
  session.paused = false;
  session.stalled = 0;
  session.repeat = { name: '', count: 0 };
  keyFilter.reset();
  mouseTracker.reset();
}

/**
 * Report what an action did to the screen. A mutating action that changed
 * nothing is a click on something that will not budge; STALL_LIMIT of those
 * in a row is a stuck task, so it pauses to ask rather than spending the
 * whole action budget on the same spot. Returns the nudge for the model's
 * tool result when the pause fires. Observation-only actions and window
 * reads carry no verdict and leave the count alone.
 */
export function noteActionEffect(mutating: boolean, screenUnchanged: boolean | null): string | null {
  if (!session || !mutating || screenUnchanged === null) return null;
  if (!screenUnchanged) {
    session.stalled = 0;
    return null;
  }
  if (++session.stalled < STALL_LIMIT) return null;
  session.stalled = 0;
  pauseWith('stalled', `${STALL_LIMIT} actions in a row changed nothing on screen.`);
  return (
    `The last ${STALL_LIMIT} actions changed nothing, so the task is paused for the user. ` +
    'If it continues, do something different: read the window and act by ref, or ask_user.'
  );
}

/**
 * Count the same mutating action run back to back (scroll, scroll, scroll…).
 * At REPEAT_NUDGE the model is told to change approach; at REPEAT_LIMIT the
 * task pauses for the user. Returns the note for the tool result, if any.
 */
export function noteRepeat(name: string, mutating: boolean): string | null {
  if (!session || !mutating) return null;
  session.repeat = session.repeat.name === name ? { name, count: session.repeat.count + 1 } : { name, count: 1 };
  const { count } = session.repeat;
  if (count >= REPEAT_LIMIT) {
    session.repeat = { name: '', count: 0 };
    pauseWith('stalled', `${name} ran ${count} times in a row.`);
    return `That was ${name} ${count} times in a row, so the task is paused for the user. If it continues, do something different or ask_user.`;
  }
  if (count !== REPEAT_NUDGE) return null;
  return name === 'scroll'
    ? `That is ${count} scrolls in a row. Hunting down a long list by scrolling is the slow way: use the app's own search or filter (the teaching notes say where), read the window for the item, or ask_user.`
    : `That is ${name} ${count} times in a row. If it is not getting closer, change approach: read the window, use a shortcut or search, or ask_user.`;
}

/**
 * Count the same action failing back to back. A success clears it. At
 * FAILURE_LIMIT the task pauses for the user and the model is told, in the
 * result it was about to read, that repeating the call is what stopped it.
 */
export function noteFailure(name: string, failed: boolean): string | null {
  if (!session) return null;
  if (!failed) {
    session.failing = { name: '', count: 0 };
    return null;
  }
  session.failing = session.failing.name === name ? { name, count: session.failing.count + 1 } : { name, count: 1 };
  if (session.failing.count < FAILURE_LIMIT) return null;
  session.failing = { name: '', count: 0 };
  pauseWith('stalled', `${name} failed ${FAILURE_LIMIT} times in a row.`);
  return (
    `That was ${name} failing ${FAILURE_LIMIT} times in a row, so the task is paused for the user. ` +
    'If it continues, do not call it again the same way: read the window, use a different action (type_into, a keyboard shortcut, a menu), or ask_user.'
  );
}

/** Frontmost app name + window title, for the model and the excluded-apps check. */
export async function frontmostApp(): Promise<{ name: string; title: string } | null> {
  return frontmostWindow();
}

export function formatFrontmost(front: { name: string; title: string } | null): string {
  if (!front) return 'unknown';
  // Unpackaged, Buddy's own windows report as "Electron", which means
  // nothing to the model — and Buddy's panel is often what the user was
  // last touching when a task begins.
  const name = front.name === 'Electron' ? `${APP_NAME} itself` : front.name;
  return front.title ? `${name} — ${front.title}` : name;
}

export type ActionCheck = { ok: true } | { ok: false; reason: string };

/**
 * The gate every agent action passes before it runs: the task's pause (a
 * takeover or an excluded app waiting on the user), then beforeAction's
 * rails. Tools that act on the user's behalf take one of these from agent.ts.
 */
export type ActionGate = (targetApp?: string | null, synthesizesInput?: boolean) => Promise<ActionCheck>;

/**
 * Must be called (and must return ok) before every agent action. Enforces
 * the stop flag, pause state, action/time limits and excluded apps. Every
 * action — observations included — counts toward "Max actions per task", so
 * a task spinning on reads stops at the same limit as one that clicks.
 *
 * `targetApp` is where this action is about to land (provider.targetApp).
 * In Watch mode the frontmost app is what matters — that is where desktop
 * input goes. In Buddy's browser the user's frontmost app is their own work,
 * so the page the action lands on is what the excluded list holds instead.
 * Observation-only actions pass `synthesizesInput: false`: they land input
 * nowhere, so the excluded-apps check has nothing to hold them to.
 */
export async function beforeAction(
  targetApp?: string | null,
  synthesizesInput = true,
): Promise<ActionCheck> {
  const current = session;
  if (!current) return { ok: false, reason: 'not driving' };
  if (current.stopped) return { ok: false, reason: current.stopped };
  if (current.paused) return { ok: false, reason: 'paused — waiting for the user' };

  const settings = getSettings();
  // Check before counting, so a refused attempt isn't reported as an action.
  if (current.actionsUsed >= settings.agentMaxActions) {
    stopWith(
      'limit',
      `Stopped after ${settings.agentMaxActions} actions. That is the limit for one task. ` +
        'Raise "Max actions per task" in Settings if tasks like this need more.',
    );
    return { ok: false, reason: 'action limit reached' };
  }
  if (Date.now() - current.startedAt > settings.agentMaxMinutes * 60_000) {
    stopWith(
      'limit',
      `Stopped after ${settings.agentMaxMinutes} minutes. That is the time limit for one task. ` +
        'Raise "Max minutes per task" in Settings if tasks like this need more.',
    );
    return { ok: false, reason: 'time limit reached' };
  }

  // Watch mode's input lands on the frontmost app; Buddy's browser's lands
  // on the page the action names.
  const excluded = !synthesizesInput
    ? null
    : current.mode === 'watch'
      ? await frontmostExcludedApp()
      : excludedMatch(targetApp ?? '');
  // The kill switch may have fired while we awaited the frontmost lookup.
  if (session !== current || current.stopped) {
    return { ok: false, reason: current.stopped ?? 'not driving' };
  }
  if (excluded) {
    pauseWith('excluded-app', `"${excluded}" is on the excluded apps list.`);
    return { ok: false, reason: `excluded app: ${excluded}` };
  }
  current.actionsUsed++;
  return { ok: true };
}

/** The excluded-list entry this app/title text matches, if any. */
function excludedMatch(text: string): string | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  return getSettings().agentExcludedApps.find((app) => app && haystack.includes(app.toLowerCase())) ?? null;
}

/** Is the frontmost app on the user's excluded list? Returns the match. */
async function frontmostExcludedApp(): Promise<string | null> {
  if (getSettings().agentExcludedApps.length === 0) return null;
  const front = await frontmostWindow();
  return front ? excludedMatch(`${front.name} ${front.title}`) : null;
}

// get-windows (app name + window title) spawns a helper binary that hangs or
// fails on some setups. A hard timeout keeps it from ever blocking actions;
// after a few failures in a row we stop trying it and use the macOS Launch
// Services fallback (app name only, no permissions needed). Each new task
// re-arms a single attempt — see startDriving.
const LOOKUP_TIMEOUT_MS = 1_500;
const MAX_LOOKUP_FAILURES = 3;
let lookupFailures = 0;

const execFileAsync = promisify(execFile);

async function frontmostWindow(): Promise<{ name: string; title: string } | null> {
  if (lookupFailures < MAX_LOOKUP_FAILURES) {
    try {
      const front = await Promise.race([
        activeWindow(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${LOOKUP_TIMEOUT_MS}ms`)), LOOKUP_TIMEOUT_MS),
        ),
      ]);
      lookupFailures = 0;
      return front ? { name: front.owner.name, title: front.title } : null;
    } catch (error) {
      lookupFailures++;
      log.warn(`activeWindow failed (${lookupFailures}/${MAX_LOOKUP_FAILURES}): ${error instanceof Error ? error.message : error}`);
      if (lookupFailures >= MAX_LOOKUP_FAILURES) {
        log.warn('get-windows unavailable — falling back to Launch Services (app names only)');
      }
    }
  }
  if (process.platform !== 'darwin') return null;
  try {
    return await frontmostViaLaunchServices();
  } catch {
    return null;
  }
}

/** macOS fallback: Launch Services reports the front app; window title unknown. */
async function frontmostViaLaunchServices(): Promise<{ name: string; title: string } | null> {
  const { stdout: asn } = await execFileAsync('lsappinfo', ['front'], { timeout: 1_000 });
  if (!asn.trim()) return null;
  const { stdout: info } = await execFileAsync(
    'lsappinfo',
    ['info', '-only', 'name', asn.trim()],
    { timeout: 1_000 },
  );
  const name = info.match(/"LSDisplayName"="(.+)"/)?.[1];
  return name ? { name, title: '' } : null;
}

function stopWith(type: DrivingEvent['type'], message: string): void {
  if (!session || session.stopped) return;
  session.stopped = message;
  // The visible "driving" state must end the moment the stop is decided,
  // even if the task runner is still awaiting something.
  setDrivingHud(null);
  log.warn(`driving stopped: ${message}`);
  listener?.({ type, message } as DrivingEvent);
}

function pauseWith(type: DrivingEvent['type'], message: string): void {
  if (!session || session.stopped || session.paused) return;
  session.paused = true;
  log.warn(`driving paused: ${message}`);
  listener?.({ type, message } as DrivingEvent);
}

/**
 * Global input taps (piggybacking on the uiohook instance hotkey.ts starts).
 * Synthetic events recorded by the driver are filtered out, so the agent
 * pressing Escape or moving the mouse can never trigger its own rails.
 */
function installUiohookTaps(): void {
  if (tapsInstalled) return;
  tapsInstalled = true;

  uIOhook.on('keydown', (event) => {
    if (!session || session.stopped) return;
    const now = Date.now();
    if (keyFilter.shouldIgnore(event.keycode, 'down', now)) return;
    if (event.keycode === UiohookKey.Escape) {
      // In Buddy's browser the user may be pressing Escape in their own app,
      // so only the deliberate chord kills. Watch mode: Escape alone does.
      if (session.mode !== 'watch') {
        if (event.ctrlKey && event.altKey) stopWith('kill', 'Stopped. You pressed Ctrl+Option+Escape.');
        return;
      }
      stopWith('kill', 'Stopped. You pressed Escape.');
      return;
    }
    // Outside Watch mode the user's typing is their own work, not a takeover.
    if (session.mode !== 'watch') return;
    // Answering Buddy is never a takeover. Enter approves confirmation
    // cards, and the talk chord — keys, to this tap — answers cards and
    // ask_user questions. While Buddy is waiting on the user, a keypress is
    // an answer; pausing on it would spawn a "Continue the task?" card that
    // swallows the spoken answer meant for the question.
    if (event.keycode === UiohookKey.Enter || event.keycode === UiohookKey.NumpadEnter) return;
    if (isConfirmationPending() || isQuestionPending()) return;
    if (!session.paused && !keyFilter.isTyping(now)) {
      pauseWith('takeover', 'You started typing.');
    }
  });

  uIOhook.on('keyup', (event) => {
    // Consume the matching synthetic key-up so recordings don't pile up.
    keyFilter.shouldIgnore(event.keycode, 'up', Date.now());
  });

  uIOhook.on('mousemove', (event) => {
    if (!session || session.stopped || session.paused) return;
    if (session.mode !== 'watch') return; // their mouse is their own work
    if (isConfirmationPending() || isQuestionPending()) return;
    if (mouseTracker.isUserMove(event.x, event.y, Date.now())) {
      pauseWith('takeover', 'You moved the mouse.');
    }
  });
}

/**
 * A locked screen or a sleeping system means nobody is watching and the
 * screen the task was reasoning about is gone — end it, in either mode.
 */
let powerTapsInstalled = false;

function installPowerTaps(): void {
  if (powerTapsInstalled) return;
  powerTapsInstalled = true;
  powerMonitor.on('lock-screen', () => {
    if (session && !session.stopped) stopWith('kill', 'Stopped. The screen locked.');
  });
  powerMonitor.on('suspend', () => {
    if (session && !session.stopped) stopWith('kill', 'Stopped. The system went to sleep.');
  });
}
