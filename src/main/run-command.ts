// Run one terminal command — the ones users dictate or saved skills spell
// out. Every command shows a confirmation card before it runs, then streams
// its output live to the overlay's terminal panel, so a long run is never a
// silent wait. It runs in the user's login shell so their installed CLIs
// (Homebrew, npm) resolve.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { spawn } from 'child_process';
import { app } from 'electron';
import { homedir } from 'os';
import { type ToolOutcome, type ToolRegistry, toolArgs } from './ai/tools';
import { classifyCommand } from './command-danger';
import { spellings } from './vault-fence';
import { createLogger } from './log';
import { requestConfirmation } from './mcp/confirm';
import { truncateForModel } from './reader/truncate';
import { getSettings } from './settings';
import { type CommandOutputEvent } from '../shared/types';
import { broadcast } from './windows';
import { IpcChannels } from '../shared/ipc';
import { errorMessage } from '../shared/errors';

const log = createLogger('run-command');

/** Long enough for real CLI work (crawls, builds); Escape still cancels. */
const TIMEOUT_MS = 5 * 60_000;
/** What the model is shown is capped harder, to mcpResultLimit. */
const MAX_OUTPUT = 4 * 1024 * 1024;
/** A very long command line is clipped on the confirmation card. */
const CONFIRM_DETAIL_LIMIT = 700;

const RUN_COMMAND: Tool = {
  name: 'run_command',
  description:
    "Run one terminal command in the user's login shell. Only when they asked for it, or a " +
    'saved skill spells it out.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The exact command line to run.' },
      why: {
        type: 'string',
        description:
          'One plain-language sentence shown to the user under the command: what it does and why.',
      },
    },
    required: ['command', 'why'],
  },
};

/** Register the run_command tool, its description matching the approval mode in force. */
export function addRunCommandTool(registry: ToolRegistry): void {
  const approval =
    getSettings().runCommandApproval === 'risky'
      ? 'Only risky commands (deletions, kills, pipes to a shell) wait for user approval on a card; ordinary ones run at once.'
      : 'The user approves each command on a card before it runs.';
  registry.set('run_command', {
    definition: { ...RUN_COMMAND, description: `${RUN_COMMAND.description} ${approval}` },
    execute: runCommand,
  });
}

/** One frame of the overlay's live terminal panel. */
function feed(event: CommandOutputEvent): void {
  broadcast(IpcChannels.commandOutput, event);
}

async function runCommand(input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const command = typeof args['command'] === 'string' ? args['command'].trim() : '';
  if (!command) return { content: 'run_command needs the command to run.', isError: true };

  // Catastrophic commands never reach a card: the user reflex-approves cards
  // they don't fully read, and no cleanup needs to wipe a disk or a home
  // folder, and nothing reads the Keychain or Buddy's own data folder. The
  // model is told why, so it can say so and offer another way.
  const danger = classifyCommand(command, spellings(app.getPath('userData'), homedir()));
  if (danger.level === 'blocked') {
    log.warn(`run_command refused (${danger.reason}): ${command}`);
    return {
      content:
        `Refused without asking the user: ${danger.reason}. Tell them what you wanted to run and ` +
        'why; if they truly want it, they can run it themselves in Terminal.',
      isError: true,
    };
  }

  // The card explains the command in the model's words; a missing why is not
  // worth refusing over — the command itself is still there to read. Risky
  // commands (deletions, pipe-to-shell, kills) wear the red card, and the
  // strict flag makes an unclear spoken answer count as no. In risky-only
  // approval (Settings → Tools) ordinary commands skip the card entirely;
  // risky ones always ask.
  const risky = danger.level === 'risky';
  const why = typeof args['why'] === 'string' ? args['why'].trim() : '';
  if (risky || getSettings().runCommandApproval !== 'risky') {
    const approved = await requestConfirmation(
      {
        title: risky ? 'Run this risky command?' : 'Run this command?',
        detail: command.length > CONFIRM_DETAIL_LIMIT ? `${command.slice(0, CONFIRM_DETAIL_LIMIT)}…` : command,
        ...(why ? { note: why } : {}),
        ...(risky ? { danger: true } : {}),
      },
      signal,
      risky,
    );
    if (!approved) return { content: 'The user declined this command. Do not run it another way.' };
  }

  feed({ kind: 'start', command });
  try {
    const run = await execute(command, signal);
    const output = run.output.trim();
    if (run.timedOut) {
      feed({ kind: 'exit', note: `stopped after ${TIMEOUT_MS / 60_000} minutes` });
      return {
        content:
          `The command was still running after ${TIMEOUT_MS / 60_000} minutes and was stopped. ` +
          'If it has a background or job mode, start it that way and poll for the result.',
        isError: true,
      };
    }
    feed({ kind: 'exit', note: run.code === 0 ? 'done' : `exit ${run.code ?? '?'}` });
    if (run.code !== 0) return failure(command, output || `exit code ${run.code}`, run.code);
    return { content: output ? clip(output) : 'The command finished with no output.' };
  } catch (error) {
    feed({ kind: 'exit', note: 'stopped' });
    if (signal.aborted) return { content: 'Cancelled by the user.', isError: true };
    const detail = errorMessage(error);
    log.warn(`run_command failed to start: ${detail}`);
    return { content: `The command could not run: ${detail}`, isError: true };
  }
}

interface RunResult {
  /** stdout and stderr, interleaved as they arrived. */
  output: string;
  code: number | null;
  timedOut: boolean;
}

/** Spawn in the user's login shell, streaming every chunk to the overlay. */
function execute(command: string, signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // A login shell (-l) sources the user's profile, so PATH additions from
    // Homebrew, nvm and the like resolve the same way they do in Terminal.
    const child = spawn(process.env['SHELL'] || '/bin/zsh', ['-lc', command], {
      cwd: homedir(),
      timeout: TIMEOUT_MS,
      signal,
    });
    let output = '';
    const take = (data: Buffer): void => {
      const text = data.toString();
      if (output.length < MAX_OUTPUT) output += text;
      feed({ kind: 'chunk', text });
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    // A null code with no abort means the timeout's kill signal ended it.
    child.on('close', (code) => resolve({ output, code, timedOut: code === null && !signal.aborted }));
  });
}

function failure(command: string, detail: string, code: number | null): ToolOutcome {
  log.warn(`run_command failed: ${detail.split('\n')[0]}`);
  // A missing CLI is a choice for the user, not a dead end for the model to
  // improvise around: install it, or connect an MCP server that covers it.
  // zsh names the missing word after the phrase; 127 catches other shells.
  const missing =
    /command not found:\s*(\S+)/i.exec(detail)?.[1] ?? (code === 127 ? command.split(/\s+/)[0] : null);
  if (missing) {
    return {
      content:
        `"${missing}" isn't installed on this Mac. Tell the user, and ask whether they want it ` +
        'installed (name the exact install command) or would rather connect an MCP server that ' +
        'does the same job. Do neither until they choose.',
      isError: true,
    };
  }
  return { content: clip(`The command failed:\n${detail}`), isError: true };
}

function clip(text: string): string {
  return truncateForModel(text, getSettings().mcpResultLimit);
}
