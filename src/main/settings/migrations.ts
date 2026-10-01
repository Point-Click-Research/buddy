// One-time reshapings of a stored settings object, run at launch before
// anything reads it. Each is idempotent: a store that already has the new
// shape is left alone. Add a new function here when a setting is renamed or
// folded into another, and call it from runMigrations in order.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CALL_STYLE, type BuyerProfile, type Settings, type ShopperProfile } from '../../shared/types';
import { chosenSettings, DEFAULT_SETTINGS } from './defaults';
import type { SettingsStore } from './store';

export function runMigrations(store: SettingsStore): void {
  skipOnboardingForExistingInstalls(store);
  renameClaudeModelKeys(store);
  brainsThroughOpenRouter(store);
  dropRyeCheckout(store);
  refreshShippedCallStyle(store);
  splitSpeechSwitchFromVoice(store);
  dictionaryToVocabulary(store);
  foldMemoryIntoShopperProfile(store);
  syncBuiltInSkills(store);
  dropOrphanKeyWarnings(store);
  dropClickSound(store);
  keepChoicesOnly(store);
}

/**
 * Older builds stored every setting, defaults included, so a default that
 * changed never reached anyone. Now only what differs from the defaults is
 * stored (see updateSettings); this brings an older store to that shape.
 */
function keepChoicesOnly(store: SettingsStore): void {
  store.set('settings', chosenSettings(store.get('settings')));
}

/** Click sounds were their own switch. The feature is gone, so the stored flag goes too. */
function dropClickSound(store: SettingsStore): void {
  const stored = store.get('settings') as Partial<Settings> & { clickSfxEnabled?: boolean };
  if (stored.clickSfxEnabled === undefined) return;
  delete stored.clickSfxEnabled;
  store.set('settings', stored);
}

/**
 * A key warning belongs to a key the user pasted. Older builds also pinned
 * one when Buddy's own key failed through the proxy, which left a warning on
 * an empty field that nothing could clear.
 */
function dropOrphanKeyWarnings(store: SettingsStore): void {
  const stored = store.get('settings');
  const warnings = stored.keyWarnings;
  if (!warnings) return;
  const secrets = store.get('secrets') as Record<string, string | undefined>;
  const kept = Object.fromEntries(Object.entries(warnings).filter(([provider]) => Boolean(secrets[provider])));
  if (Object.keys(kept).length === Object.keys(warnings).length) return;
  store.set('settings', { ...stored, keyWarnings: kept });
}

/**
 * The first-run walk arrived after people were already using Buddy. A store
 * with any settings in it belongs to one of them, and has nothing to walk through.
 */
function skipOnboardingForExistingInstalls(store: SettingsStore): void {
  const stored = store.get('settings');
  if (stored.onboardingDone !== undefined || Object.keys(stored).length === 0) return;
  store.set('settings', { ...stored, onboardingDone: true });
}

/** claudeModel/claudeFastModel became brainModel/brainFastModel when the brain grew OpenAI and OpenRouter support. */
function renameClaudeModelKeys(store: SettingsStore): void {
  const stored = store.get('settings') as Partial<Settings> & {
    claudeModel?: string;
    claudeFastModel?: string;
  };
  if (stored.claudeModel === undefined && stored.claudeFastModel === undefined) return;
  const { claudeModel, claudeFastModel, ...rest } = stored;
  store.set('settings', {
    ...rest,
    ...(claudeModel !== undefined ? { brainModel: claudeModel } : {}),
    ...(claudeFastModel !== undefined ? { brainFastModel: claudeFastModel } : {}),
  });
}

/**
 * Every cloud brain now runs through OpenRouter. A store on Anthropic or
 * OpenAI moves over with its model ids in OpenRouter's vendor/model form; the
 * per-model provider overrides go, since there is one cloud provider. The
 * old Anthropic and OpenAI keys are dropped from the keychain store.
 */
