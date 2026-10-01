// Buddy following the first run along: a hello when the walk opens, one line
// as each step opens, and a staged tour once the walk is done. Every line is
// fixed text from shared/tour.ts, said from the dot. A chord press, Escape,
// or any real turn ends the script (see lifecycle.ts).

import { IpcChannels } from '../shared/ipc';
import { drawingLine, helloLine, tourStops, walkLine, type TourStopId } from '../shared/tour';
import type { PermissionName } from '../shared/types';
import { accountName } from './account/session';
import { knownPlan } from './account/api';
import { claimTour, noteFinishedOnboarding, reopenTour } from './account/local';
import { circleSomething } from './drawing/demo';
import { dismissAll } from './drawing/tools';
import { beginScript, endScript } from './session/lifecycle';
import { sayLine } from './session/say';
import { cancelSpeech } from './speech/tts';
import { getPermissions } from './permissions';
import { getSettings, updateSettings } from './settings';
import { broadcastSettings } from './settings-view';
import { getState, setState } from './state';
import { broadcast, hideHomeWindow, openHomeWindow, openSettingsWindow } from './windows';

/** Let the overlays and the recorder come up before the first words. */
const HELLO_DELAY_MS = 1_500;
/** How long to wait if the dot is busy when a scripted line is due. */
const IDLE_WAIT_MS = 8_000;
/** A breath between tour stops. */
const STOP_GAP_MS = 700;

/** Steps already spoken for this walk, so Back does not repeat them. */
const spoken = new Set<string>();
/** Users already greeted this run: a token refresh fires the session listener too. */
const greeted = new Set<string>();

/** Wait, unless the script is ended first. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** Wait until the dot is idle, unless the script ends or the walk is finished first. */
async function waitUntilIdle(signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + IDLE_WAIT_MS;
  while (!signal.aborted && getState() !== 'idle' && Date.now() < deadline) {
    await pause(200, signal);
  }
  return !signal.aborted && getState() === 'idle' && !getSettings().onboardingDone;
}

/** Someone signed in (or the stored session came back) and the walk is up. */
export function greetForWalk(userId: string): void {
  const settings = getSettings();
  if (settings.onboardingDone || greeted.has(userId)) return;
  greeted.add(userId);
  spoken.clear();
  const step = settings.onboardingStep || 'name';
  const signal = beginScript();
  void (async () => {
    await pause(HELLO_DELAY_MS, signal);
    // Mark the step only once the line actually starts. Dropping it while the
    // dot is busy used to swallow the hello for the rest of the walk.
    const idle = await waitUntilIdle(signal);
    if (spoken.has(step)) return;
    if (!idle) {
      // The drawing step has no button, so a dot that never settles still ends the walk.
      if (step === 'drawing' && !getSettings().onboardingDone) finishWalk();
      return;
    }
    spoken.add(step);
    // A relaunch mid-walk (a permission grant restarts Buddy) is not a new hello.
    const hello = step === 'name' ? helloLine(accountName().firstName) : '';
    const text = `${hello} ${stepLine(step) ?? ''}`.trim();
    if (text) await sayStep(step, text, signal);
  })();
}

/**
 * Dev restart: this account walks from the top again, including the hello.
 * A line still in flight (or wedged in `speaking`) is cut first, or the new
 * hello would wait on a dot that never returns to idle.
 */
export function replayWalk(userId: string): void {
  greeted.delete(userId);
  spoken.clear();
  endScript();
  if (getState() === 'thinking' || getState() === 'speaking') {
    cancelSpeech();
    setState('idle');
  }
  greetForWalk(userId);
}

/** This step's line, for the user's name and what the permissions step still has to ask for. */
function stepLine(step: string): string | undefined {
  const missing = (Object.entries(getPermissions()) as [PermissionName, string][])
    .filter(([, state]) => state !== 'granted')
    .map(([name]) => name);
  return walkLine(step, accountName().firstName, missing);
}

/** The walk moved to this step. One line, once, and never over a reply that is playing. */
export function sayWalkStep(step: string): void {
  const line = stepLine(step);
  if (!line || spoken.has(step) || getSettings().onboardingDone) return;
  // Cut a scripted line still going. A real turn leaves the state non-idle,
  // and this step stays unspoken so it is not lost.
  const signal = beginScript();
  if (step !== 'drawing') {
    if (getState() !== 'idle') return;
    spoken.add(step);
    void sayStep(step, line, signal);
    return;
  }
  // The drawing step has no button: it must run, so it waits for the dot,
  // and when the dot stays busy the walk still ends, without its demo.
  spoken.add(step);
  void (async () => {
    if (await waitUntilIdle(signal)) await sayStep(step, line, signal);
    else if (!getSettings().onboardingDone) finishWalk();
  })();
}

/**
 * A step's line. The drawing step, the last one, also rings something while
 * it talks, names it, and then finishes the walk itself: nothing is asked of
 * the user, and the tour follows.
 */
async function sayStep(step: string, line: string, signal: AbortSignal): Promise<void> {
  if (step !== 'drawing') return sayLine(line, signal);
  const onStep = (): boolean => !getSettings().onboardingDone && getSettings().onboardingStep === 'drawing';
  const circled = circleSomething(onStep);
  await sayLine(line, signal);
  const named = await circled;
  if (!signal.aborted && onStep()) await sayLine(drawingLine(named), signal);
  if (onStep()) finishWalk();
}

/** The walk is over: the drawing comes down, the flag is set for this account, and the tour starts. */
export function finishWalk(): void {
  dismissAll();
  updateSettings({ onboardingDone: true });
  noteFinishedOnboarding();
  broadcastSettings();
  startTour();
}

/** Settings asked for the tour again. Cut anything speaking first, as replayWalk does. */
export function replayTour(): void {
  reopenTour();
  endScript();
  if (getState() === 'thinking' || getState() === 'speaking') {
    cancelSpeech();
    setState('idle');
  }
  startTour();
}

/** The walk just finished: the tour, once per account. */
export function startTour(): void {
  if (!claimTour()) return;
  spoken.clear();
  const stops = tourStops(accountName().firstName, knownPlan() === 'waitlist');
  const signal = beginScript();
  const setStop = (stop: TourStopId | null): void => broadcast(IpcChannels.tourChanged, stop);
  void (async () => {
    hideHomeWindow();
    await pause(HELLO_DELAY_MS, signal);
    for (const stop of stops) {
      if (signal.aborted) break;
      if (stop.id === 'chats') openHomeWindow();
      if (stop.page) openSettingsWindow(stop.page);
      setStop(stop.id);
      await sayLine(stop.line, signal);
      await pause(STOP_GAP_MS, signal);
    }
    setStop(null);
  })();
}
