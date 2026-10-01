// Hearing the user: the microphone, and the path from a recording to a
// transcript. The ear is the local Whisper model: the finished recording is
// transcribed on this Mac the moment the chord comes up, with no upload and
// nothing to configure.

import { type RecordingResult } from '../../shared/types';
import type { WordTiming } from '../marks/transcript';
import { getSettings } from '../settings';
import { applyCorrections } from '../speech/dictionary';
import { transcribe } from '../speech/stt';
import { sendToRecorder } from '../windows';
import { IpcChannels } from '../../shared/ipc';

/** Chord releases shorter than this are accidental bumps, not questions. */
export const MIN_HOLD_MS = 250;

/** A transcript, with word timings when marks need to be placed in it. */
export interface Heard {
  text: string;
  words: WordTiming[] | null;
}

/** Start the microphone. */
export function startListening(): void {
  sendToRecorder(IpcChannels.recorderStart);
}

/** Stop the microphone. `discard` throws away the recording. */
export function stopListening(discard: boolean): void {
  sendToRecorder(IpcChannels.recorderStop, discard);
}

/** What the user just said, mishearings fixed. */
export async function hear(recording: RecordingResult, signal: AbortSignal): Promise<string> {
  return applyCorrections(await transcribe(recording, signal), getSettings().vocabulary);
}

/**
 * The same, for a turn with marks drawn in it. The local ear gives no word
 * timestamps, so `words` is null and marks land proportionally by time.
 */
export async function hearForMarks(recording: RecordingResult, signal: AbortSignal): Promise<Heard> {
  return { text: await hear(recording, signal), words: null };
}
