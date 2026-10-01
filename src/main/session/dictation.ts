// Dictation: the talk chord's words land in a field instead of being asked.
// The field is the story box during onboarding, or one in Settings that asked
// for it (a job's instructions). Same microphone and ear; the words land when
// the chord comes up, and the user reads them, edits them, and sends them themselves.

import type { WebContents } from 'electron';
import type { DictationTranscript, RecordingResult } from '../../shared/types';
import { noteDictationField } from '../dictation-target';
import { createLogger } from '../log';
import { getState, setState } from '../state';
import { answerSignal, isBusyWithTask } from './lifecycle';
import { hear, MIN_HOLD_MS, startListening, stopListening } from './listening';
import { errorMessage } from '../../shared/errors';

const log = createLogger('session');

type Sink = (event: DictationTranscript) => void;

/** Where the words in flight are going; null when nothing is being dictated. */
let sink: Sink | null = null;
let startedAt = 0;
/** A field that takes dictation has focus, so the held chord dictates into it. */
let fieldFocused = false;

export function setDictationField(focused: boolean, contents?: WebContents): void {
  if (contents && !noteDictationField(focused, contents)) return;
  fieldFocused = focused;
}

export function fieldTakesDictation(): boolean {
  return fieldFocused;
}

export function isDictating(): boolean {
  return sink !== null;
}

export function startDictation(to: Sink): void {
  if (sink) return;
  // A running turn (or a pending card) owns the microphone and the state.
  if (getState() !== 'idle' || isBusyWithTask()) return;
  sink = to;
  startedAt = Date.now();
  setState('listening');
  startListening();
}

/** The hold ended: transcribe. A short bump is an accident, not speech. */
export function endDictation(heldMs = Date.now() - startedAt): void {
  if (!sink) return;
  if (heldMs < MIN_HOLD_MS) {
    cancelDictation();
    return;
  }
  stopListening(false);
  setState('transcribing');
}

/** Stop and discard: the chord was cancelled, or the field is going away. */
export function cancelDictation(): void {
  if (!sink) return;
  const to = sink;
  sink = null;
  stopListening(true);
  // Take back the partials the field showed for a recording that never finished.
  to({ kind: 'final', text: '' });
  if (getState() === 'listening' || getState() === 'transcribing') setState('idle');
}

/**
 * The recorder delivered a recording: if it was dictation, transcribe it into
 * the field. True when it was, and the recording is spent.
 */
export async function takeDictation(recording: RecordingResult): Promise<boolean> {
  if (!sink) return false;
  const to = sink;
  sink = null;
  try {
    to({ kind: 'final', text: await hear(recording, answerSignal()) });
  } catch (error) {
    to({ kind: 'final', text: '' });
    log.warn(`dictation failed: ${errorMessage(error)}`);
  } finally {
    if (getState() === 'transcribing') setState('idle');
  }
  return true;
}
