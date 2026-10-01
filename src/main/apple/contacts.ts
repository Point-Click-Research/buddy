// The find_contact tool: look a person up in the Mac's Contacts natively.
// Three ways in: a name finds their numbers and emails, a number finds the
// name, a company finds who works there. Numbers are stored formatted
// ("1-203-451-3833"), so the reverse lookup compares digits only, and by
// suffix — the same person matches with or without a country code. A full
// name that misses retries word by word, because spoken names arrive
// misspelled ("Dylan Babs" still finds Dylan Babbs through "Dylan").

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { jxaErrorMessage, runJxa } from './jxa';

const log = createLogger('contacts');

const TIMEOUT_MS = 15_000;
const MAX_MATCHES = 8;
/** Fewer digits than a local number can't identify anyone. */
const MIN_PHONE_DIGITS = 7;
/** Name words shorter than this ("de", "Jr") match half the address book. */
const MIN_TOKEN_CHARS = 3;

const FIND_CONTACT: Tool = {
  name: 'find_contact',
  description:
    "Look people up in the Mac's Contacts, one call — never a proposed task. Give name for " +
    'their numbers and emails (partial names match, and a missed full name retries word by ' +
    'word), phone to find who a number belongs to (any formatting, country code optional), or ' +
    'company to find who works somewhere. Give one.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name, or part of it.' },
      phone: { type: 'string', description: 'A phone number to identify.' },
      company: { type: 'string', description: 'A company or organization name.' },
    },
  },
};

interface Labeled {
  label: string;
  value: string;
}

interface ContactMatch {
  name: string;
  organization: string;
  phones: Labeled[];
  emails: Labeled[];
}

/**
 * Numbers the lookups have returned, by their last digits, so a card about
 * a number ("calling +1 203…") can say whose it is instead.
 */
const namesByNumber = new Map<string, string>();

function numberKey(number: string): string {
  return number.replace(/\D/g, '').slice(-10);
}

/** The contact a number belongs to, when a lookup this session found them. */
export function knownContactName(number: string): string | undefined {
  return namesByNumber.get(numberKey(number));
}

/** Register find_contact. A no-op off macOS. */
export function addContactsTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('find_contact', { definition: FIND_CONTACT, execute: findContact });
}

