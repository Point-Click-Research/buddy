// Memory, checkout, skills the user wrote, and the thinking model belong to
// the signed-in account. They used to live in the one settings file on this
// Mac, so a new sign-in kept the previous account's.

import Store from 'electron-store';
import type { Settings } from '../../shared/types';
import { broadcastSettings } from '../settings-view';
import { DEFAULT_SETTINGS, emptyShopper, EMPTY_BUYER } from '../settings/defaults';
import { getSettings, store as settingsStore, updateSettings } from '../settings/store';
import { decideLegacyPersonal, type LegacyPersonalDecision } from './personal-split';
import { legacyBelongsToAccount } from './scope';

interface PersonalSlice {
  shoppers: Settings['shoppers'];
  buddyShipping: Settings['buddyShipping'];
  buddyBilling: Settings['buddyBilling'];
  trustedMerchants: Settings['trustedMerchants'];
  skills: Settings['skills'];
  brainProvider: Settings['brainProvider'];
  brainModel: string;
  brainFastModel: string;
  brainEffort: Settings['brainEffort'];
  ollamaModel: string;
  composioUserId: string;
  /** The encrypted card blob, or '' when this account has no card. */
  card: string;
}

interface PersonalFile {
  byUser: Record<string, PersonalSlice>;
  parked: PersonalSlice | null;
  /** When the history behind the parked slice began, so it is only handed to an account old enough to own it. Null: parked before this was recorded. */
  parkedOldest: number | null;
  /** Accounts that must not be handed the parked slice: it was on screen for them and it was not theirs. */
  denied: string[];
  settled: boolean;
  /** Whose slice the settings file holds. It outlives a quit, and is newer than their saved slice. */
  shown: string;
}

const file = new Store<PersonalFile>({
  name: 'account-personal',
  defaults: { byUser: {}, parked: null, parkedOldest: null, denied: [], settled: false, shown: '' },
});

/** Save whoever is on screen, then show this account's own slice. A first sign-in gets a clean one. */
export function switchPersonal(
  id: string,
  createdAt: number | null,
  others: readonly string[],
  foreignHistory: boolean,
  legacyOldest: number | null,
): 'kept' | 'cleaned' {
  const shown = file.get('shown');
  if (shown === id) {
    remember(id);
    return 'kept';
  }
  if (shown) remember(shown);
  const result = showPersonal(id, createdAt, others, foreignHistory, legacyOldest);
  file.set('shown', id);
  return result;
}

function showPersonal(
  id: string,
  createdAt: number | null,
  others: readonly string[],
  foreignHistory: boolean,
  legacyOldest: number | null,
): 'kept' | 'cleaned' {
  const saved = file.get('byUser')[id];
  if (saved) {
    restore(saved);
    return 'kept';
  }
  if (!file.get('settled')) {
    const decision = decideLegacyPersonal(others, foreignHistory);
    settleLegacy(id, decision, legacyOldest);
    return decision.kind === 'self' ? 'kept' : 'cleaned';
  }
  // The parked slice waits for its owner: an account that existed when its
  // history was written. A newer sign-up (a brand-new account made on this
  // Mac) cannot own it and starts clean.
  const parked = file.get('parked');
  if (parked && !file.get('denied').includes(id) && legacyBelongsToAccount(file.get('parkedOldest'), createdAt)) {
    restore(parked);
    file.set('parked', null);
    remember(id);
    return 'kept';
  }
  clean();
  remember(id);
  return 'cleaned';
}

/** The model was just fitted to the plan. Keep that in this account's slice so the next launch restores it. */
export function resnapshotPersonal(id: string): void {
  if (!file.get('byUser')[id]) return;
  remember(id);
}

/** The account signing out keeps what is on screen now. */
export function stashPersonal(id: string): void {
  remember(id);
}

function settleLegacy(id: string, decision: LegacyPersonalDecision, legacyOldest: number | null): void {
  if (decision.kind === 'self') {
    remember(id);
  } else if (decision.kind === 'give') {
    remember(decision.id);
    clean();
    remember(id);
  } else {
    file.set('parked', readSlice());
    // Without dated history, the parking moment is the bound: the owner signed up before now.
    file.set('parkedOldest', legacyOldest ?? Date.now());
    file.set('denied', [...file.get('denied'), id]);
    clean();
    remember(id);
  }
  file.set('settled', true);
}

function remember(id: string): void {
  file.set('byUser', { ...file.get('byUser'), [id]: readSlice() });
}

function readSlice(): PersonalSlice {
  const settings = getSettings();
  return {
    shoppers: settings.shoppers,
    buddyShipping: settings.buddyShipping,
    buddyBilling: settings.buddyBilling,
    trustedMerchants: settings.trustedMerchants,
    skills: settings.skills,
    brainProvider: settings.brainProvider,
    brainModel: settings.brainModel,
    brainFastModel: settings.brainFastModel,
    brainEffort: settings.brainEffort,
    ollamaModel: settings.ollamaModel,
    composioUserId: settings.composioUserId,
    card: settingsStore.get('appSecrets')?.card ?? '',
  };
}

function restore(slice: PersonalSlice): void {
  const { card, ...settings } = slice;
  updateSettings(settings);
  writeCard(card);
  broadcastSettings();
}

/** A new account: no one else's memory, card, skills, or model. The story they just told stays. */
function clean(): void {
  const settings = getSettings();
  const shopper = emptyShopper(settings.shoppers[0]?.name.trim() || 'Me');
  const story = settings.onboardingStory.trim();
  if (settings.onboardingStorySaved && story) shopper.general = [story];
  updateSettings({
    shoppers: [shopper],
    buddyShipping: { ...EMPTY_BUYER },
    buddyBilling: { ...EMPTY_BUYER },
    trustedMerchants: [],
    skills: DEFAULT_SETTINGS.skills.map((skill) => ({ ...skill })),
    brainProvider: DEFAULT_SETTINGS.brainProvider,
    brainModel: DEFAULT_SETTINGS.brainModel,
    brainFastModel: DEFAULT_SETTINGS.brainFastModel,
    brainEffort: DEFAULT_SETTINGS.brainEffort,
    ollamaModel: '',
    composioUserId: '',
  });
  writeCard('');
  broadcastSettings();
}

function writeCard(blob: string): void {
  const current = { ...(settingsStore.get('appSecrets') ?? {}) };
  if (!blob) delete current.card;
  else current.card = blob;
  settingsStore.set('appSecrets', current);
}
