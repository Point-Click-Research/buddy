// Where a stored API-key warning should send the user depends on which
// settings pages actually use that provider right now.

import type { KeyProvider, Settings } from './types';

export type KeyWarningKind = 'credits' | 'refused';

export function keyWarningKind(stored: string): KeyWarningKind {
  return /quota|credit/i.test(stored) ? 'credits' : 'refused';
}

/** User-facing warning for a provider, with the right Settings pages named. */
export function keyWarningText(
  settings: Settings,
  provider: KeyProvider,
  kind: KeyWarningKind,
): string {
  const pages = settingsPagesLabel(settings, provider);
  const suffix = pages ? ` under ${pages}` : '';
  if (kind === 'credits') {
    return `Out of credits. Top up the account, or pick another provider${suffix}.`;
  }
  return `This key was refused. Check it, or pick another provider${suffix}.`;
}

/** Turn the persisted warning into copy that matches today's settings. */
export function keyWarningDisplay(
  settings: Settings,
  provider: KeyProvider,
  stored?: string,
): string | undefined {
  if (!stored) return undefined;
  return keyWarningText(settings, provider, keyWarningKind(stored));
}

/**
 * Settings pages whose active provider has a stored key warning — Providers
 * itself whenever any warning exists, plus each page currently relying on a
 * warned provider. Drives the sidebar's red dots, on the same page mapping
 * the warning copy uses.
 */
export function pagesWithKeyWarning(settings: Settings): Set<'providers' | 'voice' | 'brain'> {
  const pages = new Set<'providers' | 'voice' | 'brain'>();
  for (const provider of Object.keys(settings.keyWarnings) as KeyProvider[]) {
    pages.add('providers');
    if (usesProviderForVoice(settings, provider)) pages.add('voice');
    if (usesProviderForBrain(settings, provider)) pages.add('brain');
  }
  return pages;
}

function settingsPagesLabel(settings: Settings, provider: KeyProvider): string {
  const parts: string[] = [];
  if (usesProviderForVoice(settings, provider)) parts.push('Voice');
  if (usesProviderForBrain(settings, provider)) parts.push('Brain');
  if (parts.length > 0) return parts.join(' and ');
  return defaultPagesForProvider(provider);
}

function usesProviderForVoice(settings: Settings, provider: KeyProvider): boolean {
  return provider === 'elevenlabs' && settings.ttsProvider === provider;
}

function usesProviderForBrain(settings: Settings, provider: KeyProvider): boolean {
  return provider === 'openrouter' && settings.brainProvider === provider;
}

function defaultPagesForProvider(provider: KeyProvider): string {
  switch (provider) {
    case 'elevenlabs':
      return 'Voice';
    case 'openrouter':
      return 'Brain';
    // Jev powers no settings page beyond Providers itself; the fast
    // decisions it makes (routing, element picks) fall back to going without.
    case 'jev':
      return '';
  }
}
