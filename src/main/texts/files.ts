// Files texted to Buddy, made into the same drafts the chat composer sends:
// a photo (HEIC off an iPhone included) becomes a JPEG sized to what the
// model reads at, a PDF goes as it is, and anything else is left out.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { ATTACHMENT_LIMITS, type AttachmentDraft } from '../../shared/attachments';
import { createLogger } from '../log';
import type { IncomingFile } from './inbox';

const execFileAsync = promisify(execFile);
const log = createLogger('texts');

export async function textedDrafts(files: IncomingFile[]): Promise<AttachmentDraft[]> {
  const drafts: AttachmentDraft[] = [];
  for (const file of files.slice(0, ATTACHMENT_LIMITS.count)) {
    try {
      if (file.mimeType === 'application/pdf' || extname(file.path).toLowerCase() === '.pdf') {
        const bytes = await readFile(file.path);
        if (bytes.byteLength > ATTACHMENT_LIMITS.pdfBytes) continue;
        drafts.push({ kind: 'pdf', name: file.name, mediaType: 'application/pdf', base64: bytes.toString('base64') });
      } else if (file.mimeType.startsWith('image/')) {
        drafts.push(await photoDraft(file));
      }
    } catch (error) {
      log.warn(`texted file ${file.name} could not be read: ${error instanceof Error ? error.message : error}`);
    }
  }
  return drafts;
}

/** The photo as a JPEG no longer than the model reads on its longest side. */
async function photoDraft(file: IncomingFile): Promise<AttachmentDraft> {
  const dir = await mkdtemp(join(tmpdir(), 'buddy-texted-'));
  const out = join(dir, 'photo.jpg');
  try {
    await execFileAsync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(ATTACHMENT_LIMITS.imageEdge), file.path, '--out', out], {
      timeout: 15_000,
    });
    const name = `${basename(file.name, extname(file.name))}.jpg`;
    return { kind: 'image', name, mediaType: 'image/jpeg', base64: (await readFile(out)).toString('base64') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