async function findContact(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const name = stringArg(args, 'name');
  const phone = stringArg(args, 'phone');
  const company = stringArg(args, 'company');
  // Models sometimes put the number in name; digits mean a reverse lookup.
  const digits = (phone || name).replace(/\D/g, '');
  const byPhone = Boolean(phone) || (Boolean(name) && digits.length >= MIN_PHONE_DIGITS);

  try {
    if (byPhone) {
      if (digits.length < MIN_PHONE_DIGITS) {
        return { content: `A phone lookup needs at least ${MIN_PHONE_DIGITS} digits.`, isError: true };
      }
      const matches = await lookup(phoneLookupScript(digits));
      return matches.length > 0
        ? { content: matches.map(formatMatch).join('\n') }
        : { content: `No contact has a number ending in ${digits.slice(-MIN_PHONE_DIGITS)}.` };
    }

    if (name) {
      const { partial, matches } = JSON.parse(await runJxa(nameLookupScript(name), TIMEOUT_MS)) as {
        partial: boolean;
        matches: ContactMatch[];
      };
      if (matches.length === 0) return { content: `No contact matching "${name}".` };
      const lines = matches.map(formatMatch).join('\n');
      return {
        content: partial
          ? `No exact match for "${name}" — the name may be spelled differently. Close matches:\n${lines}`
          : lines,
      };
    }

    if (company) {
      const matches = await lookup(companyLookupScript(company));
      return matches.length > 0
        ? { content: matches.map(formatMatch).join('\n') }
        : {
            content:
              `No contact lists a company matching "${company}". Many contact cards have no ` +
              'company filled in — a name finds people more reliably.',
          };
    }

    return { content: 'find_contact needs a name, a phone number, or a company.', isError: true };
  } catch (error) {
    log.warn(`find_contact failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'Contacts'), isError: true };
  }
}

async function lookup(script: string): Promise<ContactMatch[]> {
  return JSON.parse(await runJxa(script, TIMEOUT_MS)) as ContactMatch[];
}

/** The fields every lookup returns, as a JXA snippet shared by the scripts. */
const PICK = `const pick = (person) => ({
    name: person.name(),
    organization: person.organization() || '',
    phones: person.phones().map((p) => ({ label: p.label() || '', value: p.value() })),
    emails: person.emails().map((e) => ({ label: e.label() || '', value: e.value() })),
  });`;

/** Full name first; a miss retries per word, deduped, flagged as partial. */
function nameLookupScript(name: string): string {
  const tokens = name.split(/\s+/).filter((token) => token.length >= MIN_TOKEN_CHARS);
  return `(() => {
    const app = Application('Contacts');
    ${PICK}
    const find = (text) => app.people.whose({ name: { _contains: text } })().slice(0, ${MAX_MATCHES});
    const exact = find(${JSON.stringify(name)});
    if (exact.length > 0) return JSON.stringify({ partial: false, matches: exact.map(pick) });
    const seen = {};
    const close = [];
    for (const token of ${JSON.stringify(tokens)}) {
      for (const person of find(token)) {
        const id = person.id();
        if (seen[id] || close.length >= ${MAX_MATCHES}) continue;
        seen[id] = true;
        close.push(pick(person));
      }
    }
    return JSON.stringify({ partial: true, matches: close });
  })()`;
}

function companyLookupScript(company: string): string {
  return `(() => {
    const app = Application('Contacts');
    ${PICK}
    const matches = app.people.whose({ organization: { _contains: ${JSON.stringify(company)} } })();
    return JSON.stringify(matches.slice(0, ${MAX_MATCHES}).map(pick));
  })()`;
}

/**
 * Reverse lookup. Contacts can't query normalized numbers, so this reads
 * every phone in bulk (six array fetches — far faster than iterating
 * people) and digit-matches by suffix in plain JavaScript.
 */
function phoneLookupScript(digits: string): string {
  return `(() => {
    const app = Application('Contacts');
    const wanted = ${JSON.stringify(digits)};
    const names = app.people.name();
    const organizations = app.people.organization();
    const phoneLabels = app.people.phones.label();
    const phoneValues = app.people.phones.value();
    const emailLabels = app.people.emails.label();
    const emailValues = app.people.emails.value();
    const out = [];
    for (let i = 0; i < names.length && out.length < ${MAX_MATCHES}; i++) {
      const values = phoneValues[i] || [];
      const hit = values.some((value) => {
        const d = String(value).replace(/\\D/g, '');
        return d.length >= ${MIN_PHONE_DIGITS} && (d.endsWith(wanted) || wanted.endsWith(d));
      });
      if (!hit) continue;
      out.push({
        name: names[i],
        organization: organizations[i] || '',
        phones: values.map((value, j) => ({ label: (phoneLabels[i] || [])[j] || '', value: String(value) })),
        emails: (emailValues[i] || []).map((value, j) => ({ label: (emailLabels[i] || [])[j] || '', value: String(value) })),
      });
    }
    return JSON.stringify(out);
  })()`;
}

function formatMatch(person: ContactMatch): string {
  for (const phone of person.phones) namesByNumber.set(numberKey(phone.value), person.name);
  // Raw Contacts labels look like "_$!<Mobile>!$_"; keep just the word.
  const clean = (label: string): string => label.replace(/_\$!<|>!\$_/g, '');
  const org = person.organization ? ` (${person.organization})` : '';
  const phones = person.phones.map((p) => `${p.value}${p.label ? ` (${clean(p.label)})` : ''}`).join(', ');
  const emails = person.emails.map((e) => `${e.value}${e.label ? ` (${clean(e.label)})` : ''}`).join(', ');
  return `- ${person.name}${org}${phones ? ` · phones: ${phones}` : ''}${emails ? ` · emails: ${emails}` : ''}`;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}
