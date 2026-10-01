// Settings, as the rest of main sees them. The folder:
//
//   defaults.ts    every setting's value until the user changes it
//   store.ts       read, write, and the electron-store behind both
//   migrations.ts  one-time reshapings of an older stored settings object
//   sanitize.ts    what a renderer's patch may and may not store
//   secrets.ts     API keys and app secrets, encrypted
//
// This file adds the derived views other modules ask for: enabled skills,
// the text the prompts advertise them with, the user's checkout details.

import { randomUUID } from 'node:crypto';
import {
  BUILTIN_TOOLS,
  findShopper,
  isSelfReference,
  type BuyerProfile,
  type ShopperCategory,
  type ShopperProfile,
  type WritingSkill,
} from '../../shared/types';
import { emptyShopper } from './defaults';
import { getSettings, updateSettings } from './store';

export { DEFAULT_SETTINGS } from './defaults';
export {
  clearApiKey,
  clearKeyWarning,
  getApiKey,
  getAppKeyStatus,
  getAppSecret,
  getKeyStatus,
  setApiKey,
  setAppSecret,
} from './secrets';
export { getSettings, updateSettings, type AppSecretName } from './store';

/** The skills the model may see and load; disabled ones stay out entirely. */
export function enabledSkills(): WritingSkill[] {
  return getSettings().skills.filter((skill) => !skill.disabled);
}

/**
 * The skill lines the prompts advertise: each quoted name with the skill's
 * first sentence as its trigger. A bare name is too little to match against
 * — "find me something funny on Amazon" never routed to a skill called just
 * "Shopping" — and the format's convention is that a skill opens with when
 * it applies. App-matched skills (apps/sites) load themselves when their
 * app is frontmost, so listing them would only invite wrong get_skill
 * guesses on generic asks ("how do I share this").
 */
export function loadableSkillNames(): string[] {
  return enabledSkills()
    .filter((skill) => !skill.apps?.length && !skill.sites?.length)
    .map((skill) => `"${skill.name}" (${firstSentence(skill.instructions)})`);
}

/** The first sentence, whitespace collapsed and capped — a hint, not the skill. */
function firstSentence(instructions: string): string {
  const text = instructions.trim().replace(/\s+/g, ' ');
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

/** The registry names of every built-in tool the user switched off in Settings → Tools. */
export function disabledBuiltinToolNames(): Set<string> {
  const off = new Set(getSettings().disabledBuiltinTools);
  return new Set(BUILTIN_TOOLS.filter((tool) => off.has(tool.id)).flatMap((tool) => tool.toolNames));
}

/** One id for this Mac's Composio connections. Created the first time it is needed. */
export function composioUserId(): string {
  const existing = getSettings().composioUserId.trim();
  if (existing) return existing;
  const id = randomUUID();
  updateSettings({ composioUserId: id });
  return id;
}

// --- Shopper profiles (Settings → Memory) -------------------------------------

/**
 * Append one remembered fact to a shopper's category table — the write path
 * behind save_memory's shopper routing. An unknown name becomes a new
 * profile ("this is Marcus" mid-conversation); a fact the table already has
 * is left alone. Sanitizing (caps, the card-number guard) applies on save.
 */
export function addShopperEntry(name: string, category: ShopperCategory, text: string): void {
  const entry = text.trim();
  if (!entry) throw new Error('The fact was empty.');
  if (!name.trim()) throw new Error('The shopper name was empty.');
  const shoppers = [...getSettings().shoppers];
  // "me" (and friends) is always the first profile, whatever it is named —
  // the model may know the user's real name while the profile says "Me".
  const index = isSelfReference(name) && shoppers.length > 0 ? 0 : findShopper(shoppers, name);
  if (index === -1) {
    shoppers.push({ ...emptyShopper(name.trim()), [category]: [entry] });
  } else {
    const shopper = shoppers[index]!;
    if (shopper[category].some((row) => row.toLowerCase() === entry.toLowerCase())) return;
    shoppers[index] = { ...shopper, [category]: [...shopper[category], entry] };
  }
  updateSettings({ shoppers });
}

/**
 * What get_about_me hands the model for forms: the user's own details, then
 * each person they shop for ("ship it to my girlfriend"). Empty when nothing
 * is saved. Sizes and tastes stay out; those ride in the prompt already.
 */
export function aboutMeText(): string {
  const settings = getSettings();
  const [owner, ...others] = settings.shoppers;
  const details = (shopper: ShopperProfile): string => [...shopper.formFacts, ...shopper.general].join('; ');
  const people = others
    .filter((shopper) => shopper.name.trim() && details(shopper))
    .map((shopper) => `${shopper.name.trim()}: ${details(shopper)}`);
  // Structured checkout addresses (Purchase → Buy with Buddy):
  // an address without a street is not fillable, so it stays out entirely.
  const shipping = settings.buddyShipping.address1.trim()
    ? `Shipping address for orders: ${addressLine(settings.buddyShipping)}`
    : '';
  const billing = settings.buddyBilling.address1.trim()
    ? `Billing address: ${addressLine(settings.buddyBilling)}`
    : shipping
      ? 'Billing address: same as shipping.'
      : '';
  return [
    owner && details(owner) ? `The user: ${details(owner)}` : '',
    [shipping, billing].filter(Boolean).join('\n'),
    people.length > 0
      ? `People the user shops for — their details, for forms addressed to them:\n${people.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** One line of a checkout profile's filled fields, ready to type into a form. */
function addressLine(profile: BuyerProfile): string {
  return [
    `${profile.firstName} ${profile.lastName}`.trim(),
    profile.address1,
    profile.city,
    [profile.province, profile.postalCode].filter(Boolean).join(' '),
    profile.phone,
    profile.email,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}
