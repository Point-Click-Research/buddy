// API keys and app secrets: encrypted with safeStorage (Keychain-backed on
// macOS) and stored as base64. Decrypted values never leave the main process;
// renderers only ever learn whether a key is set.

import { safeStorage } from 'electron';
import type { KeyProvider, KeyStatus } from '../../shared/types';
import { getSettings, store, updateSettings, type AppSecretName } from './store';

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable; refusing to store the key in plain text.');
  }
  return safeStorage.encryptString(value.trim()).toString('base64');
}

function decrypt(encrypted: string): string {
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

// --- Brain and voice provider keys -------------------------------------------

/** Whether each API key is set. Safe to send to renderers. */
export function getKeyStatus(): KeyStatus {
  const secrets = store.get('secrets');
  return {
    openrouter: Boolean(secrets.openrouter),
    elevenlabs: Boolean(secrets.elevenlabs),
    jev: Boolean(secrets.jev),
  };
}

/** Main-process only. Never send the result over IPC. */
export function getApiKey(provider: KeyProvider): string | null {
  const encrypted = store.get('secrets')[provider];
  if (!encrypted) return null;
  return decrypt(encrypted);
}

export function setApiKey(provider: KeyProvider, value: string): void {
  store.set('secrets', { ...store.get('secrets'), [provider]: encrypt(value) });
  clearKeyWarning(provider);
}

export function clearApiKey(provider: KeyProvider): void {
  const secrets = { ...store.get('secrets') };
  delete secrets[provider];
  store.set('secrets', secrets);
  clearKeyWarning(provider);
}

/** Drop a stored key warning. No-op when that provider has none. */
export function clearKeyWarning(provider: KeyProvider): void {
  const warnings = getSettings().keyWarnings;
  if (!warnings[provider]) return;
  const next = { ...warnings };
  delete next[provider];
  updateSettings({ keyWarnings: next });
}

// --- App secrets (Composio, Shopify Catalog, the payment card) ---------------

export function getAppKeyStatus(): { composio: boolean; shopify: boolean } {
  const secrets = store.get('appSecrets') ?? {};
  return { composio: Boolean(secrets.composio), shopify: Boolean(secrets.shopify) };
}

export function getAppSecret(name: AppSecretName): string | null {
  const encrypted = (store.get('appSecrets') ?? {})[name];
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

/** Save an app secret; an empty value removes it. */
export function setAppSecret(name: AppSecretName, value: string): void {
  const current = store.get('appSecrets') ?? {};
  if (!value.trim()) {
    const next = { ...current };
    delete next[name];
    store.set('appSecrets', next);
    return;
  }
  store.set('appSecrets', { ...current, [name]: encrypt(value) });
}