export function brainsThroughOpenRouter(store: SettingsStore): void {
  const stored = store.get('settings') as Omit<Partial<Settings>, 'brainProvider'> & {
    brainProvider?: string;
    brainFastProvider?: string;
    agentProvider?: string;
  };
  const secrets = store.get('secrets') as Record<string, string | undefined>;
  if ('anthropic' in secrets || 'openai' in secrets) {
    const { anthropic: _a, openai: _o, ...rest } = secrets;
    store.set('secrets', rest);
  }
  const provider = stored.brainProvider;
  const legacyBrain = provider === 'anthropic' || provider === 'openai';
  if (!legacyBrain && stored.brainFastProvider === undefined && stored.agentProvider === undefined) return;
  const { brainFastProvider, agentProvider, ...rest } = stored;
  const slug = (model: string | undefined, vendor: string | undefined): string | undefined =>
    model && vendor && !model.includes('/') ? `${vendor}/${model}` : model;
  const vendor = (name: string | undefined): string | undefined =>
    name === 'anthropic' || name === 'openai' ? name : undefined;
  store.set('settings', {
    ...rest,
    ...(legacyBrain
      ? {
          brainProvider: 'openrouter',
          brainModel: slug(rest.brainModel, provider) ?? DEFAULT_SETTINGS.brainModel,
          brainFastModel: slug(rest.brainFastModel, vendor(brainFastProvider) ?? provider),
          agentModel: slug(rest.agentModel, vendor(agentProvider) ?? provider),
        }
      : {}),
  });
}

/**
 * Rye checkout is gone. Drop its key and settings. A filled Rye buyer profile
 * becomes the shipping address when that form is still empty.
 */
function dropRyeCheckout(store: SettingsStore): void {
  const secrets = store.get('appSecrets') ?? {};
  if ('rye' in secrets) {
    const { rye: _rye, ...rest } = secrets;
    store.set('appSecrets', rest);
  }
  const stored = store.get('settings') as Partial<Settings> & {
    buyer?: BuyerProfile;
    ryeEnvironment?: string;
    ryePublishableKey?: string;
  };
  if (!stored.buyer && stored.ryeEnvironment === undefined && stored.ryePublishableKey === undefined) return;
  const { buyer, ryeEnvironment: _env, ryePublishableKey: _key, ...rest } = stored;
  const shippingEmpty = !rest.buddyShipping?.address1?.trim();
  store.set('settings', {
    ...rest,
    ...(shippingEmpty && buyer?.address1?.trim() ? { buddyShipping: buyer } : {}),
  });
}

/**
 * Refresh the shipped Bland calling-style default so a stored copy that still
 * matches an older release picks up the "report back when the call ends" line.
 */
function refreshShippedCallStyle(store: SettingsStore): void {
  const previousDefaults = [
    "Have the phone agent identify itself as an AI assistant calling on the user's behalf. Never speak passwords, one-time codes, card numbers, or government IDs — hand those steps back. Stay on the approved goal and end the call when it is done.",
    "Have the phone agent identify itself as an AI assistant calling on the user's behalf. Never speak passwords, one-time codes, card numbers, or government IDs; hand those steps back. Stay on the approved goal and end the call when it is done.",
  ];
  const stored = store.get('settings') as Partial<Settings>;
  if (stored.callStyle && previousDefaults.includes(stored.callStyle)) {
    store.set('settings', { ...stored, callStyle: DEFAULT_CALL_STYLE });
  }
}

/**
 * The "None (text only)" voice option became the "Speak responses out loud"
 * switch. A stored 'none' turns the switch off and leaves the free system
 * voice picked for when speech comes back on. Every other voice that has
 * since gone (the local Kokoro voice, Cartesia, OpenAI, OpenRouter) becomes
 * the macOS voice, the free option each stood in for.
 */
function splitSpeechSwitchFromVoice(store: SettingsStore): void {
  const stored = store.get('settings') as Omit<Partial<Settings>, 'ttsProvider'> & { ttsProvider?: string };
  if (stored.ttsProvider === 'none') {
    store.set('settings', { ...stored, ttsProvider: 'system', speechEnabled: false });
  } else if (stored.ttsProvider !== undefined && stored.ttsProvider !== 'elevenlabs' && stored.ttsProvider !== 'system') {
    store.set('settings', { ...stored, ttsProvider: 'system' });
  }
}

