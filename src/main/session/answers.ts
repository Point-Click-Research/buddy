// Recordings made while something is already waiting on the user: a
// confirmation card, an ask_user question, a task in Buddy's browser, or a
// walkthrough. These answer that instead of starting a new question.

import type { RecordingResult } from '../../shared/types';
import { isAgentActive, stopAgentTask } from '../agent/agent';
import { isQuestionPending, resolveQuestion } from '../agent/control-tools';
import { drivingMode } from '../agent/safety';
import { isFollowAlongActive, stopFollowAlong } from '../followalong/runner';
import { handleFollowAlongSpeech } from '../followalong/tools';
import { createLogger } from '../log';
import { isConfirmationPending, isConfirmationStrict, resolveConfirmation } from '../mcp/confirm';
import { parseYesNo } from '../mcp/permissions';
import { answerSignal } from './lifecycle';
import { hear } from './listening';

const log = createLogger('session');

const STOPPED_BY_VOICE = 'Stopped. You said "stop."';

/**
 * Hand the recording to whatever is waiting for an answer. True when
 * something was, and the recording is spent; false when nothing was and the
 * caller should treat it as a new question.
 */
export async function routeAnswerRecording(recording: RecordingResult): Promise<boolean> {
  if (isConfirmationPending()) await answerConfirmation(recording);
  else if (isQuestionPending()) await answerQuestion(recording);
  else if (isAgentActive()) await stopIfSaidStop(recording);
  else if (isFollowAlongActive()) await answerWalkthrough(recording);
  else return false;
  return true;
}

/** A recording made while a confirmation card was up: yes or no? */
async function answerConfirmation(recording: RecordingResult): Promise<void> {
  try {
    const transcript = await hear(recording, answerSignal());
    const answer = parseYesNo(transcript);
    log.info(`confirmation answer: "${transcript}" -> ${answer ?? 'unclear'}`);
    // An unclear answer keeps the card up — except for strict confirmations
    // (plan approvals), where anything but a clear yes cancels.
    if (answer !== null) resolveConfirmation(answer);
    else if (isConfirmationStrict()) resolveConfirmation(false);
  } catch {
    // STT hiccup: keep waiting for Enter / Escape or another try.
  }
}

/** A recording made while ask_user was waiting for an answer. */
async function answerQuestion(recording: RecordingResult): Promise<void> {
  try {
    const transcript = await hear(recording, answerSignal());
    log.info(`ask_user answer: "${transcript}"`);
    // An empty transcript keeps the question open; the user can try again.
    if (transcript) resolveQuestion(transcript);
  } catch {
    // STT hiccup: keep waiting for another try (Escape still stops the task).
  }
}

/**
 * A recording made while a task runs in Buddy's browser: "stop" (in any
 * phrasing that contains the word) ends the task; anything else is the user
 * talking to someone who is not Buddy, and is dropped.
 */
async function stopIfSaidStop(recording: RecordingResult): Promise<void> {
  if (drivingMode() !== 'browser') return;
  try {
    const transcript = await hear(recording, answerSignal());
    log.info(`heard during a browser task: "${transcript}"`);
    if (/\bstop\b/i.test(transcript)) stopAgentTask(STOPPED_BY_VOICE);
  } catch {
    // STT hiccup: the other stop controls (Ctrl+Option+Escape, tray) remain.
  }
}

/** A recording made mid-walkthrough: the runner hears it, and "stop" ends it. */
async function answerWalkthrough(recording: RecordingResult): Promise<void> {
  const heard = await hear(recording, answerSignal());
  if (handleFollowAlongSpeech(heard) === 'stop') stopFollowAlong(STOPPED_BY_VOICE);
}
