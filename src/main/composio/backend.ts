// Where Apps calls go: the Composio SDK on the user's own key, or the Buddy
// API on Buddy's key for a signed-in user. Same six operations either way,
// so apps.ts never knows which it got.

import { Composio } from '@composio/core';
import {
  AppAttachSchema,
  AppConnectionsSchema,
  AppExecuteSchema,
  AppLinkSchema,
  AppSearchSchema,
  AppToolSchema,
  placeAppFiles,
  toolkitOf,
  type AppFileSchema,
} from '../../shared/contracts';
import { readFile } from 'node:fs/promises';
import type { AppConnection } from '../../shared/types';
import { apiFetch } from '../account/api';
import { managedReady } from '../account/credentials';
import { composioUserId, getAppSecret } from '../settings';

export interface AppsBackend {
  /** 'own' on the user's key, 'buddy' through the API; part of the cache key. */
  readonly id: string;
  connections(): Promise<AppConnection[]>;
  connectLink(slug: string): Promise<string>;
  /** False when the toolkit was not connected. */
  disconnect(slug: string): Promise<boolean>;
  /** One line per tool: "SLUG — description". */
  search(query: string, toolkits: string[]): Promise<string[]>;
  readOnly(slug: string): Promise<boolean>;
  execute(slug: string, args: Record<string, unknown>): Promise<{ text: string; error: string | null }>;
  /**
   * The args with these files uploaded and placed in the tool's file
   * parameter (Gmail's attachment, Drive's file, Slack's upload). Null when
   * the tool takes no file.
   */
  attach(slug: string, args: Record<string, unknown>, files: AppFile[]): Promise<Record<string, unknown> | null>;
}

/** A file on this Mac to hand an app tool. */
export interface AppFile {
  name: string;
  path: string;
  mediaType: string;
}

const TOOLKITS_PAGE = 50;
const RESULT_LIMIT = 8000;

let own: { key: string; backend: AppsBackend } | null = null;
let buddy: AppsBackend | null = null;

/** The backend for right now, or null when neither a key nor a sign-in can serve Apps. */
export function appsBackend(): AppsBackend | null {
  const key = getAppSecret('composio');
  if (key) {
    if (own?.key !== key) own = { key, backend: sdkBackend(key) };
    return own.backend;
  }
  if (!managedReady('composio')) return null;
  buddy ??= apiBackend();
  return buddy;
}

function sdkBackend(key: string): AppsBackend {
  const client = new Composio({ apiKey: key });
  let session: Promise<Awaited<ReturnType<Composio['create']>>> | null = null;
  // Unpinned, like the API's session: every toolkit the user links is in reach.
  const current = () => (session ??= client.create(composioUserId()));
  const reset = (): void => {
    session = null;
  };
  return {
    id: `own:${key.slice(-6)}`,
    async connections() {
      const found: AppConnection[] = [];
      let cursor: string | undefined;
      do {
        const page = await (await current()).toolkits({ isConnected: true, limit: TOOLKITS_PAGE, cursor });
        for (const item of page.items) {
          const account = item.connection?.connectedAccount;
          if (!account) continue;
          const active = item.connection?.isActive === true || account.status?.toUpperCase() === 'ACTIVE';
          found.push({ slug: item.slug.toLowerCase(), status: active ? 'active' : 'expired' });
        }
        cursor = page.cursor;
      } while (cursor);
      return found;
    },
    async connectLink(slug) {
      const request = await (await current()).authorize(slug);
      reset();
      if (!request.redirectUrl) throw new Error('Composio did not return a connect link.');
      return request.redirectUrl;
    },
    async disconnect(slug) {
      const page = await (await current()).toolkits({ toolkits: [slug] });
      const account = page.items[0]?.connection?.connectedAccount;
      if (account) await client.connectedAccounts.delete(account.id);
      reset();
      return Boolean(account);
    },
    async search(query, toolkits) {
      const found = await (await current()).search({ query, toolkits });
      if (!found.success) return [];
      return found.results.flatMap((result) =>
        result.primaryToolSlugs.map((slug) => {
          const description = found.toolSchemas[slug]?.description;
          return description ? `${slug} — ${description}` : slug;
        }),
      );
    },
    async readOnly(slug) {
      try {
        const tool = await client.tools.getRawComposioToolBySlug(slug);
        return (tool.tags ?? []).includes('readOnlyHint');
      } catch {
        return false;
      }
    },
    async execute(slug, args) {
      const result = await (await current()).execute(slug, args);
      if (result.error) return { text: '', error: result.error };
      const text = JSON.stringify(result.data ?? {});
      return { text: text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}…` : text, error: null };
    },
    async attach(slug, args, files) {
      // The session's execute does no file handling of its own, so the
      // upload is explicit: Composio stages the bytes and hands back the
      // {name, mimetype, s3key} its file parameters take.
      const tool = await client.tools.getRawComposioToolBySlug(slug);
      const uploads = await Promise.all(
        files.map((file) => client.files.upload({ file: file.path, toolSlug: slug, toolkitSlug: toolkitOf(slug, tool.toolkit?.slug) })),
      );
      return placeAppFiles(tool.inputParameters as AppFileSchema | undefined, args, uploads);
    },
  };
}

function apiBackend(): AppsBackend {
  const call = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await apiFetch(`/v1/apps${path}`, init);
    if (!response.ok) throw new Error(`Apps failed (HTTP ${response.status}): ${(await response.text()).slice(0, 200)}`);
    return response.json();
  };
  const post = (path: string, body?: unknown): Promise<unknown> =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    id: 'buddy',
    connections: async () => AppConnectionsSchema.parse(await call('/connections')),
    connectLink: async (slug) => AppLinkSchema.parse(await post(`/connect/${slug}`)).url,
    disconnect: async (slug) => ((await post(`/disconnect/${slug}`)) as { ok: boolean }).ok,
    search: async (query, toolkits) => AppSearchSchema.parse(await post('/search', { query, toolkits })).lines,
    readOnly: async (slug) => AppToolSchema.parse(await call(`/tool/${slug}`)).readOnly,
    execute: async (slug, args) => AppExecuteSchema.parse(await post('/execute', { slug, args })),
    attach: async (slug, args, files) => {
      // The API does the upload on Buddy's key; the bytes go up base64.
      const body = {
        slug,
        args,
        files: await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            mediaType: file.mediaType,
            base64: (await readFile(file.path)).toString('base64'),
          })),
        ),
      };
      const result = await post('/attach', body);
      return result === null ? null : AppAttachSchema.parse(result).args;
    },
  };
}
