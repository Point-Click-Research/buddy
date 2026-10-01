// Launch a macOS app by name (`open -a`). Handy when the model knows the
// app name; the agent can still use the Dock or other UI when appropriate.

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const ALIASES: Record<string, string> = {
  imessage: 'Messages',
  messages: 'Messages',
  texts: 'Messages',
  notes: 'Notes',
  safari: 'Safari',
  chrome: 'Google Chrome',
  'google chrome': 'Google Chrome',
  finder: 'Finder',
  blender: 'Blender',
  cursor: 'Cursor',
  slack: 'Slack',
  spotify: 'Spotify',
  calculator: 'Calculator',
  calendar: 'Calendar',
  mail: 'Mail',
  terminal: 'Terminal',
};

/** Map a spoken/model name onto the real macOS application name. */
export function resolveAppName(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';
  return ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** True when this name matches the user's excluded-apps list. */
export function isExcludedAppName(name: string, excluded: string[]): boolean {
  const haystack = name.toLowerCase();
  return excluded.some((app) => app && haystack.includes(app.toLowerCase()));
}

/** Bring an installed macOS app to the front. Throws if it isn't found. */
export async function launchApp(name: string): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('open_app is only available on macOS.');
  }
  await execFileAsync('open', ['-a', name], { timeout: 8_000 });
}
