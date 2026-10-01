// Is a shell command safe to even offer the user? A small static classifier:
// catastrophic commands are refused outright, destructive ones get the red
// card and a stricter confirmation. This is a backstop against reflexive
// approval, not a sandbox — the card and the user's judgement stay the gate.

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
];

/**
 * Destructive but sometimes legitimate: deleting, piping a download into a
 * shell, recursive permission changes, killing processes, rewriting git
 * history. These run only past the red card, and an unclear spoken answer
 * counts as no.
 */
const RISKY =
  /(^|[;&|(]\s*)(rm|rmdir|srm)\s|\|\s*(ba|z|da)?sh\b|\bchmod\s+-\w*R\b|\bchown\s+-\w*R\b|(^|[;&|(]\s*)(kill|killall|pkill)\b|\bgit\s+(reset\s+--hard|clean\s+-\w*f|push\b[^;&|]*--force)/;

export function classifyCommand(command: string): CommandDanger {
  for (const { pattern, reason } of BLOCKED) {
    if (pattern.test(command)) return { level: 'blocked', reason };
  }
  return RISKY.test(command) ? { level: 'risky' } : { level: 'normal' };
}
