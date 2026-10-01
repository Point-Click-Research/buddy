// Sign-ins for Buddy's browser, brought from the browser the user already
// lives in. Chromium browsers keep each cookie encrypted with a key in the
// login Keychain; macOS asks the user once before handing it over, and that
// prompt is the consent. The database is copied first (so the other browser
// can stay open), decrypted in memory, and written into Buddy's partition.
// Cookie values are never logged and never leave this Mac.

import { execFile } from 'child_process';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { session } from 'electron';
import { copyFile, mkdtemp, readFile, rm, stat } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { LoginSource } from '../../shared/types';
import { createLogger } from '../log';
import { BROWSER_PARTITION } from './window';

const execFileAsync = promisify(execFile);
const log = createLogger('browser-logins');

/** Chromium browsers on macOS: where each keeps its profiles, and the Keychain item holding its cookie key. */
const BROWSERS = [
  { name: 'Chrome', app: 'Google Chrome', dir: 'Google/Chrome', keychain: 'Chrome Safe Storage' },
  { name: 'Arc', app: 'Arc', dir: 'Arc/User Data', keychain: 'Arc Safe Storage' },
  { name: 'Dia', app: 'Dia', dir: 'Dia/User Data', keychain: 'Dia Safe Storage' },
  { name: 'Brave', app: 'Brave Browser', dir: 'BraveSoftware/Brave-Browser', keychain: 'Brave Safe Storage' },
  { name: 'Edge', app: 'Microsoft Edge', dir: 'Microsoft Edge', keychain: 'Microsoft Edge Safe Storage' },
  { name: 'Vivaldi', app: 'Vivaldi', dir: 'Vivaldi', keychain: 'Vivaldi Safe Storage' },
] as const;

type Browser = (typeof BROWSERS)[number];

interface Profile extends LoginSource {
  browser: Browser;
  cookies: string;
  modified: number;
}

/** The user has this long to answer the Keychain prompt. */
const KEYCHAIN_TIMEOUT_MS = 90_000;
/** Chromium stopped prefixing each value with a hash of its host at this database version. */
const HASHED_VALUES_VERSION = 24;
const SAME_SITE = ['no_restriction', 'lax', 'strict'] as const;

interface CookieRow {
  host: string;
  name: string;
  value: string;
  enc: string;
  path: string;
  /** Seconds since 1970, or 0 for a session cookie. */
  expires: number;
  secure: number;
  httpOnly: number;
  sameSite: number;
}

/** Every profile with cookies, most recently used first. */
export async function listLoginSources(): Promise<LoginSource[]> {
  return (await findProfiles()).map(({ id, label, app }) => ({ id, label, app }));
}

/**
 * Copy one profile's sign-ins into Buddy's browser. Cookies it already has
 * for the same site and name are replaced, so bringing again picks up a
 * fresh sign-in. Returns the browser's label and how many sites came over.
 */
export async function bringLogins(sourceId: string): Promise<{ label: string; sites: number }> {
  const profile = (await findProfiles()).find((candidate) => candidate.id === sourceId);
  if (!profile) throw new Error('That browser profile is gone. Pick another.');
  const key = await cookieKey(profile.browser);
  const rows = await readCookies(profile.cookies);
  const ses = session.fromPartition(BROWSER_PARTITION);
  const sites = new Set<string>();
  let failed = 0;
  await Promise.all(
    rows.map(async (row) => {
      const value = row.enc ? decryptCookie(Buffer.from(row.enc, 'hex'), key, row.version) : row.value;
      if (value === null) return void failed++;
      try {
        await ses.cookies.set(cookieDetails(row, value));
        sites.add(row.host.replace(/^\./, ''));
      } catch {
        failed++;
      }
    }),
  );
  await ses.cookies.flushStore();
  log.info(`brought ${rows.length - failed} cookies for ${sites.size} sites from ${profile.label} (${failed} skipped)`);
  if (sites.size === 0) throw new Error(`Nothing from ${profile.label} could be read. Sign in to sites below instead.`);
  return { label: profile.label, sites: sites.size };
}

