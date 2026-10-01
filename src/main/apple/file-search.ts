// The search_files tool: Spotlight (mdfind), natively. "Where's that PDF from
// last week" should be one call, not an agent task driving Finder. Read-only
// and local; the interpreted query syntax means natural asks like
// "invoice kind:pdf" work as they would in the Spotlight search field.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { execFile } from 'child_process';
import { shell } from 'electron';
import { stat } from 'fs/promises';
import { homedir } from 'os';
import { promisify } from 'util';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('file-search');

const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 20;

const SEARCH_FILES: Tool = {
  name: 'search_files',
  description:
    "Search the user's files like Spotlight does: by name, content, or kind. The query takes " +
    'Spotlight syntax — "invoice kind:pdf", "budget kind:spreadsheet", "date:this week" — or ' +
    'plain words. Searches the home folder. Returns paths with modified dates, newest first. ' +
    'When the user wants the file itself, follow up with reveal_file on the best match.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for, Spotlight-style.' },
    },
    required: ['query'],
  },
};

const REVEAL_FILE: Tool = {
  name: 'reveal_file',
  description:
    'Open a Finder window with this file selected. After search_files, revealing the best match ' +
    'is the right default when the user is hunting for the file rather than asking about it. ' +
    'One file per call — pick the likeliest, never all of them.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The absolute path, from a search_files result.' },
    },
    required: ['path'],
  },
};

/** Register the file tools. No-ops off macOS (mdfind is Spotlight's CLI). */
export function addFileSearchTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('search_files', { definition: SEARCH_FILES, execute: searchFiles });
  registry.set('reveal_file', { definition: REVEAL_FILE, execute: revealFile });
}

async function revealFile(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const path = typeof args['path'] === 'string' ? args['path'].trim() : '';
  if (!path) return { content: 'reveal_file needs the absolute path.', isError: true };
  const exists = await stat(path).then(() => true).catch(() => false);
  if (!exists) {
    return { content: `No file at ${path} — only reveal paths search_files returned.`, isError: true };
  }
  shell.showItemInFolder(path);
  return { content: 'Revealed in a Finder window.' };
}

async function searchFiles(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return { content: 'search_files needs a query.', isError: true };

  try {
    const { stdout } = await execFileAsync(
      'mdfind',
      ['-onlyin', homedir(), '-interpret', query],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    const paths = stdout.split('\n').filter(Boolean);
    if (paths.length === 0) {
      return { content: `Nothing in the home folder matches "${query}".` };
    }
    // Newest first: the file someone is hunting for is usually recent.
    const dated = await Promise.all(
      paths.slice(0, 200).map(async (path) => {
        const modified = await stat(path).then((s) => s.mtimeMs).catch(() => 0);
        return { path, modified };
      }),
    );
    dated.sort((a, b) => b.modified - a.modified);
    const lines = dated.slice(0, MAX_RESULTS).map(({ path, modified }) => {
      const when = modified ? new Date(modified).toISOString().slice(0, 10) : 'unknown';
      return `- ${path} (modified ${when})`;
    });
    const more = paths.length > MAX_RESULTS ? `\n…and ${paths.length - MAX_RESULTS} more — narrow the query to see them.` : '';
    return { content: lines.join('\n') + more };
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`search_files failed: ${detail}`);
    return { content: `The search didn't work: ${detail}`, isError: true };
  }
}
