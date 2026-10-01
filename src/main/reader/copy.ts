// Reading a selection by copying it.
//
// Browsers publish no accessibility tree to AppleScript, so AXSelectedText
// comes back empty for every web page. Pressing Copy is the one thing that
// works everywhere — but it touches the user's clipboard, so it happens only
// when they click Ask Buddy, never on the chance that a drag selected text.
// Whatever was on the clipboard is put back afterwards.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { clipboard } from 'electron';
import { createLogger } from '../log';
import { activateApp, type FrontmostApp } from './frontmost';
import { errorMessage } from '../../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('copy');

/** Time for the owner app to come frontmost (and chord modifiers to lift). */
const ACTIVATE_SETTLE_MS = 250;

/** Written before copying, so we can tell "nothing was selected" from "no change". */
const SENTINEL = '\u0000buddy-checking-selection\u0000';

/** The copy lands asynchronously; poll briefly rather than guess one delay. */
const POLL_MS = 60;
const POLL_TRIES = 12;

/** A selection big enough to be a whole page is not a question about a phrase. */
export const COPY_MAX_CHARS = 20_000;

export async function copySelectedText(owner: FrontmostApp | null): Promise<string> {
  if (process.platform !== 'darwin') return '';
  // Copy goes to the frontmost app — and clicking the Ask Buddy button makes
  // Buddy itself frontmost. Put the app that owns the selection back in front
  // first, or the keystroke lands on Buddy and copies nothing.
  if (owner) {
    try {
      await activateApp(owner);
    } catch {
      // The sentinel below still catches a copy that went nowhere.
    }
    await wait(ACTIVATE_SETTLE_MS);
  }
  // Text only: what goes back is what the user can see they had. Restoring
  // an image or rich formatting would need clipboard APIs this project's
  // Electron typings don't expose.
  const saved = await clipboard.readText();
  clipboard.writeText(SENTINEL);
  try {
    await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down'],
      { timeout: 5_000 },
    );
    const grabbed = await waitForClipboard();
    return grabbed.slice(0, COPY_MAX_CHARS);
  } catch (error) {
    log.warn(`copy failed: ${errorMessage(error)}`);
    return '';
  } finally {
    clipboard.writeText(saved);
  }
}

async function waitForClipboard(): Promise<string> {
  for (let attempt = 0; attempt < POLL_TRIES; attempt++) {
    await wait(POLL_MS);
    const text = await clipboard.readText();
    // Still the sentinel means the app had nothing to copy — keep waiting a
    // little in case it is just slow, and give up empty if it never changes.
    if (text !== SENTINEL) return text;
  }
  return '';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
