// Apps: the user's connected services through Composio, on their own key or
// Buddy's (backend.ts). The model never sees toolkit schemas: it searches,
// then Buddy runs one tool and confirms anything that is not read-only.
// GitHub alone is hundreds of tools, so they stay on Composio's side.

import { shell } from 'electron';
import { connectAppLabel, splitConnectAppTool } from '../../shared/connect-apps';
import type { AppConnection } from '../../shared/types';
import type { ToolOutcome, ToolRegistry } from '../ai/tools';
import { senderLabel } from '../automated-sender';
import { createLogger } from '../log';
import { resolveTurnFiles } from '../session/turn-files';
import { requestConfirmation } from '../mcp/confirm';
import { getPermissionOverride } from '../mcp/config';
import { decidePermission } from '../mcp/permissions';
import { toolConfirmCard } from '../mcp/tool-card';
import { getSettings } from '../settings';
import { errorMessage } from '../../shared/errors';
import type { MomentEvent } from '../../shared/moments';
import { appsBackend } from './backend';
import { calendarEvents, calendarLines, calendarWindow } from './calendar';

/**
 * The pseudo server id Composio tool permissions are stored under, in the
 * same override table as MCP tools — one allow/ask/deny model everywhere.
 */
export const COMPOSIO_SERVER_ID = 'composio';

const log = createLogger('composio');

/** Last successful connection list for this backend, so a guide turn can nudge without waiting on the network. */
let known: { backend: string; slugs: string[] } | null = null;
const readOnly = new Map<string, boolean>();
/**
 * Writes that send nothing and lose nothing, allowed like a read unless the
 * user says otherwise: a draft waits in Drafts, a label (archive is taking
 * INBOX off) comes back off, and Trash keeps a message for 30 days.
 * Sending and deleting for good still ask.
 */
const UNDOABLE = new Set([
  'GMAIL_CREATE_EMAIL_DRAFT',
  'GMAIL_BATCH_MODIFY_MESSAGES',
  'GMAIL_ADD_LABEL_TO_EMAIL',
  'GMAIL_MODIFY_THREAD_LABELS',
  'GMAIL_MOVE_TO_TRASH',
]);

function grounded(): boolean {
  return getSettings().airplaneMode;
}

/** Apps can work right now: a key or a sign-in, and not airplane mode. */
export function appsReady(): boolean {
  return appsBackend() !== null && !grounded();
}

/** Slugs known connected for the current backend. Null until a list has succeeded. */
export function knownConnectedApps(): string[] | null {
  const backend = appsBackend();
  if (!backend || known?.backend !== backend.id) return null;
  return known.slugs;
}

/**
 * Every toolkit this Mac holds an account for, with whether it still works.
 * Null when Apps cannot be asked yet (not signed in, or the account's keys
 * are still loading): an empty list would read as "nothing connected".
 * Empty when airplane mode is on, or a real list came back with nothing.
 * Also refreshes the active-slug cache the prompts read.
 */
export async function listAppConnections(): Promise<AppConnection[] | null> {
  if (grounded()) return [];
  const backend = appsBackend();
  if (!backend) return null;
  const connections = await backend.connections();
  known = { backend: backend.id, slugs: connections.filter((entry) => entry.status === 'active').map((entry) => entry.slug) };
  return connections;
}

/** Slugs with a working connection: what search_apps can reach right now. */
export async function listConnectedApps(): Promise<string[]> {
  await listAppConnections();
  return known?.slugs ?? [];
}

/** The cached list when there is one, so readers in one run fetch it once. */
function connectedNow(): Promise<string[]> {
  const cached = knownConnectedApps();
  return cached ? Promise.resolve(cached) : listConnectedApps();
}

