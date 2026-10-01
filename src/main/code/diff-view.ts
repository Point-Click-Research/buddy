// After a coding-tool write, show the change as a real diff in the user's
// own editor: the pre-edit text goes to a temp file and the editor's CLI
// (cursor/code/zed --diff) opens its diff view against the file on disk.
// No CLI on the PATH, or the switch off in Settings, means no diff — the
// write itself is already done either way.

import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { promisify } from 'util';
import { createLogger } from '../log';
import { getSettings } from '../settings';

const execFileAsync = promisify(execFile);
const log = createLogger('diff-view');

const CLI_TIMEOUT_MS = 5_000;
/** Preference order when more than one editor CLI is installed. */
const EDITOR_CLIS = ['cursor', 'code', 'zed'];

/** Resolved once per app run: the full path of the preferred editor CLI. */
let cliPromise: Promise<string | null> | null = null;

function editorCli(): Promise<string | null> {
  cliPromise ??= (async () => {
    try {
      // A login shell resolves the same PATH the user's terminal has, and
      // `command -v` prints the full path of each CLI that exists.
      const { stdout } = await execFileAsync(
        process.env['SHELL'] || '/bin/zsh',
        ['-lc', `command -v ${EDITOR_CLIS.join(' ')} || true`],
        { timeout: CLI_TIMEOUT_MS },
      );
      const found = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
      const path = EDITOR_CLIS.map((cli) => found.find((p) => basename(p) === cli)).find(Boolean) ?? null;
      if (!path) log.info('no editor CLI (cursor, code, zed) on the PATH; skipping diff views');
      return path;
    } catch (error) {
      log.warn(`editor CLI lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  })();
  return cliPromise;
}

/**
 * Open the user's editor's diff view for one changed file: before-text on the
 * left, the file on disk on the right. Returns whether a diff was opened, so
 * the tool result can say so. Never throws — a missing editor is not a
 * failed edit.
 */
export async function showDiffInEditor(path: string, beforeText: string): Promise<boolean> {
  if (!getSettings().codingShowDiffs) return false;
  const cli = await editorCli();
  if (!cli) return false;
  try {
    // The before-file keeps the real basename so the diff tab reads like the
    // file, in a per-path folder so same-named files never clobber each other.
    const dir = join(tmpdir(), 'buddy-diffs', createHash('sha1').update(path).digest('hex').slice(0, 12));
    await mkdir(dir, { recursive: true });
    const before = join(dir, basename(path));
    await writeFile(before, beforeText, 'utf8');
    await execFileAsync(cli, ['--diff', before, path], { timeout: CLI_TIMEOUT_MS });
    return true;
  } catch (error) {
    log.warn(`diff view failed: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}
