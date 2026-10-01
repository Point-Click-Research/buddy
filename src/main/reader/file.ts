// Read a local file as text. Plain files go through as UTF-8; PDFs go
// through unpdf (pdf.js). file:// URLs are accepted as well as paths.

import { readFile } from 'fs/promises';
import { extname } from 'path';
import { fileURLToPath } from 'url';

const TEXT_EXTS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.rtf',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.xml',
  '.log',
  '.tex',
]);

export function resolveLocalPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('/')) return trimmed;
  return null;
}

export async function readLocalDocument(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  const bytes = await readFile(path);
  if (ext === '.pdf') return readPdf(bytes);
  if (TEXT_EXTS.has(ext) || ext === '') return bytes.toString('utf8');
  throw new Error(`I can read text and PDF files, not ${ext || 'this kind of file'}.`);
}

async function readPdf(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join('\n\n') : text;
  if (!joined.trim()) throw new Error('That PDF has no extractable text.');
  return joined;
}
