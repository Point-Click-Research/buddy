// Settings patches arrive from renderers over IPC, so nothing in them is
// trusted: unknown keys are dropped, enum fields must hold a known value,
// and every list is rebuilt from clean strings. Values that feed straight
// into overlay CSS or a permission boundary (colors, the coding workspace,
// the global chords) are the ones this guards hardest.

import { isAbsolute } from 'node:path';
import { isOverlayColor, OVERLAY_COLORS } from '../../shared/color';
import { chordError, formatChord, parseChord } from '../../shared/hotkeys';
import { isProductBrowse } from '../../shared/product-browse';
import { isSuggestionTimeId } from '../../shared/suggestions';
import {
  APPEARANCES,
  BRAIN_EFFORTS,
  BRAIN_PROVIDERS,
  BUILTIN_TOOLS,
  QUICK_ASK_TRIGGERS,
  SHOPPER_CATEGORIES,
  IDEAS_COUNT,
  SPEECH_WPM,
  type BuyerProfile,
  type KeyProvider,
  type Settings,
  type ShopperProfile,
  type WritingSkill,
} from '../../shared/types';
import { looksLikeCardNumber } from '../about-me';
import { DEFAULT_SETTINGS, emptyShopper } from './defaults';

/** A patch mid-sanitizing: known keys only, values not yet trusted. */
type Patch = Record<string, unknown>;

const BUBBLE_LOCATIONS = ['cursor', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
const KEY_PROVIDERS: KeyProvider[] = ['openrouter', 'elevenlabs', 'jev'];
const EFFORTS = BRAIN_EFFORTS.map((option) => option.value);

/**
 * The patch with everything a renderer must not be allowed to store removed
 * or repaired. `current` is what is stored now, for rules that span fields
 * (chord collisions) or need what already exists (built-in skills).
 */
export function sanitizeSettingsPatch(patch: Partial<Settings>, current: Settings): Partial<Settings> {
  // Only accept known keys, so a buggy renderer can't grow the store.
  const clean: Patch = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in patch) clean[key] = patch[key as keyof Settings];
  }

  keepOneOf(clean, 'bubbleLocation', BUBBLE_LOCATIONS);
  keepOneOf(clean, 'appearance', APPEARANCES);
  keepOneOf(clean, 'brainProvider', Object.keys(BRAIN_PROVIDERS));
  keepOneOf(clean, 'brainEffort', EFFORTS);
  keepOneOf(clean, 'agentEffort', EFFORTS);
  keepOneOf(clean, 'ttsProvider', ['elevenlabs', 'system']);
  keepOneOf(clean, 'runCommandApproval', ['always', 'risky']);
  keepOneOf(clean, 'codingEditApproval', ['always', 'risky', 'auto']);
  keepOneOf(clean, 'quickAskTrigger', QUICK_ASK_TRIGGERS);
  keepIf(clean, 'productBrowse', isProductBrowse);
  keepIf(clean, 'ideasTime', isSuggestionTimeId);
  keepIf(clean, 'textBridgeHandle', (value) => typeof value === 'string' && value.length <= 80);
  keepIf(clean, 'onboardingStep', (value) => typeof value === 'string' && value.length <= 24);
  keepIf(clean, 'onboardingStory', (value) => typeof value === 'string' && value.length <= 8000);
  keepIf(clean, 'onboardingStorySaved', (value) => typeof value === 'boolean');
  keepIf(clean, 'browserLoginsFrom', (value) => typeof value === 'string' && value.length <= 60);
  // Renderer values feed straight into overlay CSS, so junk is dropped here.
  for (const { key } of OVERLAY_COLORS) keepIf(clean, key, (value) => isOverlayColor(String(value)));

  sanitizeWorkspaceRoot(clean);
  sanitizeChords(clean, current);
  sanitizeDisabledTools(clean);
  clampWhole(clean, 'speechWpm', SPEECH_WPM);
  clampWhole(clean, 'ideasCount', IDEAS_COUNT);
  sanitizeBuyer(clean, 'buddyShipping');
  sanitizeBuyer(clean, 'buddyBilling');
  sanitizeShoppers(clean);
  sanitizeTrustedMerchants(clean);
  sanitizeVocabulary(clean);
  sanitizePronunciations(clean);
  sanitizeSkills(clean, current);
  sanitizeKeyWarnings(clean);
  return clean as Partial<Settings>;
}

