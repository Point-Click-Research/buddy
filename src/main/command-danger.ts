// Is a shell command safe to even offer the user? A small static classifier:
// catastrophic commands are refused outright, destructive ones get the red
// card and a stricter confirmation. This is a backstop against reflexive
// approval, not a sandbox — the card and the user's judgement stay the gate.

import { namesFenced } from './vault-fence';

export type CommandDanger =
  | { level: 'blocked'; reason: string }
  | { level: 'risky' }
  | { level: 'normal' };

/** Never run, whoever approves: the model is told why and to tell the user. */
const BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
  {
    // sudo cannot work anyway: the shell has no TTY for the password prompt.
    pattern: /(^|[;&|(]\s*)sudo\b/,
    reason:
      'sudo needs an interactive password prompt this shell does not have — the user must run it themselves in Terminal',
  },
  {
    // rm aimed at the filesystem root or the whole home folder. Deeper paths
    // (rm -rf ~/Old) are allowed but classified risky below.
    pattern: /(^|[;&|(]\s*)rm\s+(-\w+\s+)*['"]?(\/|~|\$HOME)['"]?\s*($|[;&|])/,
    reason: 'it deletes the filesystem root or the whole home folder',
  },
  {
    pattern: /\bmkfs|\bdiskutil\s+(erase\w*|reformat)|\bdd\b[^|;&]*\bof=\/dev\//i,
    reason: 'it rewrites a disk',
  },
  {
    pattern: /(^|[;&|]\s*)(shutdown|reboot|halt)\b/,
    reason: 'it shuts the machine down',
  },
  {
    pattern: /:\s*\(\)\s*\{[^}]*\|[^}]*&[^}]*\}/,
    reason: 'it is a fork bomb',
  },
  {
    // The Keychain holds the key that decrypts the saved card and API keys.
    // No approval makes reading it a good idea; a steered model would ask.
    pattern: /(^|[;&|(`\s])(\/usr\/bin\/)?security\s+(find-(generic|internet)-password|dump-keychain|export)\b/,
    reason: 'it reads the Keychain, which holds the keys to the saved card and API keys',
  },
];

/**
 * Destructive but sometimes legitimate: deleting, piping a download into a
 * shell, recursive permission changes, killing processes, rewriting git
 * history. These run only past the red card, and an unclear spoken answer
 * counts as no.
 */
const RISKY =
  /(^|[;&|(]\s*)(rm|rmdir|srm)\s|\|\s*(ba|z|da)?sh\b|\bchmod\s+-\w*R\b|\bchown\s+-\w*R\b|(^|[;&|(]\s*)(kill|killall|pkill)\b|\bgit\s+(reset\s+--hard|clean\s+-\w*f|push\b[^;&|]*--force)/;

/**
 * `fenced` is Buddy's own data folder in every spelling a command might use
 * (see vault-fence.ts): a command that names it is blocked like a Keychain
 * read, since the encrypted card and keys live there.
 */
export function classifyCommand(command: string, fenced: readonly string[] = []): CommandDanger {
  for (const { pattern, reason } of BLOCKED) {
    if (pattern.test(command)) return { level: 'blocked', reason };
  }
  if (namesFenced(command, fenced)) {
    return { level: 'blocked', reason: "it reads Buddy's own data folder, where the encrypted card and keys are kept" };
  }
  return RISKY.test(command) ? { level: 'risky' } : { level: 'normal' };
}
