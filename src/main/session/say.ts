// One fixed line from the dot: the caption bubble and the voice, no model
// and no chat. The hotkey step's "Got it" and the first-run script use it.

import { IpcChannels } from '../../shared/ipc';
import { createCaptionPacer, type CaptionPacer } from '../speech/captions';
import { cancelSpeech, finishText, pushText, startSpeech } from '../speech/tts';
import { getState, setState } from '../state';
import { broadcast } from '../windows';
import { setActivePacer } from './lifecycle';

/** How long a line stays readable when there is no voice to pace it. */
function readingMs(text: string): number {
  return Math.min(8_000, Math.max(2_500, text.split(/\s+/).length * 350));
}

/**
 * Say the line. Resolves once it has been heard (or read, with speech off),
 * or at once when the signal aborts. The state runs thinking → speaking → idle
 * so the dot and bubble behave as they do for a reply.
 */
export function sayLine(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let settled = false;
    let pacer: CaptionPacer | null = null;
    let reading: ReturnType<typeof setTimeout> | null = null;
    // Drop the listener once the line is done. A later script aborts this
    // signal, and a leftover listener would cancel whatever is speaking then.
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (reading) clearTimeout(reading);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    // Ending the script (a new line, Escape, a real turn) has to leave the
    // dot idle. The voice request dying on its own does not.
    const onAbort = (): void => {
      cancelSpeech();
      pacer?.stop();
      if (getState() === 'thinking' || getState() === 'speaking') setState('idle');
      finish();
    };
    signal.addEventListener('abort', onAbort);

    setState('thinking');
    if (settled) return;
    // Each line is its own bubble, not more words on the last one.
    broadcast(IpcChannels.sessionMessageStart, true);
    pacer = createCaptionPacer((delta) => broadcast(IpcChannels.sessionResponseDelta, delta));
    setActivePacer(pacer);
    const speaking = startSpeech(
      signal,
      () => {
        if (signal.aborted) pacer?.stop();
        else pacer?.flush();
        if (getState() === 'speaking' || getState() === 'thinking') setState('idle');
        finish();
      },
      (caption) => pacer?.push(`${caption} `),
    );
    if (settled) return;
    if (speaking) pushText(text);
    else broadcast(IpcChannels.sessionResponseDelta, text);
    broadcast(IpcChannels.sessionResponseDone);
    if (speaking && finishText()) {
      if (!settled) setState('speaking');
      return;
    }
    if (settled) return;
    setState('idle');
    reading = setTimeout(finish, readingMs(text));
  });
}
