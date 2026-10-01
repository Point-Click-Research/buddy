// Run or list the user's Shortcuts. The `shortcuts` CLI is the official
// interface — no Automation prompt, and it works for any shortcut they have.
// Listing is free; running is only when they named one.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import { promisify } from 'util';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('shortcuts');

const TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 64 * 1024;

const LIST_SHORTCUTS: Tool = {
  name: 'list_shortcuts',
  description: "List the user's Shortcuts by name, so you can run one they asked for.",
  input_schema: { type: 'object', properties: {} },
};

const RUN_SHORTCUT: Tool = {
  name: 'run_shortcut',
  description:
    'Run one of the user\'s Shortcuts by its exact name. Only when they named it, or a ' +
    'saved skill names it. The optional input is a file the shortcut acts on, never plain text.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The shortcut name, exactly as listed.' },
      input: {
        type: 'string',
        description:
          "Optional absolute path to an input file (find it with search_files if you only know the name). A relative path is resolved against the user's home folder.",
      },
    },
    required: ['name'],
  },
};

/** Register the shortcut tools. A no-op off macOS. */
export function addShortcutsTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('list_shortcuts', { definition: LIST_SHORTCUTS, execute: listShortcuts });
  registry.set('run_shortcut', { definition: RUN_SHORTCUT, execute: runShortcut });
}

async function listShortcuts(): Promise<ToolOutcome> {
  try {
    const { stdout } = await execFileAsync('shortcuts', ['list'], {
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
    });
    const names = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    if (names.length === 0) return { content: 'No shortcuts are installed.' };
    return { content: names.map((name) => `- ${name}`).join('\n') };
  } catch (error) {
    log.warn(`list_shortcuts failed: ${error instanceof Error ? error.message : error}`);
    return { content: shortcutError(error), isError: true };
  }
}

/**
 * The CLI's -i flag is --input-path: a file, not text. Models tend to pass a
 * bare filename read off the screen, which the CLI would resolve against the
 * app's own cwd — anchor it to the home folder instead, and catch a missing
 * file here, where the error can say what to do about it.
 */
function resolveInputPath(text: string): string {
  const expanded = text.startsWith('~/') ? join(homedir(), text.slice(2)) : text;
  return isAbsolute(expanded) ? expanded : join(homedir(), expanded);
}

async function runShortcut(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
  const text = typeof args['input'] === 'string' ? args['input'].trim() : '';
  if (!name) return { content: 'run_shortcut needs the shortcut name.', isError: true };

  const path = text ? resolveInputPath(text) : '';
  if (path && !existsSync(path)) {
    return {
      content: `No input file at ${path}. Pass the file's absolute path — search_files can find it.`,
      isError: true,
    };
  }

  try {
    const argv = path ? ['run', name, '-i', path] : ['run', name];
    const { stdout } = await execFileAsync('shortcuts', argv, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
    });
    const result = stdout.trim();
    return { content: result ? `Ran "${name}".\n${result}` : `Ran "${name}".` };
  } catch (error) {
    log.warn(`run_shortcut "${name}" failed: ${error instanceof Error ? error.message : error}`);
    return { content: shortcutError(error), isError: true };
  }
}

function shortcutError(error: unknown): string {
  // exec errors bury the CLI's explanation in stderr; "Command failed: …"
  // alone tells the model nothing it can correct.
  const stderr = (error as { stderr?: string } | null)?.stderr?.trim();
  const detail = stderr || errorMessage(error);
  if (/not found|could not find/i.test(detail)) {
    return 'No shortcut by that name. Call list_shortcuts and use an exact name.';
  }
  return `That shortcut didn't run: ${detail.split('\n')[0]}`;
}
