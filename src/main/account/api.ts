// Talking to the Buddy API as the signed-in user: the bearer on every call,
// and /v1/me for the Account page and for knowing which of Buddy's keys the
// desktop can route through. The last answer is kept on disk and used while
// a fresh one is fetched, so readiness checks (which cannot await) are right
// from the first turn after launch and through every token refresh.

import Store from 'electron-store';
import {
  MeSchema,
  MyReferralSchema,
  ReferralResultSchema,
  TIMEZONE_HEADER,
  type Me,
  type Meters,
  type PlanId,
  type UpgradePlan,
} from '../../shared/contracts';
import type { AccountView } from '../../shared/types';
import { createLogger } from '../log';
import { errorMessage } from '../../shared/errors';
import { ACCOUNT, accountConfigured } from './config';
import { bindPlanReader, setKnownPlan } from './plan-gate';
import { fitBrainToPlan } from './plan-fit';
import { accessToken, accountName, currentSession, identity } from './session';

const log = createLogger('account');

const ME_TTL_MS = 60_000;
/** After a failed /v1/me, wait this long before asking again rather than on every readiness check. */
const RETRY_MS = 15_000;

interface Cached {
  value: Me;
  at: number;
  userId: string;
}

/** Plan and managed keys, not secrets: fine in a plain store. Opened on first use, so importing this module needs no Electron. */
type Disk = Store<{ me: Cached | null }>;
let store: Disk | null = null;
function disk(): Disk {
  return (store ??= new Store<{ me: Cached | null }>({ name: 'account', defaults: { me: null } }));
}
let me: Cached | null | undefined;
let fetching: Promise<Me | null> | null = null;
let failedAt = 0;

/** A request to the API with the session's bearer. Throws when signed out. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in to Buddy.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(`${ACCOUNT.apiUrl}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}

/** The cached answer for the signed-in user, fresh or stale; null when there is none. */
function cachedMe(): Cached | null {
  const session = currentSession();
  if (!session || !accountConfigured()) return null;
  if (me === undefined) {
    me = disk().get('me');
    // The brain is fitted to a plan once, when an answer arrives: here from
    // disk at launch, and below on each fresh /v1/me. Fitting on every read
    // would keep clamping to a stale plan after an upgrade.
    if (me && me.userId === session.user.id) fitBrainToPlan(me.value.models, session.user.id);
  }
  if (!me || me.userId !== session.user.id) {
    setKnownPlan(null);
    return null;
  }
  setKnownPlan(me.value.plan);
  return me;
}