/** Drop `key` unless its value passes `accept`. Keys not in the patch are left alone. */
function keepIf(clean: Patch, key: string, accept: (value: unknown) => boolean): void {
  if (key in clean && !accept(clean[key])) delete clean[key];
}

/** Drop `key` unless its value is one of `allowed`. */
function keepOneOf(clean: Patch, key: string, allowed: readonly string[]): void {
  keepIf(clean, key, (value) => allowed.includes(value as string));
}

/**
 * The coding workspace is the coding tools' entire permission boundary:
 * only an absolute path (or '', switching them off) may be stored.
 */
function sanitizeWorkspaceRoot(clean: Patch): void {
  if (!('codingWorkspaceRoot' in clean)) return;
  const root = String(clean.codingWorkspaceRoot ?? '').trim();
  if (root === '' || isAbsolute(root)) clean.codingWorkspaceRoot = root;
  else delete clean.codingWorkspaceRoot;
}

const CHORD_KEYS = ['hotkey', 'agentHotkey', 'alwaysOnHotkey', 'quickAskHotkey'] as const;
type ChordKey = (typeof CHORD_KEYS)[number];

/**
 * The global chords come from the preset menus, but a buggy renderer must
 * not store one the listener can't hold. Each is canonicalized or dropped,
 * and a chord that collides with one of the other three is dropped too.
 */
function sanitizeChords(clean: Patch, current: Settings): void {
  // Press-once chords need an ordinary key alongside the modifiers, and
  // may be '' (switched off); hold chords may be modifiers alone.
  const pressOnce = (key: ChordKey): boolean => key === 'alwaysOnHotkey' || key === 'quickAskHotkey';
  const canonical = (key: ChordKey): string | null => {
    const text = String(clean[key] ?? '');
    if (pressOnce(key) && text === '') return ''; // toggle off
    const invalid = chordError(text, { requireKey: pressOnce(key) });
    const parsed = parseChord(text);
    if (invalid || !parsed) return null;
    return formatChord(parsed);
  };
  for (const key of CHORD_KEYS) {
    if (!(key in clean)) continue;
    const value = canonical(key);
    if (value === null) delete clean[key];
    else clean[key] = value;
  }
  const effective = CHORD_KEYS.map((key) => (clean[key] as string) ?? current[key]).filter(Boolean);
  if (new Set(effective).size !== effective.length) {
    for (const key of CHORD_KEYS) delete clean[key];
  }
}

function sanitizeDisabledTools(clean: Patch): void {
  if (!('disabledBuiltinTools' in clean)) return;
  const known = new Set(BUILTIN_TOOLS.map((tool) => tool.id));
  clean.disabledBuiltinTools = Array.isArray(clean.disabledBuiltinTools)
    ? clean.disabledBuiltinTools.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [];
}

/** A whole-number setting, held to its range; anything unreadable is dropped. */
function clampWhole(clean: Patch, key: 'speechWpm' | 'ideasCount', range: { min: number; max: number }): void {
  if (!(key in clean)) return;
  const value = Number(clean[key]);
  if (Number.isFinite(value)) clean[key] = Math.min(range.max, Math.max(range.min, Math.round(value)));
  else delete clean[key];
}

/**
 * Saved per keystroke, so cap only: trimming here eats the space the user
 * just typed between "New" and "York". Readers trim.
 */
function sanitizeBuyer(clean: Patch, key: 'buddyShipping' | 'buddyBilling'): void {
  if (!clean[key] || typeof clean[key] !== 'object') return;
  const src = clean[key] as Record<string, unknown>;
  const text = (field: keyof BuyerProfile): string => String(src[field] ?? '').slice(0, 80);
  clean[key] = {
    firstName: text('firstName'),
    lastName: text('lastName'),
    email: text('email'),
    phone: text('phone'),
    address1: text('address1'),
    city: text('city'),
    province: text('province'),
    postalCode: text('postalCode'),
  } satisfies BuyerProfile;
}

/**
 * Shopper profiles: category entries are committed rows (trim is safe),
 * names save per keystroke (cap only, no trim — trimming fights the caret).
 */