/** Sign Buddy's browser out of everything. The user's own browser is untouched. */
export async function forgetLogins(): Promise<void> {
  await session.fromPartition(BROWSER_PARTITION).clearStorageData();
}

/**
 * httpOnly cookies a site sets before anyone signs in: bot checks and CDN
 * routing (Cloudflare, Akamai, Datadome, Fastly). They made a logged-out
 * Resy read as signed in.
 */
const NOT_A_SESSION = /^(__cf_bm|cf_clearance|_cfuvid|__cflb|ak_bmsc|bm_sv|bm_sz|bm_mi|_abck|datadome|AWSALB|AWSALBCORS|incap_ses_|visid_incap_|fastly)/i;

/** Where sites send a visitor who is not signed in. */
const LOGIN_PAGE = /login|logon|signin|sign-in|sign_in|authwall|authenticate|auth\.|oauth|\/ap\//i;

/**
 * The sites Buddy's browser is signed in to. Two tells, both needed. A
 * session token is all but always an httpOnly cookie, and a tracker's all
 * but never is; but a site also leaves httpOnly cookies that outlive the
 * session (Facebook's two-year `datr`), and the ones every visitor gets are
 * set aside by name. So a site with such cookies is then asked: its account
 * page is fetched with them, and a site that answers with its sign-in page
 * is signed out, whatever the cookies say. A fetch that fails or is blocked
 * settles nothing, and the cookies' word stands.
 */
export async function signedInHosts(sites: ReadonlyArray<{ host: string; url: string }>): Promise<string[]> {
  const ses = session.fromPartition(BROWSER_PARTITION);
  const found = await Promise.all(
    sites.map(async ({ host, url }) => {
      const cookies = await ses.cookies.get({ domain: host }).catch(() => []);
      const session = cookies.filter((cookie) => cookie.httpOnly && !NOT_A_SESSION.test(cookie.name)).length;
      if (session === 0) return null;
      const sentToLogin = await landsOnLoginPage(ses, url);
      // Names and values stay out of the log; the counts say whether the check can see the site at all.
      log.info(`${host}: ${cookies.length} cookies, ${session} httpOnly, account page ${sentToLogin === null ? 'unreachable' : sentToLogin ? 'asks to sign in' : 'opens'}`);
      return sentToLogin ? null : host;
    }),
  );
  return found.filter((host) => host !== null);
}

/** Whether the page, fetched with Buddy's browser's cookies, ends up on a sign-in page. Null when it could not be reached. */
async function landsOnLoginPage(ses: Electron.Session, url: string): Promise<boolean | null> {
  try {
    const response = await ses.fetch(url, { signal: AbortSignal.timeout(6_000) });
    void response.body?.cancel();
    return response.ok || response.redirected ? LOGIN_PAGE.test(response.url) : null;
  } catch {
    return null;
  }
}

/**
 * One Chromium cookie value in the clear, or null when it cannot be read
 * (a newer scheme than v10, or a key that does not match).
 */
export function decryptCookie(encrypted: Buffer, key: Buffer, dbVersion: number): string | null {
  if (encrypted.subarray(0, 3).toString() !== 'v10') return null;
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
    const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
    return (dbVersion >= HASHED_VALUES_VERSION ? plain.subarray(32) : plain).toString('utf8');
  } catch {
    return null;
  }
}

/** Chromium's cookie key: the Keychain password stretched the way Chromium stretches it on macOS. */
export function deriveCookieKey(password: string): Buffer {
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

async function cookieKey(browser: Browser): Promise<Buffer> {
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-w', '-s', browser.keychain], {
      timeout: KEYCHAIN_TIMEOUT_MS,
    });
    return deriveCookieKey(stdout.trim());
  } catch {
    throw new Error(`macOS didn't share ${browser.name}'s key. Try again and choose Allow.`);
  }
}

