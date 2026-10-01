// The notes tool: Apple Notes, handled natively. Create a note, or search
// existing ones. Search bulk-fetches titles and bodies (never `whose` on a
// large library) and matches either — people rarely title notes.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { jxaErrorMessage, runJxa } from './jxa';

const log = createLogger('notes');

const TIMEOUT_MS = 25_000;
const MAX_MATCHES = 8;
const MAX_BODY_CHARS = 1_500;

const NOTES_TOOL: Tool = {
  name: 'notes',
  description:
    "Apple Notes, in one call — never a proposed task. create adds a note (folder optional). " +
    'search finds notes by words in the body or the title — most notes have no useful title.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'search'] },
      title: { type: 'string', description: 'create: the note title.' },
      body: { type: 'string', description: 'create: the note body.' },
      folder: { type: 'string', description: 'create: folder name. Default the default folder.' },
      query: { type: 'string', description: 'search: words to match in the body or title.' },
    },
    required: ['action'],
  },
};

/** Register the notes tool. A no-op off macOS. */
export function addNotesTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('notes', { definition: NOTES_TOOL, execute: notesControl });
}

async function notesControl(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const action = typeof args['action'] === 'string' ? args['action'] : '';
  try {
    if (action === 'create') return await createNote(args);
    if (action === 'search') return await searchNotes(args);
    return { content: `Unknown notes action "${action}".`, isError: true };
  } catch (error) {
    log.warn(`notes ${action} failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'Notes'), isError: true };
  }
}

async function createNote(args: Record<string, unknown>): Promise<ToolOutcome> {
  const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
  const body = typeof args['body'] === 'string' ? args['body'] : '';
  const folder = typeof args['folder'] === 'string' ? args['folder'].trim() : '';
  if (!title) return { content: 'create needs a title.', isError: true };

  const source = `(() => {
    const Notes = Application('Notes');
    const props = { name: ${JSON.stringify(title)}, body: ${JSON.stringify(body)} };
    const wanted = ${JSON.stringify(folder)};
    if (wanted) {
      const folders = Notes.folders.whose({ name: wanted })();
      if (folders.length === 0) {
        const names = Notes.folders.name();
        return JSON.stringify({ error: 'No folder named ' + wanted + '. Available: ' + names.join(', ') });
      }
      folders[0].notes.push(Notes.Note(props));
      return JSON.stringify({ folder: wanted });
    }
    Notes.notes.push(Notes.Note(props));
    return JSON.stringify({ folder: '' });
  })()`;

  const parsed = JSON.parse(await runJxa(source, TIMEOUT_MS)) as { folder?: string; error?: string };
  if (parsed.error) return { content: parsed.error, isError: true };
  const where = parsed.folder ? ` in "${parsed.folder}"` : '';
  return { content: `Created the note "${title}"${where}.` };
}

async function searchNotes(args: Record<string, unknown>): Promise<ToolOutcome> {
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return { content: 'search needs a query.', isError: true };

  // Titles and bodies in two bulk fetches, then match in JS. `whose` on a
  // large Notes library is a timeout trap (Apple events scale with library
  // size); walking notes one-by-one for their body is worse.
  const source = `(() => {
    const Notes = Application('Notes');
    const needle = ${JSON.stringify(query.toLowerCase())};
    const strip = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
    const names = Notes.notes.name();
    const bodies = Notes.notes.body();
    const out = [];
    for (let i = 0; i < names.length && out.length < ${MAX_MATCHES}; i++) {
      const title = String(names[i] || '');
      const body = strip(bodies[i]);
      if (title.toLowerCase().indexOf(needle) === -1 && body.toLowerCase().indexOf(needle) === -1) continue;
      out.push({ title, body });
    }
    return JSON.stringify(out);
  })()`;

  const parsed = JSON.parse(await runJxa(source, TIMEOUT_MS)) as Array<{ title: string; body: string }>;
  if (parsed.length === 0) return { content: `No notes matching "${query}".` };
  const lines = parsed.map((note) => {
    const body =
      note.body.length > MAX_BODY_CHARS ? `${note.body.slice(0, MAX_BODY_CHARS)}…` : note.body;
    return `## ${note.title}\n${body || '(empty)'}`;
  });
  return { content: lines.join('\n\n') };
}
