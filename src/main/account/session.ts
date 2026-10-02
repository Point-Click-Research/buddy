// The Supabase session: signing in with Google, staying
// signed in across launches, and the access token the API wants. The session
// (refresh token included) lives in the keychain through safeStorage; the
// renderer only ever learns whether someone is signed in and who.

import { shell } from 'electron';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../log';
import { getAppSecret, getSettings, setAppSecret, updateSettings } from '../settings';
import { broadcastSettings } from '../settings-view';
import { bindLocalAccount } from './local';
import { setKnownPlan } from './plan-gate';
import { errorMessage } from '../../shared/errors';
import { ACCOUNT, accountConfigured, LOOPBACK_URL } from './config';
import { awaitOAuthCode } from './loopback';

const log = createLogger('account');

let client: SupabaseClient | null = null;
let current: Session | null = null;
let listener: (() => void) | null = null;

/** Notified after any change to who is signed in. One is enough: ipc.ts broadcasts. */
export function onSessionChanged(cb: () => void): void {
  listener = cb;
}

/** The signed-in user's session, or null. Synchronous: the cached copy. */
export function currentSession(): Session | null {
  return current;
}

/** How they signed in, for the Account page: the Google email. */
export function identity(): string {
  const user = current?.user;
  // Supabase leaves the unused one as '', not null. Phone covers a session
  // created before phone sign-in was removed.
  return user?.email || user?.phone || '';
}

/**
 * The name they gave on the Account page, else the one Google shared at
 * sign-in split at the first space; '' parts when neither is known. With no
 * account service it is the user's own profile in Memory, kept on this Mac.
 */
export function accountName(): { firstName: string; lastName: string } {
  if (!accountConfigured()) return splitName(localName());
  const meta = current?.user.user_metadata ?? {};
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  if (text(meta.first_name) || text(meta.last_name)) {
    return { firstName: text(meta.first_name), lastName: text(meta.last_name) };
  }
  return splitName(text(meta.full_name ?? meta.name));
}

function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName = '', ...rest] = name.split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
}

/** 'Me' is the profile's placeholder until they give a name. */
function localName(): string {
  const name = getSettings().shoppers[0]?.name.trim() ?? '';
  return name === 'Me' ? '' : name;
}

/** Kept apart from Google's full_name, which Supabase rewrites on each Google sign-in. */
export async function setAccountName(firstName: string, lastName: string): Promise<void> {
  if (!accountConfigured()) {
    const [me, ...others] = getSettings().shoppers;
    updateSettings({ shoppers: [{ ...me!, name: `${firstName.trim()} ${lastName.trim()}`.trim() || 'Me' }, ...others] });
    broadcastSettings();
    return;
  }
  const { error } = await requireClient().auth.updateUser({
    data: { first_name: firstName.trim(), last_name: lastName.trim() },
  });
  if (error) throw new Error(error.message);
}

/** A fresh access token, refreshed if the cached one has expired; null when signed out. */
export async function accessToken(): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithGoogle(): Promise<void> {
  const supabase = requireClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: LOOPBACK_URL, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error(error?.message ?? 'Supabase returned no sign-in link.');
  const code = awaitOAuthCode();
  await shell.openExternal(data.url);
  const exchanged = await supabase.auth.exchangeCodeForSession(await code);
  if (exchanged.error) throw new Error(exchanged.error.message);
}

export async function signOut(): Promise<void> {
  setKnownPlan(null);
  const supabase = getClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) log.warn(`sign-out: ${error.message}`);
}

function requireClient(): SupabaseClient {
  const supabase = getClient();
  if (!supabase) throw new Error('This build has no Buddy account service configured.');
  return supabase;
}

function getClient(): SupabaseClient | null {
  if (client) return client;
  if (!accountConfigured()) return null;
  client = createClient(ACCOUNT.supabaseUrl, ACCOUNT.supabaseAnonKey, {
    auth: {
      storage: keychainStorage(),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  client.auth.onAuthStateChange((_event, session) => {
    current = session;
    listener?.();
  });
  // Load what the keychain holds so currentSession() is right from the start.
  void client.auth.getSession().then(({ data }) => {
    current = data.session;
    listener?.();
  });
  return client;
}

/**
 * supabase-js keeps its session (and the PKCE verifier) in a key-value
 * store; ours is one encrypted blob in the keychain, read once and written
 * through on every change.
 */
function keychainStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  let entries: Record<string, string>;
  try {
    entries = JSON.parse(getAppSecret('account') ?? '{}') as Record<string, string>;
  } catch (error) {
    log.warn(`stored session unreadable, starting signed out: ${errorMessage(error)}`);
    entries = {};
  }
  const save = (): void => setAppSecret('account', Object.keys(entries).length ? JSON.stringify(entries) : '');
  return {
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value;
      save();
    },
    removeItem: (key) => {
      delete entries[key];
      save();
    },
  };
}

/** Warm the client at launch so a stored session is live before the first turn. */
export function startAccount(): void {
  // Before jobs and chats are read, so a stored sign-in never flashes the previous account.
  bindLocalAccount(peekStoredUser());
  getClient();
}

/** A session is already on disk, before Supabase has rehydrated it. */
export function hasStoredAccount(): boolean {
  return peekStoredUser() !== null;
}

/** The user id in the keychain, before Supabase has rehydrated the session. */
function peekStoredUser(): { id: string; createdAt: number } | null {
  let entries: Record<string, string>;
  try {
    entries = JSON.parse(getAppSecret('account') ?? '{}') as Record<string, string>;
  } catch {
    return null;
  }
  for (const value of Object.values(entries)) {
    const user = sessionUser(value);
    if (user) return user;
  }
  return null;
}

function sessionUser(value: string): { id: string; createdAt: number } | null {
  try {
    const parsed = JSON.parse(value) as { user?: { id?: unknown; created_at?: unknown } };
    const id = parsed.user?.id;
    const created = parsed.user?.created_at;
    if (typeof id !== 'string' || typeof created !== 'string') return null;
    const createdAt = Date.parse(created);
    if (!Number.isFinite(createdAt)) return null;
    return { id, createdAt };
  } catch {
    return null;
  }
}
