// The session coordinator: the chord (or the home window's talk button)
// opens the microphone; its release sends the recording down one of the
// pipelines in this folder; Escape cancels whatever is in flight.
//
//   lifecycle.ts            one session at a time: run, cancel, fail
//   listening.ts            the microphone and the two paths to a transcript
//   answers.ts              recordings that answer a card, question, or task
//   asks.ts                 the three ways a guide turn begins
//   guide-turn.ts           one guide-mode model turn, spoken and captioned
//   agent-proposal.ts       the "do this" chord: a spoken task proposal
//   dictation.ts            the chord's words into a field instead of an ask
//   always-on.ts            hands-free mode driven by voice activity detection

import { type AppState, type RecordingResult } from '../../shared/types';
import { isAgentActive } from '../agent/agent';
import { isQuestionPending } from '../agent/control-tools';
import { drivingMode } from '../agent/safety';
import { beginCapture as beginMarkCapture, endCapture as endMarkCapture } from '../marks/marks';
import { isConfirmationPending } from '../mcp/confirm';
import { pinSelection } from '../selection';
import { getSettings } from '../settings';
import { getState, setState } from '../state';
import { broadcast } from '../windows';
import { runAgentProposal } from './agent-proposal';
import { routeAnswerRecording } from './answers';
import { runVoiceAsk } from './asks';
import { cancel, endScript, showSessionError } from './lifecycle';
import { MIN_HOLD_MS, startListening, stopListening } from './listening';
import { takeDictation } from './dictation';
import { IpcChannels } from '../../shared/ipc';

export { sendChatMessage, sendQuickAskMessage } from './asks';
export { learnFromTranscriptEdit } from './guide-turn';
export { onVadAudio, onVadMisfire, onVadSpeechStart, registerAlwaysOn } from './always-on';
export {
  cancelDictation,
  endDictation,
  fieldTakesDictation,
  isDictating,
  setDictationField,
  startDictation,
} from './dictation';

// Which pipeline the current recording feeds: a guide question (the normal
// chord) or a "do this" agent proposal (the agent chord).
type AskKind = 'guide' | 'agent';
let askKind: AskKind = 'guide';

/**
 * States the chord can interrupt straight into a new recording. All of them
 * have the microphone closed, so the press can cancel and start listening in
 * one go. `transcribing` is deliberately absent: the recorder may not have
 * finished shipping the last clip yet, and restarting it that early loses the
 * new recording instead of starting it.
 */
const INTERRUPTIBLE = new Set<AppState>(['thinking', 'speaking', 'error']);

// --- Answering a card, a question, or a running task -------------------------
// While a confirmation card or an ask_user question is up, the chord records
// a spoken answer instead of starting (or cancelling into) a new question.

let answerRecording = false;
/** The turn's own state, restored when the answer's chord lifts. */
let answerPriorState: AppState = 'idle';

/**
 * Open the mic for a spoken answer — a card, ask_user, a Background stop —
 * and show it. The listening state is what plays the chime and brings the
 * dot out; without it the user could not tell they were being heard. Cards
 * sit on idle (agent runs) or thinking (mid-turn plans), the two states the
 * machine lets listening interrupt.
 */
function beginAnswerRecording(): void {
  answerRecording = true;
  answerPriorState = getState();
  if (answerPriorState === 'idle' || answerPriorState === 'thinking') setState('listening');
  startListening();
}

function endAnswerRecording(discard: boolean): void {
  answerRecording = false;
  stopListening(discard);
  if (getState() === 'listening') setState(answerPriorState);
}

// --- The chord -----------------------------------------------------------------

export function onChordDown(kind: AskKind): void {
  const state = getState();
  if (isConfirmationPending() || isQuestionPending()) {
    beginAnswerRecording();
  } else if (isAgentActive()) {
    // A task in Buddy's browser can be stopped by saying "stop", so the chord
    // records; in Watch mode plain Escape already does the job.
    if (drivingMode() === 'browser') {
      beginAnswerRecording();
      return;
    }
    broadcast(
      IpcChannels.sessionError,
      'Still finishing the last agent task. Wait until the driving HUD disappears, or press Escape to stop it.',
    );
    return;
  } else if (kind === 'agent' && !getSettings().agentModeEnabled) {
    broadcast(IpcChannels.sessionError, 'Agent mode is off. Enable it in Settings first.');
  } else if (state === 'idle' || INTERRUPTIBLE.has(state)) {
    // Mid-answer, the chord is an interruption and the next question in one
    // press: drop what's in flight and open the microphone in the same
    // breath. Pressing it to shut Buddy up and then again to talk loses the
    // thought the user pressed it with — Escape is the press that only stops.
    if (state !== 'idle') cancel();
    else endScript();
    askKind = kind;
    // Text they highlighted just before asking is part of the question.
    if (kind === 'guide') pinSelection();
    setState('listening');
    startListening();
    // While the chord is held, the overlays take the mouse so the user can
    // draw marks over what they're talking about (Settings → Summon).
    if (kind === 'guide') beginMarkCapture();
  }
}

export function onChordUp(heldMs: number): void {
  endMarkCapture(); // the mouse goes back to the user's apps the instant the chord lifts
  if (answerRecording) {
    endAnswerRecording(heldMs < MIN_HOLD_MS);
    return;
  }
  if (getState() !== 'listening') return;
  if (heldMs < MIN_HOLD_MS) {
    cancel();
    return;
  }
  stopListening(false);
  setState('transcribing');
}

export function onChordCancel(): void {
  endMarkCapture();
  if (answerRecording) {
    endAnswerRecording(true);
    return;
  }
  // Another key joined the chord: the user was doing a normal shortcut.
  if (getState() === 'listening') cancel();
}

/**
 * The home window's hold-to-talk button, which holds the same guide session
 * the chord does. The press is timed here so a tap still cancels, and the
 * button only ever releases a session it started — pressing it while the
 * hotkey is held must not cut that recording short.
 */
let talkDownAt = 0;

export function onTalkDown(): void {
  if (getState() === 'listening') return;
  talkDownAt = Date.now();
  onChordDown('guide');
}

export function onTalkUp(): void {
  if (!talkDownAt) return;
  const heldMs = Date.now() - talkDownAt;
  talkDownAt = 0;
  onChordUp(heldMs);
}

export function onEscape(): void {
  if (getState() !== 'idle') {
    cancel();
    return;
  }
  // Nothing is in flight, but the finished answer's bubble is still sitting
  // by the cursor for its reading time. Escape means "enough" either way,
  // and it ends a scripted tour between its lines.
  endScript();
  broadcast(IpcChannels.sessionCancelled);
}

// --- The recording comes back --------------------------------------------------

/** The recorder window delivered a hold-to-talk recording: run the full flow. */
export async function onAudioCaptured(recording: RecordingResult): Promise<void> {
  if (await takeDictation(recording)) return;
  if (await routeAnswerRecording(recording)) return;
  if (getState() !== 'transcribing') return; // cancelled in the meantime
  if (askKind === 'agent') {
    askKind = 'guide';
    await runAgentProposal(recording);
  } else {
    await runVoiceAsk(recording);
  }
}

export function onRecorderError(message: string): void {
  showSessionError(`Microphone error: ${message}`);
}
