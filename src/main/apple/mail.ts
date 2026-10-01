// The mail tool: Apple Mail, handled natively. List and read are one call;
// draft opens a compose window the user sends themselves — never send.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { appsReady, knownConnectedApps, listConnectedApps } from '../composio/apps';
import { senderLabel } from '../automated-sender';
import { createLogger } from '../log';
import { resolveTurnFiles } from '../session/turn-files';
import { jxaErrorMessage, runJxa } from './jxa';

const log = createLogger('mail');

const TIMEOUT_MS = 20_000;
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 40;
/** How far back an unread-only scan will walk before giving up. */
const UNREAD_SCAN = 200;
const MAX_BODY_CHARS = 2_000;

const MAIL_TOOL: Tool = {
  name: 'mail',
  description:
    'The Mac Mail app — never a proposed task, and never send. list_inbox and read_message are only ' +
    'for when no email account is connected under Apps. If Gmail is connected, do not call this to ' +
    'list or read mail: search_apps, then use_app. draft opens a compose window the user sends, with any files the user sent this turn attached.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list_inbox', 'read_message', 'draft'] },
      unread_only: { type: 'boolean', description: 'list_inbox: only unread messages.' },
      limit: { type: 'integer', description: `list_inbox: how many, 1-${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.` },
      id: { type: 'string', description: 'read_message: the id from list_inbox.' },
      to: { type: 'string', description: 'draft: recipient email.' },
      subject: { type: 'string' },
      body: { type: 'string' },
      attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'draft: files to attach: one the user sent this turn, by its exact name, or one on this Mac, by its path ("~/Desktop/clip.mp3").',
      },
    },
    required: ['action'],
  },
};

/** Register the mail tool. A no-op off macOS. */
export function addMailTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('mail', { definition: MAIL_TOOL, execute: mailControl });
}

/** Gmail covers the inbox, so Mail is not where a read should land. */
async function gmailConnected(): Promise<boolean> {
  if (!appsReady()) return false;
  const slugs = knownConnectedApps() ?? (await listConnectedApps().catch(() => []));
  return slugs.includes('gmail');
}

async function mailControl(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const action = typeof args['action'] === 'string' ? args['action'] : '';
  try {
    if ((action === 'list_inbox' || action === 'read_message') && (await gmailConnected())) {
      return {
        content:
          'Gmail is connected, so this inbox is not in Mail. Call search_apps for the email, then use_app with a slug it returned.',
        isError: true,
      };
    }
    switch (action) {
      case 'list_inbox':
        return await listInbox(args);
      case 'read_message':
        return await readMessage(args);
      case 'draft':
        return await draftMessage(args);
      default:
        return { content: `Unknown mail action "${action}".`, isError: true };
    }
  } catch (error) {
    log.warn(`mail ${action} failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'Mail'), isError: true };
  }
}

/**
 * The inbox's newest headers as one text block (sender, subject, date, read
 * state; never a body), for a read-only consumer like the morning
 * suggestions. Empty string when Mail has nothing or is not reachable.
 */
export async function inboxHeaders(limit: number): Promise<string> {
  if (process.platform !== 'darwin') return '';
  try {
    const outcome = await listInbox({ limit });
    return outcome.isError || typeof outcome.content !== 'string' ? '' : outcome.content;
  } catch {
    return '';
  }
}

async function listInbox(args: Record<string, unknown>): Promise<ToolOutcome> {
  const unreadOnly = args['unread_only'] === true;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args['limit']) || DEFAULT_LIMIT));
  const scan = unreadOnly ? UNREAD_SCAN : limit;

  const source = `(() => {
    const Mail = Application('Mail');
    const inbox = Mail.inbox;
    const n = inbox.messages.length;
    const out = [];
    const want = ${limit};
    const scan = ${scan};
    const unreadOnly = ${unreadOnly};
    for (let i = n - 1; i >= 0 && out.length < want && n - 1 - i < scan; i--) {
      const m = inbox.messages[i];
      const unread = !m.readStatus();
      if (unreadOnly && !unread) continue;
      out.push({
        id: String(m.id()),
        subject: m.subject() || '(no subject)',
        sender: m.sender() || '',
        date: String(m.dateReceived()),
        unread,
      });
    }
    return JSON.stringify({ total: n, messages: out });
  })()`;

  const parsed = JSON.parse(await runJxa(source, TIMEOUT_MS)) as {
    total: number;
    messages: Array<{ id: string; subject: string; sender: string; date: string; unread: boolean }>;
  };
  if (parsed.messages.length === 0) {
    return { content: unreadOnly ? 'No unread messages in the inbox.' : 'The inbox is empty.' };
  }
  const lines = parsed.messages.map((m) => {
    const flag = m.unread ? 'unread' : 'read';
    return `- [${m.id}] ${flag} · ${senderLabel(m.sender)} · ${m.subject} · ${m.date}`;
  });
  return { content: `Inbox (${parsed.total} total), newest first:\n${lines.join('\n')}` };
}

async function readMessage(args: Record<string, unknown>): Promise<ToolOutcome> {
  const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
  if (!id) return { content: 'read_message needs the id from list_inbox.', isError: true };

  const source = `(() => {
    const Mail = Application('Mail');
    const found = Mail.inbox.messages.whose({ id: ${JSON.stringify(id)} })();
    if (found.length === 0) return JSON.stringify({ missing: true });
    const m = found[0];
    let body = '';
    try { body = m.content() || ''; } catch (e) { body = ''; }
    return JSON.stringify({
      subject: m.subject() || '(no subject)',
      sender: m.sender() || '',
      date: String(m.dateReceived()),
      body,
    });
  })()`;

  const parsed = JSON.parse(await runJxa(source, TIMEOUT_MS)) as {
    missing?: boolean;
    subject?: string;
    sender?: string;
    date?: string;
    body?: string;
  };
  if (parsed.missing) return { content: `No inbox message with id ${id}.`, isError: true };
  const body = (parsed.body ?? '').slice(0, MAX_BODY_CHARS);
  const clipped = (parsed.body ?? '').length > MAX_BODY_CHARS ? '\n…(clipped)' : '';
  return { content: `From ${parsed.sender}\n${parsed.subject}\n${parsed.date}\n\n${body}${clipped}` };
}

async function draftMessage(args: Record<string, unknown>): Promise<ToolOutcome> {
  const to = typeof args['to'] === 'string' ? args['to'].trim() : '';
  const subject = typeof args['subject'] === 'string' ? args['subject'] : '';
  const body = typeof args['body'] === 'string' ? args['body'] : '';
  if (!to) return { content: 'draft needs to (an email address).', isError: true };
  const resolved = resolveTurnFiles(args['attachments']);
  if ('error' in resolved) return { content: resolved.error, isError: true };
  const files = resolved.files;

  const attach = files.map((file) => `msg.attachments.push(Mail.Attachment({ fileName: Path(${JSON.stringify(file.path)}) }));`);
  const source = `(() => {
    const Mail = Application('Mail');
    Mail.activate();
    const msg = Mail.OutgoingMessage({
      subject: ${JSON.stringify(subject)},
      content: ${JSON.stringify(body)},
      visible: true,
    });
    Mail.outgoingMessages.push(msg);
    msg.toRecipients.push(Mail.ToRecipient({ address: ${JSON.stringify(to)} }));
    ${attach.join('\n    ')}
    return 'ok';
  })()`;

  await runJxa(source, TIMEOUT_MS);
  const withFiles = files.length ? `, with ${files.map((file) => file.name).join(', ')} attached` : '';
  return { content: `Opened a draft to ${to} in Mail${withFiles}. The user has to send it.` };
}