/** Remove the toolkit's connected account, so Buddy can no longer act as the user there. */
export async function disconnectApp(slug: string): Promise<{ ok: boolean; message: string }> {
  const backend = appsBackend();
  if (!backend) return { ok: false, message: NOT_READY };
  if (grounded()) return { ok: false, message: 'Airplane mode is on, so disconnecting waits.' };
  try {
    const removed = await backend.disconnect(slug);
    known = null;
    return removed
      ? { ok: true, message: `Disconnected ${connectAppLabel(slug)}.` }
      : { ok: false, message: `${connectAppLabel(slug)} is not connected.` };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

const NOT_READY = 'Sign in under Settings → Account, or paste a Composio key first.';

/** A Composio toolkit slug as the API spells them ("gmail", "google_calendar"). */
const TOOLKIT_SLUG = /^[a-z0-9_-]+$/;

/**
 * Open the toolkit's Connect Link in the browser. Any Composio toolkit, not
 * only the featured ones: the catalog is what the Apps page shows first,
 * not what may be linked.
 */
export async function connectApp(slug: string): Promise<{ ok: boolean; message: string }> {
  if (!TOOLKIT_SLUG.test(slug)) {
    return { ok: false, message: 'A toolkit slug is lowercase letters, digits, underscores, and hyphens, like "google_calendar".' };
  }
  const backend = appsBackend();
  if (!backend) return { ok: false, message: NOT_READY };
  if (grounded()) return { ok: false, message: 'Airplane mode is on, so connecting waits.' };
  try {
    await shell.openExternal(await backend.connectLink(slug));
    known = null;
    return { ok: true, message: 'Opened the connect link in your browser. Come back when you have signed in.' };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

async function searchApps(query: string): Promise<string> {
  const connected = await listConnectedApps();
  const backend = appsBackend();
  if (connected.length === 0 || !backend) {
    return 'No apps are connected. Connect one under Settings → Apps.';
  }
  const lines = await backend.search(query, connected);
  if (lines.length > 0) return lines.slice(0, 12).join('\n');
  // A miss usually means the API genuinely lacks the capability (LinkedIn has
  // no people search), not that a better query would find it.
  return (
    `No tool in the connected apps (${connected.map(connectAppLabel).join(', ')}) matches. ` +
    'Their APIs likely cannot do this — tell the user plainly what the connection does not cover before offering another route.'
  );
}

async function toolIsReadOnly(slug: string): Promise<boolean> {
  const cached = readOnly.get(slug);
  if (cached !== undefined) return cached;
  const ok = (await appsBackend()?.readOnly(slug)) ?? false;
  readOnly.set(slug, ok);
  return ok;
}

async function executeApp(
  slug: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const backend = appsBackend();
  if ((await listConnectedApps()).length === 0 || !backend) {
    return { content: 'No apps are connected.', isError: true };
  }
  const result = await backend.execute(slug, args);
  return result.error ? { content: result.error, isError: true } : { content: result.text };
}
/** How far back the morning suggestions look in Gmail. */
const GMAIL_LOOKBACK_DAYS = 3;

interface GmailHeader {
  subject?: string;
  sender?: string;
  messageTimestamp?: string;
  labelIds?: string[];
}

/**
 * Recent Gmail inbox headers as one text block (sender, subject, date, read
 * state; never a body), for a read-only consumer like the morning
 * suggestions. Metadata-only fetch, sorted newest first. Empty string when
 * Gmail is not connected or the fetch fails.
 */
export async function gmailHeaders(limit: number): Promise<string> {
  const backend = appsBackend();
  if (!backend || grounded()) return '';
  try {
    if (!(await connectedNow()).includes('gmail')) return '';
    const since = new Date(Date.now() - GMAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const after = `${since.getUTCFullYear()}/${since.getUTCMonth() + 1}/${since.getUTCDate()}`;
    const result = await backend.execute('GMAIL_FETCH_EMAILS', {
      user_id: 'me',
      query: `in:inbox after:${after}`,
      max_results: limit,
      verbose: false,
      include_payload: false,
    });
    if (result.error) return '';
    const data = JSON.parse(result.text || '{}') as { messages?: GmailHeader[] };
    const messages = (data.messages ?? [])
      .filter((message) => message.subject || message.sender)
      .sort((a, b) => Date.parse(b.messageTimestamp ?? '') - Date.parse(a.messageTimestamp ?? ''))
      .slice(0, limit);
    if (messages.length === 0) return '';
    const lines = messages.map((message) => {
      const flag = message.labelIds?.includes('UNREAD') ? 'unread' : 'read';
      const when = message.messageTimestamp ? new Date(message.messageTimestamp).toLocaleString() : '';
      return `- ${flag} · ${senderLabel(message.sender ?? '')} · ${message.subject ?? '(no subject)'}${when ? ` · ${when}` : ''}`;
    });
    return `Gmail inbox, newest first:\n${lines.join('\n')}`;
  } catch (error) {
    log.warn(`gmail headers failed: ${errorMessage(error)}`);
    return '';
  }
}

/** How far ahead the morning suggestions look on the calendar. */
const CALENDAR_AHEAD_DAYS = 14;
const CALENDAR_EVENTS = 12;

/**
 * Events across the connected Google calendars for the next two weeks, one
 * line each, soonest first. Holiday calendars the user added are included.
 * Empty when Calendar is not connected or the fetch fails.
 */
export async function calendarAhead(): Promise<string> {
  const lines = calendarLines(await calendarData(CALENDAR_AHEAD_DAYS, CALENDAR_EVENTS), CALENDAR_EVENTS);
  return lines.length ? `Calendar, next ${CALENDAR_AHEAD_DAYS} days:\n${lines.join('\n')}` : '';
}

/** Today's plans, focus blocks, and days away, with their ends and places. Empty when Calendar is off. */
export async function calendarToday(): Promise<MomentEvent[]> {
  return calendarEvents(await calendarData(1, CALENDAR_EVENTS));
}

/** The raw response for the connected calendars over `days`; null when Calendar is not connected or the fetch fails. */
async function calendarData(days: number, perCalendar: number): Promise<unknown> {
  const backend = appsBackend();
  if (!backend || grounded()) return null;
  try {
    if (!(await connectedNow()).includes('googlecalendar')) return null;
    const result = await backend.execute('GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS', {
      ...calendarWindow(days),
      single_events: true,
      max_results_per_calendar: perCalendar,
      response_detail: 'minimal',
    });
    if (result.error) throw new Error(result.error);
    return JSON.parse(result.text || '{}');
  } catch (error) {
    log.warn(`calendar fetch failed: ${errorMessage(error)}`);
    return null;
  }
}

/** search_apps and use_app, only when Apps can work and airplane mode is off. */
export function addComposioTools(registry: ToolRegistry): void {
  if (!appsReady()) return;
  registry.set('search_apps', {
    definition: {
      name: 'search_apps',
      description:
        'Find a tool in the apps the user connected under Settings → Apps. ' +
        'Call this before a walkthrough or a proposed task when a connected app might cover the request, including directions, email, calendar, messages, and files. ' +
        'Pass a short description of the job. Then call use_app with one returned slug. Do not invent slugs.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What the user wants done, in a few words.' },
        },
        required: ['query'],
      },
    },
    execute: async (input) => {
      const query =
        typeof input === 'object' && input && 'query' in input ? String(input.query).trim() : '';
      if (!query) return { content: 'Say what to look for.', isError: true };
      try {
        return { content: await searchApps(query) };
      } catch (error) {
        return { content: errorMessage(error), isError: true };
      }
    },
  });
  registry.set('use_app', {
    definition: {
      name: 'use_app',
      description:
        'Run one tool returned by search_apps. arguments is that tool\'s input object. ' +
        'Anything that sends, spends, or changes data waits for the user\'s yes first.',
      input_schema: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'The tool slug from search_apps.' },
          arguments: {
            type: 'object',
            description: 'Arguments for that tool.',
            additionalProperties: true,
          },
          summary: {
            type: 'string',
            description:
              'What this does, in one plain sentence the user sees on the approval card. Name things the way they would: the event title and day, the person, the subject. Never an id. "Delete \\"Hemsy.ai x Endear Enablement Session\\" on Thursday, Oct 2 at 2pm."',
          },
          attachments: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Files to hand the tool: one the user sent this turn, by its exact name, or one on this Mac, by its path (\"~/Desktop/clip.mp3\"). Buddy uploads them and fills the tool's file parameter (Gmail's attachment, Drive's file); leave that parameter out of arguments.",
          },
        },
        required: ['tool', 'summary'],
      },
    },
    execute: async (input, signal) => {
      const record = typeof input === 'object' && input ? (input as Record<string, unknown>) : {};
      const tool = typeof record.tool === 'string' ? record.tool.trim() : '';
      let args =
        record.arguments && typeof record.arguments === 'object'
          ? (record.arguments as Record<string, unknown>)
          : {};
      const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
      if (!tool) return { content: 'Name the tool slug from search_apps.', isError: true };
      const resolved = resolveTurnFiles(record.attachments);
      if ('error' in resolved) return { content: resolved.error, isError: true };
      try {
        if (resolved.files.length > 0) {
          const backend = appsBackend();
          const placed = backend && (await backend.attach(tool, args, resolved.files));
          if (!placed) return { content: `${tool} takes no file, so nothing could be attached. Pick a tool that sends or uploads files.`, isError: true };
          args = placed;
        }
        // The same allow/ask/deny table as MCP tools: read-only defaults to
        // allow, writes ask, and the user's explicit override wins.
        const permission = decidePermission(
          getPermissionOverride(COMPOSIO_SERVER_ID, tool),
          UNDOABLE.has(tool) || (await toolIsReadOnly(tool)) ? { readOnlyHint: true } : undefined,
        );
        if (permission === 'deny') {
          return { content: "This tool is blocked in the user's settings.", isError: true };
        }
        if (permission === 'ask') {
          const [app, action] = splitConnectAppTool(tool);
          const approved = await requestConfirmation(toolConfirmCard(app, action, args, summary), signal);
          if (!approved) return { content: 'The user declined this tool call.', isError: true };
        }
        return await executeApp(tool, args);
      } catch (error) {
        return { content: errorMessage(error), isError: true };
      }
    },
  });
}
