// Which key a provider call uses: the user's own, or Buddy's through the
// API. A pasted key wins on Pro (and in a build with no account service),
// and routes around the proxy. On the Free plan it is ignored and Buddy's
// keys are used. A signed-in user gets Buddy's as their session token where
// the SDK expects a key and the API's route as the base URL.

import { PROXY_PATHS, type ProxiedProvider } from '../../shared/contracts';
import type { KeyProvider } from '../../shared/types';
import { getApiKey } from '../settings';
import { managedProviders } from './api';
import { ACCOUNT, accountConfigured } from './config';
import { accessToken, currentSession } from './session';

export type { ProxiedProvider };

/** What the API calls each key it holds; the desktop's names for the same things. */
type ManagedName = KeyProvider | 'exa' | 'composio' | 'bland';

export interface ProviderCredentials {
  apiKey: string;
  /** Unset for the user's own key: the SDK's default host. */
  baseURL?: string;
}

/**
 * A build with an account service does nothing for someone who is not
 * signed in, own keys included. A build without one (open source, your own
 * keys) never asks.
 */
export function signInRequired(): boolean {
  return accountConfigured() && currentSession() === null;
}

export const SIGN_IN_MESSAGE = 'Sign in to use Buddy: open the Buddy window, or Settings → Account.';

/** Buddy's keys can serve this provider right now, for readiness checks that must not await. */
export function managedReady(provider: ManagedName): boolean {
  return managedProviders().includes(provider);
}

/** A user key or Buddy's keys can serve this provider, and the user is signed in where that is required. */
export function providerReady(provider: KeyProvider): boolean {
  if (signInRequired()) return false;
  return Boolean(getApiKey(provider)) || managedReady(provider);
}

/** What to build the provider's SDK client with; null when nothing can serve it. */
export async function credentials(provider: ProxiedProvider): Promise<ProviderCredentials | null> {
  if (signInRequired()) return null;
  const own = getApiKey(provider);
  if (own) return { apiKey: own };
  return managedCredentials(provider);
}

/** Buddy's key for this provider, skipping a pasted personal key. */
export async function managedCredentials(provider: ProxiedProvider): Promise<ProviderCredentials | null> {
  if (signInRequired() || !managedReady(provider)) return null;
  const token = await accessToken();
  return token ? { apiKey: token, baseURL: `${ACCOUNT.apiUrl}${PROXY_PATHS[provider]}` } : null;
}
