// Speech-to-text: the local Whisper ear (whisper-local.ts), and nothing
// else. A hold-to-talk clip is a few seconds long, and on this Mac it comes
// back in a fraction of that with no upload, no key, and nothing to pick in
// Settings. The first ask downloads the model when onboarding has not.

import type { RecordingResult } from '../../shared/types';
import { downloadLocalWhisper, isLocalWhisperReady, transcribeLocal } from './whisper-local';

/** The recording's words. Throws with a message that names the fix. */
export async function transcribe(recording: RecordingResult, signal: AbortSignal): Promise<string> {
  if (!isLocalWhisperReady()) {
    const downloaded = await downloadLocalWhisper();
    if (!downloaded.ok) throw new Error(downloaded.message);
  }
  if (signal.aborted) return '';
  return transcribeLocal(recording.pcm16);
}
