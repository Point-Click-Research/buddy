// What an API failure means, provider-neutral. Every brain, ear, and voice
// path reads errors through here, so the same 429 says the same thing
// whichever provider raised it — OpenAI reports an empty balance as a 429,
// which is not a rate limit — and a dead key is remembered under Settings →
// Providers instead of being announced once and forgotten.

import { keyWarningText } from "../../shared/key-warning";
import { type KeyProvider } from "../../shared/types";
import { createLogger } from "../log";
import { knownAccount } from "../account/api";
import { getApiKey, getSettings, updateSettings } from "../settings";
import { broadcastSettings } from "../settings-view";
import { errorMessage } from "../../shared/errors";
import { budgetSpentMessage, readBudget } from "./budget-message";

const log = createLogger("api-errors");

/** A failure that reads as "the internet is unreachable", not the API. */
export function isNetworkError(error: unknown): boolean {
  // "Connection error." is how the OpenAI and Anthropic SDKs report a dead
  // network; the rest are fetch/undici and raw socket spellings.
  return /fetch failed|network|connection (error|refused|reset)|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|offline/i.test(
    errorMessage(error),
  );
}

/** An empty balance, in each provider's words: OpenAI's "no credits remaining" and quota errors, Anthropic's "credit balance", billing holds. */
export function isCreditsError(error: unknown): boolean {
  return /no credits|credit balance|insufficient[_ ]quota|exceeded your current quota|\bquota\b|billing/i.test(
    errorMessage(error),
  );
}

/** A refused key: wrong, revoked, or unauthenticated. */
export function isRefusedKey(error: unknown): boolean {
  return /401|authentication|invalid.{0,10}(api.)?key/i.test(
    errorMessage(error),
  );
}

/**
 * A failure every retry will repeat, so it is worth retiring the key for the
 * run and warning about it. Rate limits and network blips are transient.
 */
export function isDeadKey(error: unknown): boolean {
  return isRefusedKey(error) || isCreditsError(error);
}

/** The Buddy API refused: the day's talk or tasks, or this period's pool, is spent. */
export function isBudgetExceeded(error: unknown): boolean {
  return /budget_exceeded|limit_exceeded|on_demand_required/.test(errorMessage(error)) || readBudget(error) !== null;
}

/** Map raw API/network errors to a short message with a clear next step. */
export function friendlyApiError(error: unknown): string {
  const raw = errorMessage(error);
  if (isBudgetExceeded(error)) {
    const refusal = readBudget(error);
    const account = knownAccount();
    return budgetSpentMessage({
      plan: refusal?.plan ?? account.plan,
      resetsAt: refusal?.resetsAt ?? account.periodEnd,
      billing: account.billing,
      meter: refusal?.meter,
      limit: refusal?.limit,
      onDemand: refusal?.onDemand,
    });
  }
  if (isCreditsError(error)) {
    return "Out of credits. You can top up that provider, or pick another under Settings → Providers.";
  }
  if (isRefusedKey(error)) {
    return "API key rejected. Open Settings and check your keys.";
  }
  if (/429|rate.?limit/i.test(raw)) {
    return "Rate limited. Wait a moment and try again.";
  }
  if (isNetworkError(error)) {
    return "Network error. Check your internet connection.";
  }
  return raw; // e.g. "key missing — open Settings", "no displays captured"
}

/**
 * Remember a dead key under Settings → Providers (the pages that rely on it
 * wear a red dot too) until the key is replaced or a Test succeeds. Nothing
 * is written for transient failures. Safe to call on every error.
 */
export function noteKeyFailure(provider: KeyProvider, error: unknown): void {
  // A refusal from the Buddy proxy (an expired session, a spent budget) says
  // nothing about a key the user never pasted.
  if (!isDeadKey(error) || !getApiKey(provider)) return;
  // Always called from a catch: a failure here must never replace the real error.
  try {
    const settings = getSettings();
    const text = keyWarningText(
      settings,
      provider,
      isCreditsError(error) ? "credits" : "refused",
    );
    if (settings.keyWarnings[provider] === text) return;
    updateSettings({
      keyWarnings: { ...settings.keyWarnings, [provider]: text },
    });
    broadcastSettings();
  } catch (failure) {
    log.warn(`could not record the key warning: ${errorMessage(failure)}`);
  }
}
