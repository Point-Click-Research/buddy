// Runs JavaScript-for-Automation snippets via osascript, for the one-call
// Apple app tools (Contacts, Mail, Notes, and friends). User values are
// embedded with JSON.stringify by the callers, never concatenated raw.

import { execFile } from 'child_process';
import { promisify } from 'util';
import { errorMessage } from '../../shared/errors';

const execFileAsync = promisify(execFile);

/** Generous for any listing these tools return; a bound on a runaway script. */
const MAX_OUTPUT = 4 * 1024 * 1024;

export async function runJxa(source: string, timeoutMs: number): Promise<string> {
  return runOsa(['-l', 'JavaScript', '-e', source], timeoutMs);
}

/** AppleScript via osascript. Messages' JXA dictionary is incomplete; this is the reliable send path. */
export async function runAppleScript(source: string, timeoutMs: number): Promise<string> {
  return runOsa(['-e', source], timeoutMs);
}

async function runOsa(args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', args, {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT,
    });
    return stdout.trim();
  } catch (error) {
    // execFile's message embeds the whole script; rethrow just the cause.
    // A timeout kill leaves empty stderr, which read as a mystery until now.
    const detail = error as { killed?: boolean; signal?: string; stderr?: string; message?: string };
    if (detail.killed || detail.signal === 'SIGTERM') {
      throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new Error(detail.stderr?.trim() || detail.message?.split('\n')[0] || 'osascript failed');
  }
}

/**
 * Apple-event scripting is gated per target app: the first call prompts the
 * user, and a denial comes back as error -1743. The model has to be told the
 * user must flip it, not retry.
 */
export function jxaErrorMessage(error: unknown, appName: string): string {
  const detail = errorMessage(error);
  if (detail.includes('-1743') || /not authori[sz]ed/i.test(detail)) {
    return (
      `macOS is blocking Buddy from controlling ${appName}. The user must allow it under ` +
      'System Settings → Privacy & Security → Automation → Buddy, then ask again.'
    );
  }
  if (/timed? ?out|ETIMEDOUT/i.test(detail)) {
    return `${appName} took too long to answer. It may be syncing — try again in a moment.`;
  }
  return `That didn't work: ${detail}`;
}