export async function fetchMe(force = false): Promise<Me | null> {
  const session = currentSession();
  if (!session || !accountConfigured()) return null;
  const cached = cachedMe();
  if (!force && cached && Date.now() - cached.at < ME_TTL_MS) return cached.value;
  if (fetching) return fetching;
  if (!force && Date.now() - failedAt < RETRY_MS) return cached?.value ?? null;
  fetching = (async () => {
    try {
      // The Mac's zone rides along, so a daily allowance resets at its midnight.
      const response = await apiFetch('/v1/me', {
        headers: { [TIMEZONE_HEADER]: Intl.DateTimeFormat().resolvedOptions().timeZone },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = MeSchema.parse(await response.json());
      me = { value, at: Date.now(), userId: session.user.id };
      setKnownPlan(value.plan);
      fitBrainToPlan(value.models, session.user.id, cached?.value.models ?? null);
      disk().set('me', me);
      failedAt = 0;
      return value;
    } catch (error) {
      failedAt = Date.now();
      log.warn(`/v1/me failed: ${errorMessage(error)}`);
      return cached?.value ?? null;
    } finally {
      fetching = null;
    }
  })();
  return fetching;
}

/** Some answer, awaited only when there has never been one (the first launch after signing in). */
export async function ensureMe(): Promise<Me | null> {
  const cached = cachedMe();
  if (cached) {
    if (Date.now() - cached.at >= ME_TTL_MS) void fetchMe();
    return cached.value;
  }
  return fetchMe();
}

/**
 * Which of Buddy's keys the API holds, from the last /v1/me. Synchronous
 * for readiness checks; a stale answer is used and a refresh started.
 */
export function managedProviders(): string[] {
  const cached = cachedMe();
  if (!cached || Date.now() - cached.at >= ME_TTL_MS) void fetchMe();
  return cached?.value.managed ?? [];
}

/**
 * The model prefixes the plan allows on Buddy's keys, from the last /v1/me;
 * null when nothing is known (signed out, or no answer yet), meaning no limit
 * the desktop can apply.
 */
export function managedModels(): string[] | null {
  const cached = cachedMe();
  return cached ? cached.value.models : null;
}

/** The plan and usage are stale (a billing change, a sign-out): refresh at the next ask. */
export function forgetMe(): void {
  if (me) me = { ...me, at: 0 };
  failedAt = 0;
}

/** What the Account page shows. */
export async function accountView(): Promise<AccountView> {
  const session = currentSession();
  const plan = session ? await fetchMe() : null;
  return {
    configured: accountConfigured(),
    signedIn: session !== null,
    identity: identity(),
    ...accountName(),
    plan: plan?.plan ?? null,
    meters: plan?.meters ?? null,
    usage: plan?.usage ?? null,
    onDemand: plan?.onDemand ?? null,
    periodEnd: plan?.period.end ?? null,
    billing: plan?.billing ?? false,
    upgrades: plan?.upgrades ?? [],
    managed: plan?.managed ?? [],
    models: plan?.models ?? [],
    referral: session ? await myReferral() : null,
  };
}

async function myReferral(): Promise<{ code: string; uses: number } | null> {
  try {
    const response = await apiFetch('/v1/referral/mine', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const { code, uses } = MyReferralSchema.parse(await response.json());
    return code ? { code, uses } : null;
  } catch (error) {
    log.warn(`/v1/referral/mine failed: ${errorMessage(error)}`);
    return null;
  }
}

/** A waitlist referral code: on success the plan is early, and the account view refreshes. */
export async function redeemReferral(code: string): Promise<{ ok: boolean; message: string }> {
  const response = await apiFetch('/v1/referral', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.trim() }),
  });
  if (response.status === 404) return { ok: false, message: "That code isn't one we know." };
  if (!response.ok) return { ok: false, message: `Could not check the code (HTTP ${response.status}).` };
  const { plan } = ReferralResultSchema.parse(await response.json());
  forgetMe();
  await fetchMe(true);
  return { ok: true, message: plan === 'early' ? "You're in. Welcome to Buddy." : "You're already in." };
}

/** Extra usage past the pool, on or off. The account view refreshes so the switch and the gate agree. */
export async function setOnDemand(on: boolean): Promise<void> {
  const response = await apiFetch('/v1/billing/on-demand', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ on }),
  });
  if (!response.ok) throw new Error(`Could not change extra usage (HTTP ${response.status}).`);
  forgetMe();
  await fetchMe(true);
}

/** A Stripe page (Checkout to upgrade, the portal to manage) to open in the browser. */
export async function billingLink(kind: 'checkout' | 'portal', plan: UpgradePlan = 'pro'): Promise<string> {
  const response = await apiFetch(`/v1/billing/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(kind === 'checkout' ? { plan } : {}),
  });
  if (!response.ok) throw new Error(`Billing is unavailable right now (HTTP ${response.status}).`);
  const { url } = (await response.json()) as { url: string };
  if (!url) throw new Error('Stripe returned no page.');
  return url;
}

/** The signed-in plan from the last /v1/me; null when signed out, unknown, or this build has no account. */
export function knownPlan(): PlanId | null {
  return cachedMe()?.value.plan ?? null;
}

/** Plan, today's meters, when they reset, and whether Upgrade can open Stripe. From the last /v1/me. */
export function knownAccount(): {
  plan: PlanId | null;
  periodEnd: string | null;
  billing: boolean;
  meters: Meters | null;
} {
  const value = cachedMe()?.value;
  return value
    ? { plan: value.plan, periodEnd: value.period.end, billing: value.billing, meters: value.meters }
    : { plan: null, periodEnd: null, billing: false, meters: null };
}

bindPlanReader(knownPlan);