/**
 * The flat `dictionary` word list became `vocabulary` entries (word +
 * optional mishearing). Old words carry over as bias-only entries.
 */
function dictionaryToVocabulary(store: SettingsStore): void {
  const stored = store.get('settings') as Partial<Settings> & { dictionary?: unknown };
  if (!Array.isArray(stored.dictionary)) return;
  const carried = stored.dictionary
    .filter((word): word is string => typeof word === 'string' && word.trim().length > 0)
    .map((word) => ({ word: word.trim(), heard: '' }));
  delete stored.dictionary;
  store.set('settings', { ...stored, vocabulary: [...(stored.vocabulary ?? []), ...carried] });
}

/**
 * The separate memory store and the About me text folded into the user's own
 * shopper profile, so Settings → Memory is one list per person. Old memories
 * become general rows, About me lines become form facts.
 */
function foldMemoryIntoShopperProfile(store: SettingsStore): void {
  const stored = store.get('settings') as Partial<Settings> & { aboutMe?: string };
  const legacyPath = join(app.getPath('userData'), 'memory.json');
  const memories: string[] = existsSync(legacyPath)
    ? ((JSON.parse(readFileSync(legacyPath, 'utf8')) as { entries?: Array<{ text?: string }> }).entries?.map(
        (entry) => String(entry.text ?? '').trim(),
      ) ?? [])
    : [];
  if (memories.length === 0 && stored.aboutMe === undefined) return;
  const { aboutMe = '', ...rest } = stored;
  const facts = aboutMe.split('\n').map((line) => line.trim()).filter(Boolean);
  const [owner = DEFAULT_SETTINGS.shoppers[0]!, ...others] = rest.shoppers ?? [];
  const merged: ShopperProfile = {
    ...owner,
    formFacts: [...new Set([...owner.formFacts, ...facts])],
    general: [...new Set([...owner.general, ...memories.filter(Boolean)])],
  };
  store.set('settings', { ...rest, shoppers: [merged, ...others] });
  rmSync(legacyPath, { force: true });
}

/**
 * Skills that ship with Buddy are always in the list: a stored skills array
 * shadows DEFAULT_SETTINGS.skills entirely, so any missing built-in is
 * appended, and stored copies are re-synced with the binary's builtIn flag
 * and apps/sites matching keys. Instructions belong to whoever wrote them
 * last: `shippedSkills` remembers the text each built-in shipped with, so a
 * stored copy that still reads exactly like the old release is refreshed to
 * the new text, while one the user edited survives untouched. (A store from
 * before this baseline existed is treated as unedited, once.) The disabled
 * flag is always the user's, and the UI offers disable instead of delete.
 */
function syncBuiltInSkills(store: SettingsStore): void {
  const stored = store.get('settings');
  const baseline = store.get('shippedSkills');
  if (Array.isArray(stored.skills)) {
    const shipped = new Map(DEFAULT_SETTINGS.skills.map((skill) => [skill.name.toLowerCase(), skill]));
    const have = new Set(stored.skills.map((skill) => skill.name.toLowerCase()));
    const synced = stored.skills.map((skill) => {
      const key = skill.name.toLowerCase();
      const match = shipped.get(key);
      if (!match) return skill;
      const edited = key in baseline && skill.instructions !== baseline[key];
      return {
        ...skill,
        builtIn: true,
        instructions: edited ? skill.instructions : match.instructions,
        ...(match.apps ? { apps: match.apps } : {}),
        ...(match.sites ? { sites: match.sites } : {}),
      };
    });
    const additions = DEFAULT_SETTINGS.skills.filter((skill) => !have.has(skill.name.toLowerCase()));
    const next = [...synced, ...additions];
    if (JSON.stringify(next) !== JSON.stringify(stored.skills)) {
      store.set('settings', { ...stored, skills: next });
    }
  }
  // The baseline for next launch is always this binary's shipped text.
  store.set(
    'shippedSkills',
    Object.fromEntries(DEFAULT_SETTINGS.skills.map((skill) => [skill.name.toLowerCase(), skill.instructions])),
  );
}
