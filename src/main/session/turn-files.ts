// The files a tool can forward (Messages, a Mail draft, an app): the ones
// sent with the current ask, staged on disk for the turn and gone after it,
// and files already on this Mac, named by path. The sent ones are known by
// the name the user saw; a path is fenced to the home folder, and never a
// file that looks like it holds secrets. The user's yes on the tool's card
// is the gate either way.

import { app } from 'electron';
import { mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { AttachmentDraft } from '../../shared/attachments';
import { secretName } from '../code/workspace';

export interface TurnFile {
  /** The name the user and the model know it by. */
  name: string;
  path: string;
  mediaType: string;
}

let staged: TurnFile[] = [];
let dir: string | null = null;

/**
 * Write this ask's files to a fresh folder, replacing the last ones sent.
 * An ask with no files keeps them: "send it to Matt" is often the message
 * after the one the photo came with. Under the user's home, not the system
 * temp dir: Messages' sandbox cannot read /var/folders, and Messages
 * uploads an attachment after the send call returns.
 */
export function stageTurnFiles(drafts: AttachmentDraft[]): TurnFile[] {
  if (drafts.length === 0) return staged;
  clearTurnFiles();
  dir = join(app.getPath('userData'), 'outbox', String(Date.now()));
  mkdirSync(dir, { recursive: true });
  staged = drafts.map((draft, index) => {
    // The name is the user's, but the path is ours: a bare basename inside our folder.
    const safe = basename(draft.name).replace(/[/\\:]/g, '_') || `file-${index + 1}`;
    const path = join(dir!, `${index + 1}-${safe}`);
    writeFileSync(path, Buffer.from(draft.base64, 'base64'));
    return { name: draft.name, path, mediaType: draft.mediaType };
  });
  return staged;
}

/** The staged file with this name (or its basename), case-insensitive; null when the model made one up. */
export function turnFile(name: string): TurnFile | null {
  const wanted = name.trim().toLowerCase();
  return staged.find((file) => file.name.toLowerCase() === wanted || basename(file.name).toLowerCase() === wanted) ?? null;
}

/** Every staged file's name, for the prompt; empty when none were sent. */
export function turnFileNames(): string[] {
  return staged.map((file) => file.name);
}

/**
 * The tool's `attachments` argument resolved to files: each entry is a name
 * the user sent this turn, or a path on this Mac ("~/Desktop/clip.mp3").
 * The line to give the model back when one is neither.
 */
export function resolveTurnFiles(names: unknown): { files: TurnFile[] } | { error: string } {
  const wanted = Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string' && name.trim() !== '') : [];
  const files: TurnFile[] = [];
  for (const name of wanted) {
    const file = turnFile(name) ?? localFile(name);
    if ('error' in file) return file;
    files.push(file);
  }
  return { files };
}

/** A file on this Mac by path, or why not: outside home, missing, a folder, or credentials. `home` is for tests. */
export function localFile(text: string, home = homedir()): TurnFile | { error: string } {
  const raw = text.trim();
  const looksLikePath = raw.startsWith('~') || isAbsolute(raw) || raw.includes('/');
  if (!looksLikePath) {
    const have = turnFileNames();
    return {
      error: have.length
        ? `No file named "${raw}" was sent this turn. The files are: ${have.join(', ')}. A file on this Mac is named by its path ("~/Desktop/${raw}").`
        : `No file named "${raw}" was sent this turn. A file on this Mac is named by its path ("~/Desktop/${raw}").`,
    };
  }
  const path = resolve(raw.startsWith('~') ? join(home, raw.slice(1)) : raw);
  if (secretName(basename(path))) return { error: 'That file looks like it holds secrets, which Buddy never sends.' };
  try {
    // Real paths on both sides, so a symlink cannot lead out of home.
    const real = realpathSync(path);
    const inside = relative(realpathSync(home), real);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
      return { error: `Buddy only sends files inside your home folder; ${raw} is outside it.` };
    }
    if (!statSync(real).isFile()) return { error: `${raw} is a folder, not a file.` };
    return { name: basename(real), path: real, mediaType: mediaTypeOf(real) };
  } catch {
    return { error: `There is no file at ${raw}.` };
  }
}

const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function clearTurnFiles(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
  staged = [];
}

/** At launch: whatever the last run left in the outbox is long sent. */
export function sweepOutbox(): void {
  rmSync(join(app.getPath('userData'), 'outbox'), { recursive: true, force: true });
}
