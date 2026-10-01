// fill_payment: the model names which refs are the card fields; Buddy fills
// them from the Keychain. The digits never pass through the model — not in
// the tool call, not in its result, and (via redact.ts) not in the window
// reads that follow. Every check fails closed: wrong-looking field, changed
// window, unreadable or unapproved checkout URL.

import { clipboard } from 'electron';
import { type RegisteredTool, type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import type { ComputerProvider, ResolvedObservation } from '../computer/provider';
import { inView, windowBounds, type RefRow } from '../computer/tree';
import { logAction } from '../agent/action-log';
import type { ActionGate } from '../agent/safety';
import { createLogger } from '../log';
import { requestConfirmation } from '../mcp/confirm';
import { getSettings } from '../settings';
import { cardSummary, loadPaymentCard, type PaymentCard } from './card';
import { activeTabUrl, allowFill, trustMerchant } from './merchant';
import { armRedaction } from './redact';

const log = createLogger('fill-payment');

/** Roles a card field may have: text inputs, and dropdowns for split expiry. */
const FIELD_ROLES = new Set(['textfield', 'securetextfield', 'combobox', 'popupbutton']);

/** What each slot's label (name or placeholder) must look like. */
const LABELS: Record<SlotKey, RegExp> = {
  number: /(card|cc)[\s-]*(number|no\.?($|\s)|#)|cc-?number|\bpan\b/i,
  expiry: /\bexp|valid|mm\s*[/\s-]?\s*yy/i,
  month: /month|\bmm\b|\bexp/i,
  year: /year|\byy(yy)?\b|\bexp/i,
  cvc: /\bcvc\b|\bcvv\b|security\s*code|\bcsc\b|\bcid\b/i,
  name: /name/i,
};

type SlotKey = 'number' | 'expiry' | 'month' | 'year' | 'cvc' | 'name';

interface Slot {
  key: SlotKey;
  ref: string;
  value: string;
  /** The verified element's identity, re-matched in fresh reads by role + label. */
  role: string;
  label: string;
  /** The driver's own handle on the verified node, to break a tie between look-alikes. */
  token: string | null;
}

interface FillDeps {
  provider(): ComputerProvider;
  /** The task's safety gate (pause, rails, excluded apps), from agent.ts. */
  gate: ActionGate;
}

export function addFillPaymentTool(registry: ToolRegistry, deps: FillDeps): void {
  registry.set('fill_payment', fillPaymentTool(deps));
}

function fillPaymentTool(deps: FillDeps): RegisteredTool {
  return {
    // The approval card (when on) waits on the user.
    waitsForUser: true,
    definition: {
      name: 'fill_payment',
      description:
        "Fill a checkout form's card fields from the user's saved card. You name which refs are " +
        'the fields; Buddy fills them — the card values never pass through you, so never put ' +
        'card details through set_value, type_into, or type. Only works on a browser checkout ' +
        'page. Fill the shipping, contact, and billing-address fields yourself first — ' +
        'get_about_me carries the saved addresses; after this returns, review the form and ' +
        'request_confirmation before placing the order.',
      input_schema: {
        type: 'object',
        properties: {
          observation_id: { type: 'string', description: 'The observation the refs came from.' },
          number_ref: { type: 'string', description: 'The card number field.' },
          expiry_ref: { type: 'string', description: 'The expiry field (MM/YY in one field).' },
          exp_month_ref: { type: 'string', description: 'The expiry month field, when split.' },
          exp_year_ref: { type: 'string', description: 'The expiry year field, when split.' },
          cvc_ref: { type: 'string', description: 'The security code (CVC/CVV) field.' },
          name_ref: { type: 'string', description: 'The name-on-card field, when the form has one.' },
        },
        required: ['observation_id', 'number_ref', 'cvc_ref'],
      },
    },
    execute: (input, signal) => fillPayment(input, signal, deps),
  };
}

async function fillPayment(input: unknown, signal: AbortSignal, deps: FillDeps): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const ref = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');
  // Every refusal is logged: the model retries on its own, and without this
  // a stuck checkout shows only a string of fill_payment calls.
  const fail = (content: string): ToolOutcome => {
    log.warn(`refused: ${content}`);
    return { content, isError: true };
  };

  const card = loadPaymentCard();
  if (!card) return fail('No payment card is saved. The user can add one under Settings → Checkout Forms.');

  const provider = deps.provider();
  const observation = provider.resolveElements(args['observation_id']);
  if (!observation) {
    return fail('That observation has been replaced. Read the window again and send the current refs.');
  }

  const wanted = slotsFor(card, ref);
  if ('error' in wanted) return fail(wanted.error);

  // Every named ref must resolve to a field that reads as what it is claimed
  // to be — the model may have been steered, the elements cannot.
  const slots: Slot[] = [];
  for (const want of wanted.slots) {
    const row = observation.rows.find((candidate) => candidate.ref === want.ref);
    if (!row) return fail(`Observation ${observation.observationId} has no element ${want.ref}.`);
    const label = `${row.name} ${row.value}`.trim();
    if (!FIELD_ROLES.has(row.role)) {
      const hint = row.role === 'iframe' ? ' That is the field\'s container; send the textfield row listed inside it.' : '';
      return fail(`${want.ref} is ${row.role === 'iframe' ? 'an' : 'a'} ${row.role}, not a field the ${want.key} slot can be.${hint}`);
    }
    if (!LABELS[want.key].test(label)) {
      return fail(
        `${want.ref} ("${label}") does not read as the ${want.key} field. ` +
          'Send refs whose labels plainly identify the card fields, or ask_user.',
      );
    }
    slots.push({ ...want, role: row.role, label: row.name, token: row.token });
  }

  // Re-read the window: the fill goes into the fields as they are now, not
  // as they were when the model looked. A changed form fails closed.
  let current = await freshRead(provider, observation, signal);
  if (typeof current === 'string') return fail(current);
  for (const slot of slots) {
    if (!uniqueMatch(current.rows, slot)) {
      return fail(
        `The window changed: the ${slot.key} field ("${slot.label}") is no longer there exactly once. ` +
          'Read the window again and re-send the refs.',
      );
    }
  }

  // The merchant gate: the tab's real URL, HTTPS, on a merchant the user chose.
  // Buddy's browser knows its URL exactly; the user's browser is asked.
  const url = current.url ?? (await activeTabUrl(current.app, current.title));
  if (!url) {
    return fail(
      `Could not read the checkout tab's URL from ${current.app || 'this app'}. ` +
        'Card details are only filled in a browser checkout, so the card was not filled.',
    );
  }
  const verdict = allowFill(url);
  if (!verdict.ok) return fail(verdict.reason);

  const check = await deps.gate(current.app);
  if (!check.ok) return fail(`Card not filled: ${check.reason}`);

  if (getSettings().agentConfirmActions) {
    const total = totalLine(current.rows);
    const approved = await requestConfirmation(
      { title: `Pay with ${cardSummary()}?`, detail: [verdict.host, total].filter(Boolean).join('\n') },
      signal,
    );
    if (!approved) return fail('The user declined the payment.');
  }

  // From the first keystroke until the task ends, window reads mask the card
  // values and screen captures are withheld (see redact.ts and agent.ts).
  armRedaction(card);

  // Inside Buddy's browser the typing is the page's own text input (CDP
  // insertText), so the paste — a workaround for acting from outside — stays
  // out. The focus click does not: see focusField.
  const inPage = provider.descriptor().id === 'browser';
  const held: SlotKey[] = [];
  const unconfirmed: SlotKey[] = [];
  for (const slot of slots) {
    // Each successful action re-reads the window, so the match is re-found
    // in the freshest rows by the identity verified above.
    const match = uniqueMatch(current.rows, slot);
    if (!match) {
      return fail(`The window changed mid-fill at the ${slot.key} field. Read the window and check the form.`);
    }
    // A retry after a partial fill: a field that already holds something is
    // left alone. Keystrokes append, and would corrupt what is there. (A
    // secure field never shows its value, so it is always typed.)
    if (slot.role !== 'securetextfield' && holdsValue(match)) {
      held.push(slot.key);
      continue;
    }
    const focused = await focusField(provider, slot, match, current, signal);
    if (typeof focused === 'string') return fail(`Could not focus the ${slot.key} field: ${focused}`);
    current = focused.window;
    const target = { observation_id: current.observationId, ref: focused.field.ref };
    // Then type (on a plain input this is the fill) and, outside the page,
    // paste over it: a real cmd+v goes through the page's input pipeline,
    // which the driver's typing does not. Select-all first, so a retry
    // replaces instead of appending. set_value is only for a field that
    // refuses typing outright.
    let next: ResolvedObservation | null;
    const typed = await provider.act({ name: 'type_into', input: { ...target, text: slot.value } }, signal);
    if (typed.error) {
      const set = await provider.act({ name: 'set_value', input: { ...target, value: slot.value } }, signal);
      if (set.error) return fail(`Could not fill the ${slot.key} field: ${set.error.detail}`);
      next = windowAfter(provider, set);
    } else {
      if (!inPage) await pasteOver(provider, slot.value, signal);
      const read = await freshRead(provider, current, signal);
      if (typeof read === 'string') return fail(read);
      next = read;
    }
    if (!next) return fail(`The window went away while filling the ${slot.key} field.`);
    // Secure fields hide their value from accessibility, so they are trusted
    // on the action alone; every other field is read back.
    if (slot.role !== 'securetextfield' && !holdsValue(uniqueMatch(next.rows, slot))) {
      // The page may still be formatting what was typed; one more look
      // before doubting it. Some card widgets never report a value at all.
      const again = await freshRead(provider, next, signal);
      if (typeof again !== 'string') next = again;
      if (!holdsValue(uniqueMatch(next.rows, slot))) unconfirmed.push(slot.key);
    }
    current = next;
  }

  trustMerchant(verdict.host);
  const typed = slots.map((slot) => slot.key).filter((key) => !held.includes(key));
  log.info(
    `card fill at ${verdict.host}: typed ${typed.join(', ') || 'nothing'}` +
      (held.length > 0 ? `; ${held.join(', ')} already held a value` : '') +
      (unconfirmed.length > 0 ? `; ${unconfirmed.join(', ')} unconfirmed` : ''),
  );
  logAction({
    action: 'fill_payment',
    input: Object.fromEntries(slots.map((slot) => [`${slot.key}_ref`, slot.ref])),
    reasoning: '',
    result: `Filled the card fields at ${verdict.host}.`,
    screenshotBase64: null,
  });
  const lines = [`Payment fields filled from the saved card at ${verdict.host}.`];
  if (held.length > 0) {
    lines.push(`The ${listOf(held)} ${held.length > 1 ? 'fields' : 'field'} already held a value and ${held.length > 1 ? 'were' : 'was'} left alone.`);
  }
  if (unconfirmed.length > 0) {
    // Not a failure: the value went in. But saying nothing here is how an
    // order got placed against a field the site had silently rejected.
    lines.push(
      `The ${listOf(unconfirmed)} ${unconfirmed.length > 1 ? 'fields' : 'field'} took the value but ${unconfirmed.length > 1 ? 'do' : 'does'} not report it back, so the fill could not be confirmed there. ` +
        'Read the window and look for a validation message on it before placing the order. Call fill_payment again only if the form says a field is empty; it replaces what is in the field. Never type card details yourself.',
    );
  }
  lines.push(
    'Card values are masked in window reads from here on. Review the form, then request_confirmation before placing the order.',
  );
  return { content: lines.join(' ') };
}

/** "number and cvc", for the tool's reply. */
function listOf(keys: SlotKey[]): string {
  return keys.join(' and ');
}

function holdsValue(row: RefRow | null): boolean {
  return Boolean(row?.value.trim());
}

/** The field with focus, and the window as it reads now (a click may have re-read it). */
interface Focused {
  window: ResolvedObservation;
  field: RefRow;
}

/** Dropdowns are never clicked to focus: the click opens their menu instead. */
const DROPDOWN_ROLES = new Set(['combobox', 'popupbutton']);

/**
 * Give the field genuine focus with a real click before anything is typed.
 * Hosted card fields (Shopify Payments, Stripe) take input only after a
 * trusted click: a value write or a script focus() leaves characters the
 * page wipes on blur. The first order that ever went through was the run
 * where the field had been clicked first, and that holds inside Buddy's
 * browser as much as outside it.
 *
 * In Buddy's browser the click is element-addressed (click_element scrolls
 * the field into view itself and re-reads the page, so the fill goes on
 * from that read). On the desktop it is a pointer click at the field's
 * centre, refused when the field is scrolled off-view since the pointer
 * would land on whatever is really there. A provider with neither relies on
 * typing alone. Returns the reason it could not, as text.
 */
async function focusField(
  provider: ComputerProvider,
  slot: Slot,
  field: RefRow,
  window: ResolvedObservation,
  signal: AbortSignal,
): Promise<Focused | string> {
  if (provider.descriptor().id === 'browser') {
    if (DROPDOWN_ROLES.has(slot.role)) return { window, field };
    const clicked = await provider.act(
      { name: 'click_element', input: { observation_id: window.observationId, ref: field.ref } },
      signal,
    );
    if (clicked.error) return clicked.error.detail;
    const after = windowAfter(provider, clicked);
    if (!after) return 'the page went away.';
    const found = uniqueMatch(after.rows, slot);
    return found ? { window: after, field: found } : 'the form changed under the click. Read the window and call fill_payment again.';
  }
  if (!provider.focusAt || !field.bounds) return { window, field };
  const view = provider.resolveElements(window.observationId);
  if (!inView(field.bounds, windowBounds(view?.rows ?? []))) {
    return 'it is scrolled out of view. Scroll until the payment form is visible, read the window, and call fill_payment again.';
  }
  const refused = await provider.focusAt({
    x: field.bounds.x + field.bounds.w / 2,
    y: field.bounds.y + field.bounds.h / 2,
  });
  // A provider that refuses the pointer: fall through to typing alone.
  if (!refused || refused.code === 'REFUSED') return { window, field };
  return refused.detail;
}

/**
 * Select everything in the focused field and paste the value over it. The
 * value sits on the system pasteboard only for the paste itself; whatever
 * was there before comes back straight after. Best effort: a refused key
 * leaves the typed value as it stands.
 */
async function pasteOver(provider: ComputerProvider, value: string, signal: AbortSignal): Promise<void> {
  const selected = await provider.act({ name: 'key', input: { text: 'cmd+a' } }, signal);
  if (selected.error) {
    log.info(`paste skipped: keys refused (${selected.error.code})`);
    return;
  }
  const previous = await clipboard.readText();
  await clipboard.writeText(value);
  try {
    await provider.act({ name: 'key', input: { text: 'cmd+v' } }, signal);
  } finally {
    await clipboard.writeText(previous);
  }
}

/** The window after an action, or null when it went away. */
function windowAfter(
  provider: ComputerProvider,
  outcome: Awaited<ReturnType<ComputerProvider['act']>>,
): ResolvedObservation | null {
  const view = outcome.observation;
  return view?.kind === 'window' ? provider.resolveElements(view.observationId) : null;
}

/** Which slots this call fills, with the value each gets. Expiry is one field or a month/year pair. */
function slotsFor(
  card: PaymentCard,
  ref: (key: string) => string,
): { slots: Array<Pick<Slot, 'key' | 'ref' | 'value'>> } | { error: string } {
  const mm = String(card.expMonth).padStart(2, '0');
  const yy = String(card.expYear % 100).padStart(2, '0');
  if (!ref('number_ref') || !ref('cvc_ref')) {
    return { error: 'fill_payment needs number_ref and cvc_ref.' };
  }
  const slots: Array<Pick<Slot, 'key' | 'ref' | 'value'>> = [
    { key: 'number', ref: ref('number_ref'), value: card.number },
  ];
  if (ref('expiry_ref')) {
    slots.push({ key: 'expiry', ref: ref('expiry_ref'), value: `${mm}/${yy}` });
  } else if (ref('exp_month_ref') && ref('exp_year_ref')) {
    slots.push(
      { key: 'month', ref: ref('exp_month_ref'), value: mm },
      { key: 'year', ref: ref('exp_year_ref'), value: String(card.expYear) },
    );
  } else {
    return { error: 'fill_payment needs expiry_ref, or exp_month_ref and exp_year_ref together.' };
  }
  if (ref('name_ref')) slots.push({ key: 'name', ref: ref('name_ref'), value: card.name });
  slots.push({ key: 'cvc', ref: ref('cvc_ref'), value: card.cvc });
  return { slots };
}

/** Re-read the window so the fill lands on the form as it is now. */
async function freshRead(
  provider: ComputerProvider,
  observation: ResolvedObservation,
  signal: AbortSignal,
): Promise<ResolvedObservation | string> {
  const outcome = await provider.act(
    { name: 'get_window_state', input: { pid: observation.pid, window_id: observation.windowId } },
    signal,
  );
  if (outcome.error) return `The checkout window could not be re-read: ${outcome.error.detail}`;
  const view = outcome.observation;
  const fresh = view?.kind === 'window' ? provider.resolveElements(view.observationId) : null;
  return fresh ?? 'The checkout window went away, so the card was not filled.';
}

/**
 * The verified field, found again in the freshest rows: the one element with
 * the same role and label. Hosted checkouts (Shopify Payments) keep a second,
 * hidden set of card iframes for a collapsed payment option; from inside a
 * hidden frame its input still reads as visible, but the frame has no place
 * on the page, so those rows have no bounds. The field with a place is the
 * one to fill; failing that, the very node that was verified. Anything still
 * ambiguous is a changed form.
 */
function uniqueMatch(rows: readonly RefRow[], slot: Slot): RefRow | null {
  const matches = rows.filter((row) => row.role === slot.role && row.name === slot.label);
  if (matches.length === 1) return matches[0]!;
  const placed = matches.filter((row) => row.bounds);
  if (placed.length === 1) return placed[0]!;
  const same = matches.filter((row) => row.token && row.token === slot.token);
  return same.length === 1 ? same[0]! : null;
}

/** The order total as the page shows it, display-only for the approval card. */
function totalLine(rows: readonly RefRow[]): string {
  const row = rows.find((candidate) => /\btotal\b/i.test(`${candidate.name} ${candidate.value}`));
  return row ? `${row.name} ${row.value}`.trim() : '';
}
