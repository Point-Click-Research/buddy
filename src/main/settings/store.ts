// The one place settings are read from and written to disk. Non-secret
// settings live in electron-store as plain JSON; secrets sit alongside as
// encrypted base64 (see secrets.ts). Migrations run once, here, before
// anything reads.

import Store from 'electron-store';
import type { KeyProvider, Settings } from '../../shared/types';
import { chosenSettings, DEFAULT_SETTINGS } from './defaults';
import { runMigrations } from './migrations';
import { sanitizeSettingsPatch } from './sanitize';

export type AppSecretName = 'composio' | 'shopify' | 'card' | 'account';

interface StoreShape {
  settings: Partial<Settings>;
  secrets: Partial<Record<KeyProvider, string>>; // base64 of encrypted bytes
  /** Composio and Shopify Catalog keys. Same keychain encryption, not brain providers. */
  appSecrets: Partial<Record<AppSecretName, string>>;
  /** What each built-in skill's instructions were when this store last saw a launch (lowercased name → text). */
  shippedSkills: Record<string, string>;
}

export type SettingsStore = Store<StoreShape>;

export const store: SettingsStore = new Store<StoreShape>({
  defaults: { settings: {}, secrets: {}, appSecrets: {}, shippedSkills: {} },
});

runMigrations(store);

export function getSettings(): Settings {
  // Merge over defaults so new settings added in updates get sane values.
  return { ...DEFAULT_SETTINGS, ...store.get('settings') };
}

/** Merge a patch into the stored settings. Unknown keys and junk values are dropped, not stored. */
export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...sanitizeSettingsPatch(patch, current) };
  store.set('settings', chosenSettings(next));
  return next;
}
