// Always-on mode: while on, the recorder runs voice activity detection and
// Buddy answers whenever the user finishes speaking — no hotkey needed. It
// switches itself off after a stretch of inactivity.

import { type RecordingResult } from '../../shared/types';
import { createLogger } from '../log';
import { getSettings } from '../settings';
import { getAlwaysOn, getState, onAlwaysOnChange, onStateChange, setState, toggleAlwaysOn } from '../state';
import { sendToRecorder } from '../windows';
import { routeAnswerRecording } from './answers';
import { runVoiceAsk } from './asks';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('session');

let idleTimer: NodeJS.Timeout | null = null;

/** Wire always-on to the recorder's VAD and the inactivity timeout. */
export function registerAlwaysOn(): void {
  onAlwaysOnChange((on) => {
    sendToRecorder(on ? IpcChannels.vadStart : IpcChannels.vadStop);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (on) resetIdleTimer();
  });

  // Any return to idle counts as activity (a question just finished).
  onStateChange((state) => {
    if (state === 'idle' && getAlwaysOn()) resetIdleTimer();
  });
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(
    () => {
      if (getAlwaysOn()) {
        log.info('always-on idle timeout reached; turning off');
        toggleAlwaysOn();
      }
    },
    getSettings().alwaysOnIdleTimeoutMinutes * 60_000,
  );
}

/** VAD heard speech begin: show the listening state. */
export function onVadSpeechStart(): void {
  if (getAlwaysOn() && getState() === 'idle') setState('listening');
}

/** What VAD heard was too short to be speech. */
export function onVadMisfire(): void {
  if (getAlwaysOn() && getState() === 'listening') setState('idle');
}

/** VAD delivered a finished utterance: run the same pipeline as hold-to-talk. */
export async function onVadAudio(recording: RecordingResult): Promise<void> {
  if (!getAlwaysOn()) return;
  // No always-on questions while a card, a question, a task or a walkthrough
  // has Buddy — but the recording still answers whichever of those it is.
  if (await routeAnswerRecording(recording)) return;
  // Only start when free: utterances arriving while Buddy is busy are dropped
  // (v1 has no barge-in; the recorder pauses VAD while busy anyway).
  if (getState() === 'listening') {
    setState('transcribing');
    await runVoiceAsk(recording);
  }
}
