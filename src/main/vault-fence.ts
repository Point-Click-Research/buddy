// Buddy's own data folder holds the encrypted card and API keys, and the
// macOS Keychain holds the key that decrypts them. No tool the model calls
// may read either, whoever approves: the terminal refuses the command before
// a card is shown (command-danger.ts), the coding tools refuse the path, and
// the frontmost-document reader skips it. A backstop against a steered model,
// not a sandbox — the Keychain's own prompt and the user's judgement stay the
// outer gates.
//
// Electron-free so tests can import it; callers pass app.getPath('userData').

/** The ways a shell command might spell a directory under the home folder. */
export function spellings(dir: string, home: string): string[] {
  if (!dir.startsWith(home)) return [dir];
  const rest = dir.slice(home.length);
  return [dir, `~${rest}`, `$HOME${rest}`];
}

/**
 * Does the text name one of the fenced directories, or anything under it?
 * Quotes and backslash escapes are stripped first, so `Application\ Support`
 * and "Application Support" both match, and the comparison ignores case the
 * way the Mac's filesystem does. A sibling that merely shares the prefix
 * (`.../BuddyOther`) does not count.
 */
export function namesFenced(text: string, fenced: readonly string[]): boolean {
  const plain = text
    .replace(/\\(.)/g, '$1')
    .replace(/["']/g, '')
    .replace(/\$\{HOME\}/g, '$HOME');
  return fenced.some((dir) => new RegExp(`${escapeRegExp(dir)}(?=$|[\\s/;&|)])`, 'i').test(plain));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
