// fill_payment: the deterministic card fill. The model only names refs; every
// gate here fails closed — wrong-looking field, changed window, unreadable or
// unapproved checkout URL, a field in a frame that is not the merchant's or a
// processor's, anywhere but Buddy's browser — and the card values never
// appear in what the model gets back.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefRow } from '../src/main/computer/tree';
import type {
  ActionOutcome,
  ComputerAction,
  ComputerProvider,
  ResolvedObservation,
} from '../src/main/computer/provider';

const { MERCHANT_ORIGIN, STRIPE_ORIGIN } = vi.hoisted(() => ({
  MERCHANT_ORIGIN: 'https://www.zappos.com',
  STRIPE_ORIGIN: 'https://js.stripe.com',
}));

const mocks = vi.hoisted(() => ({
  card: {
    number: '4242424242424242',
    expMonth: 8,
    expYear: 2027,
    cvc: '123',
    name: 'Ada Lovelace',
  } as object | null,
  confirmActions: true,
  requestConfirmation: vi.fn(async () => true),
  allowFill: vi.fn((url: string) =>
    url.includes('zappos')
      ? ({ ok: true, host: 'zappos.com' } as const)
      : ({ ok: false, reason: 'The checkout host is not a merchant the user chose.' } as const),
  ),
  trustMerchant: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock('../src/main/settings', () => ({
  getSettings: () => ({ agentConfirmActions: mocks.confirmActions }),
}));
vi.mock('../src/main/mcp/confirm', () => ({ requestConfirmation: mocks.requestConfirmation }));
vi.mock('../src/main/payment/card', () => ({
  loadPaymentCard: () => mocks.card,
  cardSummary: () => 'Visa •••• 4242',
}));
vi.mock('../src/main/payment/merchant', () => ({
  allowFill: mocks.allowFill,
  // The policy is tested in merchant.test.ts; here only the wiring matters.
  allowFrame: (origin?: string) => origin === MERCHANT_ORIGIN || origin === STRIPE_ORIGIN,
  trustMerchant: mocks.trustMerchant,
}));
vi.mock('../src/main/agent/action-log', () => ({ logAction: mocks.logAction }));
vi.mock('../src/main/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import { addFillPaymentTool } from '../src/main/payment/fill-tool';
import { disarmRedaction, isRedactionArmed } from '../src/main/payment/redact';
import type { ToolRegistry } from '../src/main/ai/tools';

function row(ref: string, role: string, name: string, value = ''): RefRow {
  return {
    ref,
    index: 0,
    token: 't',
    role,
    name,
    value,
    enabled: true,
    selected: false,
    bounds: null,
    textBounds: null,
    depth: 1,
    actions: [],
    origin: MERCHANT_ORIGIN,
  };
}

const CHECKOUT: RefRow[] = [
  row('e1', 'statictext', 'Total $84.12'),
  row('e2', 'textfield', 'Card number'),
  row('e3', 'textfield', 'Expiry MM/YY'),
  row('e4', 'textfield', 'CVC'),
  row('e5', 'textfield', 'Name on card'),
  row('e6', 'button', 'Place order'),
];

const CHECKOUT_URL = 'https://www.zappos.com/checkout';

/**
 * Buddy's browser over one checkout page: get_window_state re-observes;
 * click_element focuses a field and re-reads; type_into and set_value record
 * themselves and land in the field's value (unless the field is deaf, like a
 * card widget that never reports its value back), then re-observe. The
 * `desktop` option stands in for the Cua or pixel driver, which the fill must
 * refuse.
 */
function fakeProvider(
  rows: RefRow[],
  options: {
    refuseTypeInto?: boolean;
    rowsAfterRead?: RefRow[];
    deaf?: string[];
    /** The page's URL as the browser knows it; null for a page with none. */
    url?: string | null;
    desktop?: boolean;
  } = {},
) {
  let counter = 0;
  let current = rows;
  const observations = new Map<string, RefRow[]>([['obs1', rows]]);
  const fills: Array<{ action: string; ref: string; value: string }> = [];
  const url = options.url === undefined ? CHECKOUT_URL : options.url;

  const observe = (): { kind: 'window'; observationId: string } => {
    const id = `obs${++counter + 1}`;
    observations.set(id, current);
    return { kind: 'window', observationId: id };
  };
  const land = (action: string, ref: string, value: string): void => {
    fills.push({ action, ref, value });
    if (!options.deaf?.includes(ref)) {
      current = current.map((item) => (item.ref === ref ? { ...item, value } : item));
    }
  };

  const provider = {
    descriptor: () => ({ id: options.desktop ? 'cua' : 'browser' }),
    resolveElements(id: unknown): ResolvedObservation | null {
      const found = observations.get(String(id));
      if (!found) return null;
      return {
        observationId: String(id),
        pid: 0,
        windowId: 1,
        app: "Buddy's browser",
        title: 'Checkout',
        rows: found,
        ...(url ? { url } : {}),
      };
    },
    async act({ name, input }: ComputerAction): Promise<ActionOutcome> {
      if (name === 'get_window_state') {
        if (options.rowsAfterRead) current = options.rowsAfterRead;
        return { observation: observe() as never };
      }
      if (name === 'click_element') {
        fills.push({ action: 'click', ref: String(input['ref']), value: '' });
        return { observation: observe() as never };
      }
      if (name === 'set_value' || name === 'type_into') {
        if (name === 'type_into' && options.refuseTypeInto) {
          return { error: { code: 'REFUSED', detail: 'not focusable' } as never };
        }
        land(name, String(input['ref']), String(input['value'] ?? input['text']));
        return { observation: observe() as never };
      }
      throw new Error(`unexpected action ${name}`);
    },
  } as unknown as ComputerProvider;

  return { provider, fills };
}

function tool(provider: ComputerProvider) {
  const registry: ToolRegistry = new Map();
  addFillPaymentTool(registry, { provider: () => provider, gate: async () => ({ ok: true }) });
  return registry.get('fill_payment')!;
}

const INPUT = {
  observation_id: 'obs1',
  number_ref: 'e2',
  expiry_ref: 'e3',
  cvc_ref: 'e4',
  name_ref: 'e5',
};

const signal = new AbortController().signal;

const typedRefs = (fills: Array<{ action: string; ref: string }>) =>
  fills.filter((fill) => fill.action === 'type_into').map((fill) => fill.ref);

beforeEach(() => {
  disarmRedaction();
  mocks.confirmActions = true;
  mocks.requestConfirmation.mockClear().mockResolvedValue(true);
  mocks.trustMerchant.mockClear();
  mocks.logAction.mockClear();
});

describe('fill_payment', () => {
  it('clicks each field for real focus, types in-page in order, and never returns a card value', async () => {
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    // Hosted card fields only take input after a genuine click: the click
    // comes first for every field, and the typing lands on the re-read page.
    expect(fills.map((fill) => fill.action)).toEqual([
      'click', 'type_into', 'click', 'type_into', 'click', 'type_into', 'click', 'type_into',
    ]);
    expect(fills.filter((fill) => fill.action === 'type_into').map((fill) => [fill.ref, fill.value])).toEqual([
      ['e2', '4242424242424242'],
      ['e3', '08/27'],
      ['e5', 'Ada Lovelace'],
      ['e4', '123'],
    ]);
    const text = JSON.stringify(result.content);
    expect(text).not.toContain('4242');
    expect(text).not.toContain('123');
    expect(text).toContain('zappos.com');
    // The values are on screen now: reads are masked until the task ends.
    expect(isRedactionArmed()).toBe(true);
    expect(mocks.trustMerchant).toHaveBeenCalledWith('zappos.com');
    // The approval card carried the merchant and the page's total.
    expect(mocks.requestConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Pay with Visa •••• 4242?', detail: expect.stringContaining('Total $84.12') }),
      signal,
    );
  });

  it("refuses to fill anywhere but Buddy's browser, before any other check", async () => {
    // The desktop fill needed a paste, which leaves the number with every
    // clipboard manager. So there is no desktop fill: the card never touches
    // the system clipboard, and the model is told to move the checkout.
    const { provider, fills } = fakeProvider(CHECKOUT, { desktop: true });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/only filled in Buddy's browser/);
    expect(result.content).toMatch(/Never type card details yourself/);
    expect(fills).toHaveLength(0);
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    expect(isRedactionArmed()).toBe(false);
  });

  it('refuses a ref whose label does not read as that card field', async () => {
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute({ ...INPUT, number_ref: 'e5' }, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/does not read as the number field/);
    expect(fills).toHaveLength(0);
    expect(isRedactionArmed()).toBe(false);
  });

  it('refuses a ref that is not a fillable field', async () => {
    const { provider } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute({ ...INPUT, cvc_ref: 'e6' }, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/e6 is a button/);
  });

  it('fails closed when the re-read shows a changed form', async () => {
    const changed = CHECKOUT.filter((item) => item.ref !== 'e4');
    const { provider, fills } = fakeProvider(CHECKOUT, { rowsAfterRead: changed });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/window changed/i);
    expect(fills).toHaveLength(0);
  });

  // Shopify Payments keeps a hidden second set of card iframes; their inputs
  // read as visible from inside the frame but have no place on the page.
  it('fills the placed field when a hidden duplicate shares its label', async () => {
    const onPage = { x: 100, y: 400, w: 300, h: 40 };
    const hosted = CHECKOUT.map((item) => (item.role === 'textfield' ? { ...item, bounds: onPage } : item));
    const withDuplicates = [
      ...hosted,
      row('e7', 'textfield', 'CVC'),
      row('e8', 'textfield', 'Name on card'),
    ];
    const { provider, fills } = fakeProvider(withDuplicates);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(typedRefs(fills)).toEqual(['e2', 'e3', 'e5', 'e4']);
  });

  it('still fails closed when the look-alikes are all on the page and none is the verified node', async () => {
    const onPage = { x: 100, y: 400, w: 300, h: 40 };
    const twins = [
      ...CHECKOUT.map((item) => ({ ...item, bounds: onPage, token: `n-${item.ref}` })),
      { ...row('e7', 'textfield', 'CVC'), bounds: onPage, token: 'n-e7' },
    ];
    const afterRead = twins.map((item) => (item.ref === 'e4' ? { ...item, token: 'n-moved' } : item));
    const { provider } = fakeProvider(twins, { rowsAfterRead: afterRead });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/cvc field .* no longer there exactly once/);
  });

  it("refuses a field in a frame that is neither the merchant's nor a processor's, on an approved page", async () => {
    // The tab URL passes the gate and the label passes the field check, but
    // the CVC input is an ad frame's: the card would go to whoever owns it.
    const adFrame = CHECKOUT.map((item) => (item.ref === 'e4' ? { ...item, origin: 'https://ads.example' } : item));
    const { provider, fills } = fakeProvider(adFrame);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/cvc field sits in a frame from https:\/\/ads\.example, which is neither zappos\.com/);
    expect(result.content).toMatch(/Never type card details yourself/);
    expect(fills).toHaveLength(0);
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    expect(isRedactionArmed()).toBe(false);

    // The same page with its card fields in a processor's hosted frames fills.
    const hosted = CHECKOUT.map((item) =>
      item.role === 'textfield' ? { ...item, origin: STRIPE_ORIGIN, ancestors: [MERCHANT_ORIGIN] } : item,
    );
    const stripe = fakeProvider(hosted);
    expect((await tool(stripe.provider).execute(INPUT, signal)).isError).toBeUndefined();
    expect(typedRefs(stripe.fills)).toEqual(['e2', 'e3', 'e5', 'e4']);
  });

  it("refuses a processor's frame placed by a frame that is neither the merchant's nor a processor's", async () => {
    // A real Stripe card frame, but the iframe that embeds it belongs to an
    // ad on the approved page: the ad chose where the card goes.
    const nested = CHECKOUT.map((item) =>
      item.role === 'textfield' ? { ...item, origin: STRIPE_ORIGIN, ancestors: ['https://ads.example', MERCHANT_ORIGIN] } : item,
    );
    const { provider, fills } = fakeProvider(nested);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/number field sits inside a frame placed by one from https:\/\/ads\.example/);
    expect(fills).toHaveLength(0);
    expect(isRedactionArmed()).toBe(false);
  });

  it('fails closed on an unapproved or unreadable checkout URL', async () => {
    const denied = fakeProvider(CHECKOUT, { url: 'https://pay-secure.example/checkout' });
    const refused = await tool(denied.provider).execute(INPUT, signal);
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/not a merchant the user chose/);

    const unreadable = fakeProvider(CHECKOUT, { url: null });
    const blind = await tool(unreadable.provider).execute(INPUT, signal);
    expect(blind.isError).toBe(true);
    expect(blind.content).toMatch(/could not read/i);
    expect([...denied.fills, ...unreadable.fills]).toHaveLength(0);
  });

  it('skips the approval card when agentConfirmActions is off', async () => {
    mocks.confirmActions = false;
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    expect(typedRefs(fills)).toHaveLength(4);
  });

  it('stops without filling when the user declines', async () => {
    mocks.requestConfirmation.mockResolvedValue(false);
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/declined/);
    expect(fills).toHaveLength(0);
    expect(isRedactionArmed()).toBe(false);
  });

  it('falls back to set_value when typing is refused', async () => {
    const { provider, fills } = fakeProvider(CHECKOUT, { refuseTypeInto: true });
    expect((await tool(provider).execute(INPUT, signal)).isError).toBeUndefined();
    const writes = fills.filter((fill) => fill.action !== 'click');
    expect(writes.every((fill) => fill.action === 'set_value')).toBe(true);
    expect(writes).toHaveLength(4);
  });

  it('never follows a landed value with a value write, and says which fields it could not confirm', async () => {
    // Card widgets that do not report a value back: the value went in (the
    // user watched the number appear), so a set_value "fallback" only wiped
    // it. The tool fills once, reads back, and reports honestly.
    const { provider, fills } = fakeProvider(CHECKOUT, { deaf: ['e2', 'e4'] });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(fills.filter((fill) => fill.ref === 'e2').map((fill) => fill.action)).toEqual(['click', 'type_into']);
    expect(result.content).toMatch(/number and cvc fields took the value/);
    expect(result.content).toMatch(/it replaces what is in the field/);
    expect(JSON.stringify(result.content)).not.toContain('4242');
  });

  it('leaves a field alone on a retry when it already holds a value', async () => {
    const partly = CHECKOUT.map((item) => (item.ref === 'e3' ? { ...item, value: '08/27' } : item));
    const { provider, fills } = fakeProvider(partly);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect([...new Set(fills.map((fill) => fill.ref))]).toEqual(['e2', 'e5', 'e4']);
    expect(result.content).toMatch(/expiry field already held a value/);
  });

  it('sets a dropdown expiry without clicking it (the click would open its menu)', async () => {
    const split = [
      ...CHECKOUT.filter((item) => item.ref !== 'e3'),
      row('e7', 'combobox', 'Expiration month'),
      row('e8', 'combobox', 'Expiration year'),
    ];
    const { provider, fills } = fakeProvider(split);
    const result = await tool(provider).execute(
      { observation_id: 'obs1', number_ref: 'e2', exp_month_ref: 'e7', exp_year_ref: 'e8', cvc_ref: 'e4', name_ref: 'e5' },
      signal,
    );
    expect(result.isError).toBeUndefined();
    expect(fills.filter((fill) => fill.action === 'click').map((fill) => fill.ref)).toEqual(['e2', 'e5', 'e4']);
    expect(fills.map((fill) => [fill.ref, fill.value])).toContainEqual(['e7', '08']);
    expect(fills.map((fill) => [fill.ref, fill.value])).toContainEqual(['e8', '2027']);
  });

  it('trusts a secure field on the action alone, since it hides its value', async () => {
    const secure = CHECKOUT.map((item) => (item.ref === 'e4' ? { ...item, role: 'securetextfield' } : item));
    const { provider } = fakeProvider(secure, { deaf: ['e4'] });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
  });
});
