// Reading texts from the Messages database. macOS keeps every iMessage in
// ~/Library/Messages/chat.db, readable only with Full Disk Access. The system
// sqlite3 opens it read-only, so nothing here can change a message.

import { execFile } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { errorMessage } from '../../shared/errors';
import { textFromAttributedBody } from './parse';

const execFileAsync = promisify(execFile);

const CHAT_DB = join(homedir(), 'Library', 'Messages', 'chat.db');
const TIMEOUT_MS = 10_000;
/** How long a read waits out Messages' own write lock before "database is locked". */
const BUSY_MS = 2_000;

export interface IncomingText {
  handle: string;
  text: string;
  /** Files sent with it (photos, PDFs), where Messages keeps them on this Mac. */
  files: IncomingFile[];
}

export interface IncomingFile {
  path: string;
  /** The name as sent ("IMG_1234.HEIC"). */
  name: string;
  mimeType: string;
}

/** macOS withheld the database: Buddy needs Full Disk Access. */
export class NoDiskAccessError extends Error {
  constructor() {
    super("Buddy can't read your texts yet. Turn on Full Disk Access for Buddy, then quit and reopen it.");
  }
}

async function query<T>(sql: string): Promise<T[]> {
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', '-cmd', `.timeout ${BUSY_MS}`, CHAT_DB, sql], {
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    // sqlite3 prints nothing at all for zero rows.
    return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || errorMessage(error);
    if (/authorization denied|unable to open/i.test(detail)) throw new NoDiskAccessError();
    throw new Error(detail);
  }
}

/** Whether this process can open the Messages database. Full Disk Access has no status API; the open is the check. */
export async function canReadMessages(): Promise<boolean> {
  try {
    await query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

/** The newest message's row id: the bridge answers only what arrives after it starts. */
export async function latestTextId(): Promise<number> {
  const [row] = await query<{ id: number }>('SELECT COALESCE(MAX(ROWID), 0) AS id FROM message');
  return row?.id ?? 0;
}

/**
 * This Mac's own iMessage addresses (phone numbers, Apple ID emails): the
 * address every message was sent from or received at. Texting yourself
 * splits into threads under these, so they are how Buddy recognizes a
 * note-to-self no matter which of your addresses the phone picked.
 */
export async function ownHandles(): Promise<string[]> {
  const rows = await query<{ handle: string }>(
    "SELECT DISTINCT destination_caller_id AS handle FROM message WHERE destination_caller_id != ''",
  );
  return rows.map((row) => row.handle.replace(/^(tel|mailto):/i, ''));
}

/**
 * Plain texts after `afterId` in 1:1 threads, oldest first, and the id to
 * read from next, each with any files sent along. Both directions: your
 * texts from the phone sync to this Mac as sent by you. Tapbacks and group
 * events are skipped.
 */
export async function textsAfter(afterId: number): Promise<{ lastId: number; texts: IncomingText[] }> {
  const after = Math.floor(afterId);
  const [rows, attachments] = await Promise.all([
    query<{ id: number; handle: string | null; text: string | null; body: string | null; plain: number }>(
      `SELECT m.ROWID AS id, h.id AS handle, m.text AS text, hex(m.attributedBody) AS body,
         (m.item_type = 0 AND m.associated_message_type = 0) AS plain
       FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE m.ROWID > ${after}
       ORDER BY m.ROWID`,
    ),
    query<{ id: number; filename: string | null; name: string | null; mime: string | null }>(
      `SELECT j.message_id AS id, a.filename AS filename, a.transfer_name AS name, a.mime_type AS mime
       FROM message_attachment_join j JOIN attachment a ON a.ROWID = j.attachment_id
       WHERE j.message_id > ${after}`,
    ),
  ]);
  const filesOf = new Map<number, IncomingFile[]>();
  for (const row of attachments) {
    if (!row.filename) continue;
    const path = row.filename.replace(/^~(?=\/)/, homedir());
    const list = filesOf.get(row.id) ?? [];
    list.push({ path, name: row.name || path.split('/').pop() || 'file', mimeType: row.mime ?? '' });
    filesOf.set(row.id, list);
  }
  const texts = rows
    .filter((row) => row.plain && row.handle)
    .map((row) => ({
      handle: row.handle ?? '',
      // U+FFFC stands in for an attachment in the text itself.
      text: (row.text?.trim() || textFromAttributedBody(row.body ?? '')).replace(/\uFFFC/g, '').trim(),
      files: filesOf.get(row.id) ?? [],
    }));
  return { lastId: rows[rows.length - 1]?.id ?? afterId, texts };
}
