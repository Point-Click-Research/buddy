// One session at a time. A session is a turn's AbortController: Escape or the
// chord aborts it, and everything the turn started (transcription,
// screenshots, the model stream, speech) stops with it. This module owns
// that controller and the three ways a session ends: it finishes, it is
// cancelled, or it fails.

import { isAgentActive } from '../agent/agent';
import { isQuestionPending } from '../agent/control-tools';
import { friendlyApiError } from '../ai/api-errors';
import { withTurnScope } from '../ai/turn-scope';
import { setActivity } from '../activity';
import { beginTurn } from '../chat/conversations';
import { isFollowAlongActive, stopFollowAlong } from '../followalong/runner';
import { createLogger } from '../log';
import { clearMarks, endCapture as endMarkCapture } from '../marks/marks';
import { isConfirmationPending } from '../mcp/confirm';
import { hideSelection } from '../selection';
import type { CaptionPacer } from '../speech/captions';
import { cancelSpeech } from '../speech/tts';
import { getState, setState } from '../state';
import { SIGN_IN_MESSAGE, signInRequired } from '../account/credentials';
import { broadcast, openHomeWindow } from '../windows';
import { stopListening } from './listening';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('session');

/** Errors are dead ends: after this long the state returns to idle so the next question works. */
const ERROR_RECOVERY_MS = 4_000;

let abortController: AbortController | null = null;

// The caption pacer types the current sentence out on its own timers, which
// outlive the turn's AbortController (Escape while Buddy is still speaking
// finds the controller already released). cancel() stops it directly so a
// queued word can never resurrect the bubble a cancel just took down.
let activePacer: CaptionPacer | null = null;

export function setActivePacer(pacer: CaptionPacer): void {
  activePacer = pacer;
}

// A scripted run (the first-run lines and tour) speaks between turns. Any
// real turn, chord press, or Escape ends it, so Buddy never talks over the user.
let script: AbortController | null = null;

/** Start a scripted run, ending any earlier one. The signal aborts when the user takes over. */
export function beginScript(): AbortSignal {
  script?.abort();
  script = new AbortController();
  return script.signal;
}

export function endScript(): void {
  script?.abort();
  script = null;
}

/**
 * Run one turn as the current session: take over the AbortController, run
 * the turn with its signal, report a failure, and release the controller —
 * unless a newer session already took over, since a cancelled turn can
 * finish long after the next one started, and clearing the live controller
 * would leave that turn uncancellable.
 */
export async function runSession(turn: (signal: AbortSignal) => Promise<void>): Promise<void> {
  // Nothing runs for someone who is not signed in; the window shows the way in.
  if (signInRequired()) {
    showSessionError(SIGN_IN_MESSAGE);
    openHomeWindow();
    return;
  }
  endScript();
  const controller = new AbortController();
  abortController = controller;
  beginTurn();
  try {
    await withTurnScope('talk', () => turn(controller.signal));
  } catch (error) {
    if (controller.signal.aborted) return; // cancellation is not an error
    failSession(error);
  } finally {
    if (abortController === controller) abortController = null;
  }
}

/**
 * The signal short transcriptions run under: the session's while one is
 * live. During agent tasks there is none; answers are short, so an
 * unabortable signal is fine.
 */
export function answerSignal(): AbortSignal {
  return abortController?.signal ?? new AbortController().signal;
}

/** Stop everything in flight and return to idle. Never touches always-on. */
export function cancel(): void {
  endScript();
  if (getState() === 'listening') stopListening(true);
  endMarkCapture();
  clearMarks(); // the turn they belonged to is over
  abortController?.abort();
  abortController = null;
  if (isFollowAlongActive()) stopFollowAlong();
  cancelSpeech();
  activePacer?.stop();
  setActivity(null);
  hideSelection();
  // The overlay caption follows the spoken answer; a cancelled answer should
  // not sit on screen for its scheduled reading time.
  broadcast(IpcChannels.sessionCancelled);
  setState('idle');
}

/** Report an error and recover to idle so the next question works. */
function failSession(error: unknown): void {
  cancelSpeech();
  activePacer?.stop();
  setActivity(null);
  showSessionError(friendlyApiError(error));
}

/** Show an error to the user, then return to idle after a beat. */
export function showSessionError(message: string): void {
  log.error(message);
  broadcast(IpcChannels.sessionError, message);
  setState('error');
  setTimeout(() => {
    if (getState() === 'error') setState('idle');
  }, ERROR_RECOVERY_MS);
}

/** Nothing intelligible was heard: shrug it off without calling the brain. */
export function sayNothingHeard(): void {
  broadcast(IpcChannels.sessionResponseDelta, "Sorry, I didn't catch that.");
  broadcast(IpcChannels.sessionResponseDone);
  setState('idle');
}

/** A card, a question, or a running task owns the microphone and the state. */
export function isBusyWithTask(): boolean {
  return isConfirmationPending() || isQuestionPending() || isAgentActive();
}

/** Refuse a new ask while a task has Buddy. True when refused. */
export function rejectIfBusy(): boolean {
  if (!isBusyWithTask()) return false;
  broadcast(IpcChannels.sessionError, 'Buddy is busy with a task. Wait for it to finish, or stop it first.');
  return true;
}
