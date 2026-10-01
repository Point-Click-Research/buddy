// The coding tools: list, read, search, and edit files inside the one
// workspace folder chosen in Settings → Tools. This is how Buddy works on a
// codebase the way a coding agent does — search for the relevant lines, read
// just those files, and change an exact unique span — instead of driving an
// editor or improvising with sed through run_command. No folder chosen means
// none of these tools exist.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { Dirent } from 'fs';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, relative, sep } from 'path';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { requestConfirmation } from '../mcp/confirm';
import { truncateForModel } from '../reader/truncate';
import { getSettings } from '../settings';
import { detectWorkspaceRoot } from './detect';
import { showDiffInEditor } from './diff-view';
import { applyEdit, resolveInWorkspace, secretName, SKIP_DIRS, writeDenied } from './workspace';
import { errorMessage } from '../../shared/errors';

const log = createLogger('code-tools');

/** Larger files are almost never source; refusing them protects the context. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Search stops walking after this many files — enough for any real repo. */
const MAX_SEARCH_FILES = 20_000;
const MAX_SEARCH_MATCHES = 100;
const MAX_LIST_ENTRIES = 500;
/** How much of a change the confirmation card shows. */
const CONFIRM_PREVIEW_LIMIT = 600;

const PATH_NOTE = 'Paths are relative to the coding workspace folder.';

const LIST_FILES: Tool = {
  name: 'list_files',
  description:
    `List files in the coding workspace, recursively, skipping generated folders (node_modules, ` +
    `.git, dist, …). Directories end with /. ${PATH_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Subfolder to list. Omit for the whole workspace.' },
    },
  },
};

const READ_FILE: Tool = {
  name: 'read_file',
  description:
    `Read one file in the coding workspace. For a long file, read the slice you need with offset ` +
    `and limit instead of the whole thing. ${PATH_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'integer', description: '1-based line to start from.' },
      limit: { type: 'integer', description: 'How many lines to read.' },
    },
    required: ['path'],
  },
};