function sanitizeShoppers(clean: Patch): void {
  if (!Array.isArray(clean.shoppers)) return;
  const entries = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry ?? '').trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 40);
  const shoppers: ShopperProfile[] = clean.shoppers
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const src = entry as Partial<Record<keyof ShopperProfile, unknown>>;
      return {
        name: String(src.name ?? '').slice(0, 80),
        products: entries(src.products),
        travel: entries(src.travel),
        dining: entries(src.dining),
        formFacts: entries(src.formFacts),
        general: entries(src.general),
      };
    })
    .slice(0, 12);
  const everything = shoppers
    .flatMap((shopper) => [shopper.name, ...SHOPPER_CATEGORIES.flatMap(({ key }) => shopper[key])])
    .join('\n');
  if (looksLikeCardNumber(everything)) {
    throw new Error('That looks like a payment card number. Those must not be stored in Memory.');
  }
  // The first profile is always the user themselves; the list never empties.
  if (shoppers.length === 0) shoppers.push(emptyShopper('Me'));
  clean.shoppers = shoppers;
}

/** Hosts fill_payment trusts: lowercase registrable domains, deduped. */
function sanitizeTrustedMerchants(clean: Patch): void {
  if (!('trustedMerchants' in clean)) return;
  const hosts = Array.isArray(clean.trustedMerchants) ? clean.trustedMerchants : [];
  clean.trustedMerchants = [
    ...new Set(hosts.map((host) => String(host ?? '').trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 200);
}

function sanitizeVocabulary(clean: Patch): void {
  if (!Array.isArray(clean.vocabulary)) return;
  clean.vocabulary = clean.vocabulary
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const item = entry as { word?: unknown; heard?: unknown };
      return { word: String(item.word ?? '').trim(), heard: String(item.heard ?? '').trim() };
    })
    .filter((entry) => entry.word.length >= 2 && entry.word.length <= 40);
}

function sanitizePronunciations(clean: Patch): void {
  if (!Array.isArray(clean.pronunciations)) return;
  clean.pronunciations = clean.pronunciations
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => {
      const entry = rule as { text?: unknown; spoken?: unknown };
      return { text: String(entry.text ?? '').trim(), spoken: String(entry.spoken ?? '').trim() };
    })
    .filter((rule) => rule.text && rule.spoken);
}

/**
 * Built-in status comes from the store, never the renderer: a shipped skill
 * can be edited or disabled but not deleted, renamed, or forged.
 */
function sanitizeSkills(clean: Patch, current: Settings): void {
  if (!Array.isArray(clean.skills)) return;
  const shipped = new Map(
    current.skills.filter((skill) => skill.builtIn).map((skill) => [skill.name.toLowerCase(), skill]),
  );
  const skills: WritingSkill[] = clean.skills
    .filter((skill) => skill && typeof skill === 'object')
    .map((skill) => {
      const entry = skill as { name?: unknown; instructions?: unknown; disabled?: unknown };
      const name = String(entry.name ?? '').trim();
      const match = shipped.get(name.toLowerCase());
      return {
        name,
        instructions: String(entry.instructions ?? '').trim(),
        ...(match ? { builtIn: true } : {}),
        ...(match?.apps ? { apps: match.apps } : {}),
        ...(match?.sites ? { sites: match.sites } : {}),
        ...(entry.disabled === true ? { disabled: true } : {}),
      };
    })
    .filter((skill) => skill.name);
  const present = new Set(skills.map((skill) => skill.name.toLowerCase()));
  for (const [key, skill] of shipped) {
    if (!present.has(key)) skills.push(skill);
  }
  clean.skills = skills;
}

function sanitizeKeyWarnings(clean: Patch): void {
  if (!('keyWarnings' in clean)) return;
  const src =
    clean.keyWarnings && typeof clean.keyWarnings === 'object' ? (clean.keyWarnings as Record<string, unknown>) : {};
  const next: Partial<Record<KeyProvider, string>> = {};
  for (const id of KEY_PROVIDERS) {
    const text = typeof src[id] === 'string' ? src[id].trim() : '';
    if (text) next[id] = text;
  }
  clean.keyWarnings = next;
}