/** Unexpired cookies from a copy of the database, with its schema version on each row. */
async function readCookies(path: string): Promise<Array<CookieRow & { version: number }>> {
  const dir = await mkdtemp(join(tmpdir(), 'buddy-cookies-'));
  const copy = join(dir, 'Cookies');
  try {
    await copyFile(path, copy);
    const sql = `
      SELECT host_key AS host, name, value, hex(encrypted_value) AS enc, path,
        CASE WHEN expires_utc = 0 THEN 0 ELSE expires_utc / 1000000 - 11644473600 END AS expires,
        is_secure AS secure, is_httponly AS httpOnly, samesite AS sameSite,
        (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'version') AS version
      FROM cookies
      WHERE expires_utc = 0 OR expires_utc / 1000000 - 11644473600 > CAST(strftime('%s', 'now') AS INTEGER)`;
    const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', copy, sql], {
      timeout: 30_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    return stdout.trim() ? JSON.parse(stdout) : [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What Electron needs to set one cookie. A host without a leading dot is host-only, so it gets no domain. */
function cookieDetails(row: CookieRow, value: string): Electron.CookiesSetDetails {
  const host = row.host.replace(/^\./, '');
  return {
    url: `http${row.secure ? 's' : ''}://${host}${row.path}`,
    name: row.name,
    value,
    path: row.path,
    secure: row.secure === 1,
    httpOnly: row.httpOnly === 1,
    sameSite: SAME_SITE[row.sameSite] ?? 'unspecified',
    ...(row.host.startsWith('.') ? { domain: row.host } : {}),
    ...(row.expires > 0 ? { expirationDate: row.expires } : {}),
  };
}

async function findProfiles(): Promise<Profile[]> {
  const support = join(homedir(), 'Library', 'Application Support');
  const found = await Promise.all(BROWSERS.map((browser) => browserProfiles(browser, join(support, browser.dir))));
  return found.flat().toSorted((a, b) => b.modified - a.modified);
}

/** A browser's profiles that have a cookie database, named the way the browser names them. */
async function browserProfiles(browser: Browser, root: string): Promise<Profile[]> {
  const names = await profileNames(root);
  const profiles = await Promise.all(
    Object.entries(names).map(async ([dir, name]) => {
      const cookies = await newest([join(root, dir, 'Cookies'), join(root, dir, 'Network', 'Cookies')]);
      return cookies ? { dir, name, ...cookies } : null;
    }),
  );
  const present = profiles.filter((profile) => profile !== null);
  return present.map(({ dir, name, path, modified }) => ({
    id: `${browser.name}:${dir}`,
    label: present.length > 1 ? `${browser.name} (${name})` : browser.name,
    app: browser.app,
    browser,
    cookies: path,
    modified,
  }));
}

/** Profile folder → display name, from the browser's Local State; just Default when it has none. */
async function profileNames(root: string): Promise<Record<string, string>> {
  try {
    const state = JSON.parse(await readFile(join(root, 'Local State'), 'utf8')) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const cache = state.profile?.info_cache ?? {};
    const names = Object.fromEntries(Object.entries(cache).map(([dir, info]) => [dir, info.name || dir]));
    return Object.keys(names).length > 0 ? names : { Default: 'Default' };
  } catch {
    return { Default: 'Default' };
  }
}

/** The most recently written of these files, or null when none exists. */
async function newest(paths: string[]): Promise<{ path: string; modified: number } | null> {
  const stats = await Promise.all(
    paths.map((path) => stat(path).then((info) => ({ path, modified: info.mtimeMs }), () => null)),
  );
  return stats.reduce<{ path: string; modified: number } | null>(
    (best, next) => (next && (!best || next.modified > best.modified) ? next : best),
    null,
  );
}