const SEARCH_CODE: Tool = {
  name: 'search_code',
  description:
    `Search file contents in the coding workspace with a regular expression; returns path:line: ` +
    `matches. Search first, then read only the files that matter. ${PATH_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'A JavaScript regular expression, matched per line.' },
      path: { type: 'string', description: 'Subfolder to search. Omit for the whole workspace.' },
      ignore_case: { type: 'boolean' },
    },
    required: ['pattern'],
  },
};

const EDIT_FILE: Tool = {
  name: 'edit_file',
  description:
    `Change one exact span of a file in the coding workspace: old_string (copied exactly from ` +
    `read_file, unique in the file) is replaced with new_string. Never rewrite a whole file to ` +
    `change a few lines. ${PATH_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string', description: 'The exact existing text, with enough lines to be unique.' },
      new_string: { type: 'string', description: 'What replaces it.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (renames).' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

const WRITE_FILE: Tool = {
  name: 'write_file',
  description:
    `Create a file in the coding workspace, or replace one entirely. For changes to an existing ` +
    `file, edit_file is the right tool. Parent folders are created. ${PATH_NOTE}`,
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string', description: 'The complete file content.' },
    },
    required: ['path', 'content'],
  },
};

/**
 * Register the coding tools — only when a workspace folder exists for this
 * turn: auto-detected from the coding window in front (when that is switched
 * on), else the fixed folder from Settings → Tools, else none. The folder is
 * the entire permission boundary: every path is resolved against it and
 * anything outside (including through symlinks) is refused.
 */
export async function addCodingTools(registry: ToolRegistry): Promise<void> {
  const settings = getSettings();
  const root =
    (settings.codingWorkspaceAuto ? await detectWorkspaceRoot() : null) || settings.codingWorkspaceRoot;
  if (!root) return;
  const define = (definition: Tool): Tool => ({
    ...definition,
    description: `${definition.description} The workspace is ${root}.`,
  });
  registry.set('list_files', { definition: define(LIST_FILES), execute: (input) => listFiles(root, input) });
  registry.set('read_file', { definition: define(READ_FILE), execute: (input) => readFileTool(root, input) });
  registry.set('search_code', { definition: define(SEARCH_CODE), execute: (input) => searchCode(root, input) });
  registry.set('edit_file', {
    definition: define(EDIT_FILE),
    execute: (input, signal) => editFile(root, input, signal),
  });
  registry.set('write_file', {
    definition: define(WRITE_FILE),
    execute: (input, signal) => writeFileTool(root, input, signal),
  });
}

// --- Path guarding -----------------------------------------------------------

/**
 * Resolve and fence one requested path. Beyond the pure lexical check, the
 * nearest existing ancestor is realpath'd so a symlink inside the workspace
 * cannot smuggle a read or write outside it.
 */
async function guard(
  root: string,
  requested: unknown,
  forWrite: boolean,
): Promise<{ path: string; rel: string } | { error: string }> {
  const resolved = resolveInWorkspace(root, String(requested ?? ''));
  if ('error' in resolved) return resolved;
  if (secretName(resolved.path.split(sep).pop()!)) {
    return { error: 'That file looks like it holds secrets, which the coding tools never touch.' };
  }
  if (forWrite) {
    const denied = writeDenied(resolved.rel);
    if (denied) return { error: denied };
  }
  try {
    const realRoot = await realpath(root);
    const real = await realpath(await nearestExisting(resolved.path));
    const rel = relative(realRoot, real);
    if (rel.startsWith('..')) {
      return { error: 'That path leads outside the coding workspace through a symlink; refused.' };
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
  return resolved;
}

/** The path itself if it exists, else its closest existing ancestor. */
async function nearestExisting(path: string): Promise<string> {
  let current = path;
  for (;;) {
    if (await stat(current).then(() => true, () => false)) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

// --- Reading -----------------------------------------------------------------

async function readFileTool(root: string, input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const target = await guard(root, args['path'], false);
  if ('error' in target) return { content: target.error, isError: true };
  const loaded = await loadText(target.path);
  if ('error' in loaded) return { content: loaded.error, isError: true };

  const lines = loaded.text.split('\n');
  const offset = Math.max(1, Math.trunc(Number(args['offset']) || 1));
  const limit = Math.max(1, Math.trunc(Number(args['limit']) || lines.length));
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  if (slice.length === 0) return { content: `${target.rel} has ${lines.length} lines; offset ${offset} is past the end.`, isError: true };
  const header =
    slice.length === lines.length
      ? `${target.rel} (${lines.length} lines)`
      : `${target.rel} (lines ${offset}–${offset + slice.length - 1} of ${lines.length})`;
  return { content: clip(`${header}\n${slice.join('\n')}`) };
}

/** One file as text, or why it can't be model input (missing, huge, binary). */
async function loadText(path: string): Promise<{ text: string } | { error: string }> {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return { error: `No file at ${path}. Check the path with list_files or search_code.` };
  if (info.size > MAX_FILE_BYTES) return { error: `That file is ${Math.round(info.size / 1024)} KB — too large to read as source.` };
  const bytes = await readFile(path);
  if (bytes.subarray(0, 8192).includes(0)) return { error: 'That file is binary, not text.' };
  return { text: bytes.toString('utf8') };
}

// --- Listing and searching ---------------------------------------------------

/** The optional subfolder argument; the workspace root when omitted. */
function pathArg(args: Record<string, unknown>): string {
  return typeof args['path'] === 'string' && args['path'].trim() ? args['path'] : '.';
}

async function listFiles(root: string, input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const target = await guard(root, pathArg(args), false);
  if ('error' in target) return { content: target.error, isError: true };

  const entries: string[] = [];
  let more = false;
  for await (const entry of walk(target.path)) {
    if (entries.length >= MAX_LIST_ENTRIES) {
      more = true;
      break;
    }
    const rel = relative(target.path, entry.path);
    entries.push(entry.dirent.isDirectory() ? `${rel}/` : rel);
  }
  if (entries.length === 0) return { content: `${target.rel} is empty (generated folders are skipped).` };
  entries.sort();
  const note = more ? `\n…capped at ${MAX_LIST_ENTRIES} entries — list a subfolder to see more.` : '';
  return { content: clip(entries.join('\n') + note) };
}

async function searchCode(root: string, input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const source = typeof args['pattern'] === 'string' ? args['pattern'] : '';
  if (!source) return { content: 'search_code needs a pattern.', isError: true };
  let regex: RegExp;
  try {
    regex = new RegExp(source, args['ignore_case'] ? 'i' : '');
  } catch (error) {
    return { content: `That pattern is not a valid regular expression: ${error instanceof Error ? error.message : error}`, isError: true };
  }
  const target = await guard(root, pathArg(args), false);
  if ('error' in target) return { content: target.error, isError: true };

  const matches: string[] = [];
  let scanned = 0;
  let capped = false;
  for await (const entry of walk(target.path)) {
    if (entry.dirent.isDirectory()) continue;
    if (++scanned > MAX_SEARCH_FILES || matches.length >= MAX_SEARCH_MATCHES) {
      capped = true;
      break;
    }
    const loaded = await loadText(entry.path);
    if ('error' in loaded) continue; // binary or oversized: not searchable source
    const lines = loaded.text.split('\n');
    for (let i = 0; i < lines.length && matches.length < MAX_SEARCH_MATCHES; i++) {
      if (!regex.test(lines[i]!)) continue;
      const text = lines[i]!.length > 300 ? `${lines[i]!.slice(0, 300)}…` : lines[i]!;
      matches.push(`${relative(root, entry.path)}:${i + 1}: ${text.trim()}`);
    }
  }
  if (matches.length === 0) return { content: `No matches for /${source}/ under ${target.rel}.` };
  const note = capped ? `\n…results capped at ${MAX_SEARCH_MATCHES} — narrow the pattern or the path.` : '';
  return { content: clip(matches.join('\n') + note) };
}

/** Depth-first walk skipping generated folders and symlinks. */
async function* walk(dir: string): AsyncGenerator<{ path: string; dirent: Dirent }> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const dirent of entries) {
    if (dirent.isSymbolicLink()) continue;
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      if (SKIP_DIRS.has(dirent.name)) continue;
      yield { path, dirent };
      yield* walk(path);
    } else if (dirent.isFile()) {
      yield { path, dirent };
    }
  }
}

// --- Writing -----------------------------------------------------------------

async function editFile(root: string, input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const target = await guard(root, args['path'], true);
  if ('error' in target) return { content: target.error, isError: true };
  const loaded = await loadText(target.path);
  if ('error' in loaded) return { content: loaded.error, isError: true };

  const oldString = typeof args['old_string'] === 'string' ? args['old_string'] : '';
  const newString = typeof args['new_string'] === 'string' ? args['new_string'] : '';
  const edited = applyEdit(loaded.text, oldString, newString, args['replace_all'] === true);
  if ('error' in edited) return { content: edited.error, isError: true };

  const preview = `- ${oneLine(oldString)}\n+ ${oneLine(newString)}`;
  const approved = await approveWrite('Edit this file?', target.path, preview, false, signal);
  if (!approved) return { content: 'The user declined this edit. Do not make it another way.' };

  await writeFile(target.path, edited.text, 'utf8');
  log.info(`edited ${target.rel} (${edited.count} replacement${edited.count === 1 ? '' : 's'})`);
  const diffed = await showDiffInEditor(target.path, loaded.text);
  return {
    content:
      `Edited ${target.rel}: ${edited.count} replacement${edited.count === 1 ? '' : 's'}.` +
      (diffed ? " A diff of the change is open in the user's editor." : ''),
  };
}

async function writeFileTool(root: string, input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const target = await guard(root, args['path'], true);
  if ('error' in target) return { content: target.error, isError: true };
  const content = typeof args['content'] === 'string' ? args['content'] : '';

  const existing = await stat(target.path).catch(() => null);
  if (existing && !existing.isFile()) return { content: `${target.rel} exists and is not a file.`, isError: true };
  // What the file said before a replacement, for the editor diff; a file that
  // can't be read as text (binary, oversized) just gets no diff.
  const before = existing ? await loadText(target.path) : null;
  const lines = content.split('\n').length;
  const title = existing ? 'Replace this file?' : 'Create this file?';
  // Replacing a file wholesale can destroy content the model never read;
  // that is the one write that still asks in risky-only approval.
  const approved = await approveWrite(
    title,
    target.path,
    `${lines} line${lines === 1 ? '' : 's'}`,
    Boolean(existing),
    signal,
  );
  if (!approved) return { content: 'The user declined this write. Do not make it another way.' };

  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, content, 'utf8');
  log.info(`wrote ${target.rel} (${lines} lines${existing ? ', replaced' : ''})`);
  const diffed = before && 'text' in before && (await showDiffInEditor(target.path, before.text));
  return {
    content:
      `${existing ? 'Replaced' : 'Created'} ${target.rel} (${lines} lines).` +
      (diffed ? " A diff of the change is open in the user's editor." : ''),
  };
}

/**
 * The write gate, mirroring run_command's tiers. "Every change" waits on a
 * card each time; "Only risky changes" lets exact edits and new files run
 * freely and asks only before replacing an existing file wholesale (the red
 * card, strict — an unclear spoken answer counts as no); "Never" treats the
 * workspace folder as the user's standing approval. The card names the full
 * path, home-abbreviated, so with auto-detection on it is always clear which
 * project is being changed.
 */
async function approveWrite(
  title: string,
  path: string,
  note: string,
  risky: boolean,
  signal: AbortSignal,
): Promise<boolean> {
  const approval = getSettings().codingEditApproval;
  if (approval === 'auto' || (approval === 'risky' && !risky)) return true;
  return requestConfirmation(
    {
      title,
      detail: homeRel(path),
      note: note.length > CONFIRM_PREVIEW_LIMIT ? `${note.slice(0, CONFIRM_PREVIEW_LIMIT)}…` : note,
      ...(risky ? { danger: true } : {}),
    },
    signal,
    risky,
  );
}

/** A path with the home folder abbreviated to ~, for the card. */
function homeRel(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/** A multi-line string as one clipped card line. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

function clip(text: string): string {
  return truncateForModel(text, getSettings().mcpResultLimit);
}
