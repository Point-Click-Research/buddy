// fill_payment: the deterministic card fill. The model only names refs; every
// gate here fails closed — wrong-looking field, changed window, unreadable or
// unapproved checkout URL — and the card values never appear in what the
// model gets back.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefRow } from '../src/main/computer/tree';
import type {
  ActionOutcome,
  ComputerAction,
  ComputerProvider,
  ResolvedObservation,
} from '../src/main/computer/provider';

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
  tabUrl: 'https://www.zappos.com/checkout' as string | null,
  allowFill: vi.fn((url: string) =>
    url.includes('zappos')
      ? ({ ok: true, host: 'zappos.com' } as const)
      : ({ ok: false, reason: 'The checkout host is not a merchant the user chose.' } as const),
  ),
  trustMerchant: vi.fn(),
  logAction: vi.fn(),
  /** The system pasteboard: what was there before, and what is there now. */
  clipboard: 'a note the user copied earlier',
}));

vi.mock('electron', () => ({
  clipboard: {
    readText: () => mocks.clipboard,
    writeText: (text: string) => {
      mocks.clipboard = text;
    },
  },
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
  activeTabUrl: async () => mocks.tabUrl,
  allowFill: mocks.allowFill,
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

/**
 * A provider over one window: get_window_state re-observes; type_into
 * focuses the field and types; key cmd+v pastes the pasteboard into the
 * focused field; every write records itself and lands in the field's value
 * (unless the field is deaf, like a card widget that never reports its value
 * back), then re-observes.
 */
function fakeProvider(
  rows: RefRow[],
  options: {
    refuseTypeInto?: boolean;
    rowsAfterRead?: RefRow[];
    deaf?: string[];
    /** Buddy's own browser: the fill types in-page and reads the URL from the observation. */
    browser?: boolean;
  } = {},
) {
  let counter = 0;
  let current = rows;
  let focused = '';
  const observations = new Map<string, RefRow[]>([['obs1', rows]]);
  const fills: Array<{ action: string; ref: string; value: string }> = [];

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
    descriptor: () => ({ id: options.browser ? 'browser' : 'cua' }),
    resolveElements(id: unknown): ResolvedObservation | null {
      const found = observations.get(String(id));
      if (!found) return null;
      return options.browser
        ? { observationId: String(id), pid: 0, windowId: 1, app: "Buddy's browser", title: 'Checkout', rows: found, url: 'https://www.zappos.com/checkout' }
        : { observationId: String(id), pid: 7, windowId: 42, app: 'Google Chrome', title: 'Checkout', rows: found };
    },
    async act({ name, input }: ComputerAction): Promise<ActionOutcome> {
      if (name === 'get_window_state') {
        if (options.rowsAfterRead) current = options.rowsAfterRead;
        return { observation: observe() as never };
      }
      if (name === 'key') {
        if (input['text'] === 'cmd+v') land('paste', focused, mocks.clipboard);
        return { observation: { kind: 'screen', frameId: 'f1' } as never };
      }
      if (name === 'click_element') {
        // Buddy's browser: a trusted click focuses the field and re-reads the page.
        focused = String(input['ref']);
        fills.push({ action: 'click', ref: focused, value: '' });
        return { observation: observe() as never };
      }
      if (name === 'set_value' || name === 'type_into') {
        if (name === 'type_into' && options.refuseTypeInto) {
          return { error: { code: 'REFUSED', detail: 'not focusable' } as never };
        }
        if (name === 'type_into') focused = String(input['ref']);
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

beforeEach(() => {
  disarmRedaction();
  mocks.clipboard = 'a note the user copied earlier';
  mocks.confirmActions = true;
  mocks.tabUrl = 'https://www.zappos.com/checkout';
  mocks.requestConfirmation.mockClear().mockResolvedValue(true);
  mocks.trustMerchant.mockClear();
  mocks.logAction.mockClear();
});

describe('fill_payment', () => {
  it('types then pastes over each field in order, restores the clipboard, and never returns a card value', async () => {
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    // Typing focuses and fills; the paste goes through the browser's own
    // input path, which is the only one hosted card fields listen to.
    expect(fills.map((fill) => fill.action)).toEqual(
      ['type_into', 'paste', 'type_into', 'paste', 'type_into', 'paste', 'type_into', 'paste'],
    );
    expect(fills.filter((fill) => fill.action === 'paste').map((fill) => [fill.ref, fill.value])).toEqual([
      ['e2', '4242424242424242'],
      ['e3', '08/27'],
      ['e5', 'Ada Lovelace'],
      ['e4', '123'],
    ]);
    // The card was on the pasteboard only for the paste itself.
    expect(mocks.clipboard).toBe('a note the user copied earlier');
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
    const { provider, fills } = fakeProvider(withDuplicates, { browser: true });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(fills.filter((fill) => fill.action === 'type_into').map((fill) => fill.ref)).toEqual(['e2', 'e3', 'e5', 'e4']);
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

  it('fails closed on an unapproved or unreadable checkout host', async () => {
    mocks.tabUrl = 'https://pay-secure.example/checkout';
    const { provider, fills } = fakeProvider(CHECKOUT);
    const denied = await tool(provider).execute(INPUT, signal);
    expect(denied.isError).toBe(true);
    expect(denied.content).toMatch(/not a merchant the user chose/);

    mocks.tabUrl = null;
    const unreadable = await tool(provider).execute(INPUT, signal);
    expect(unreadable.isError).toBe(true);
    expect(unreadable.content).toMatch(/could not read/i);
    expect(fills).toHaveLength(0);
  });

  it('skips the approval card when agentConfirmActions is off', async () => {
    mocks.confirmActions = false;
    const { provider, fills } = fakeProvider(CHECKOUT);
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
    expect(fills.filter((fill) => fill.action === 'paste')).toHaveLength(4);
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

  it('falls back to set_value, with no paste, when typing is refused', async () => {
    const { provider, fills } = fakeProvider(CHECKOUT, { refuseTypeInto: true });
    expect((await tool(provider).execute(INPUT, signal)).isError).toBeUndefined();
    expect(fills.every((fill) => fill.action === 'set_value')).toBe(true);
    expect(fills).toHaveLength(4);
  });

  it('never follows a landed value with a value write, and says which fields it could not confirm', async () => {
    // Card widgets that do not report a value back: the value went in (the
    // user watched the number appear), so a set_value "fallback" only wiped
    // it. The tool fills once, reads back, and reports honestly.
    const { provider, fills } = fakeProvider(CHECKOUT, { deaf: ['e2', 'e4'] });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    expect(fills.filter((fill) => fill.ref === 'e2').map((fill) => fill.action)).toEqual(['type_into', 'paste']);
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

  it('clicks each field for real focus before filling it, and refuses one scrolled out of view', async () => {
    const view = { x: 0, y: 0, w: 1000, h: 800 };
    const placed = (item: RefRow, y: number): RefRow => ({ ...item, bounds: { x: 100, y, w: 300, h: 40 } });
    const rows = [
      { ...row('e0', 'window', 'Checkout'), bounds: view },
      ...CHECKOUT.map((item, i) => placed(item, 100 + i * 60)),
    ];
    const focused: Array<{ x: number; y: number }> = [];
    const { provider, fills } = fakeProvider(rows);
    (provider as { focusAt?: (point: { x: number; y: number }) => Promise<null> }).focusAt = async (point) => {
      focused.push(point);
      return null;
    };
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    // One click per field, at its centre, before anything is typed into it.
    expect(focused).toEqual([
      { x: 250, y: 180 }, // e2 number
      { x: 250, y: 240 }, // e3 expiry
      { x: 250, y: 360 }, // e5 name
      { x: 250, y: 300 }, // e4 cvc
    ]);
    expect(fills.filter((fill) => fill.action === 'paste')).toHaveLength(4);

    // The CVC field laid out below the window: clicking it would hit the Dock.
    const scrolled = rows.map((item) => (item.ref === 'e4' ? placed(item, 1180) : item));
    const away = fakeProvider(scrolled);
    (away.provider as { focusAt?: () => Promise<null> }).focusAt = async () => null;
    const refused = await tool(away.provider).execute(INPUT, signal);
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/cvc field: it is scrolled out of view/);
  });

  it("in Buddy's browser it clicks each field to focus it, types in-page, never pastes, and takes the URL from the page", async () => {
    // The tab-URL lookup is the user's browser's; it must not be consulted.
    mocks.tabUrl = null;
    const { provider, fills } = fakeProvider(CHECKOUT, { browser: true });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
    // Hosted card fields only take input after a genuine click: the click
    // comes first for every field, and the typing lands on the re-read page.
    expect(fills.map((fill) => fill.action)).toEqual([
      'click', 'type_into', 'click', 'type_into', 'click', 'type_into', 'click', 'type_into',
    ]);
    expect(fills.filter((fill) => fill.action === 'type_into').map((fill) => fill.ref)).toEqual(['e2', 'e3', 'e5', 'e4']);
    expect(result.content).toContain('zappos.com');
    // Nothing touched the pasteboard.
    expect(mocks.clipboard).toBe('a note the user copied earlier');
  });

  it("in Buddy's browser a dropdown expiry is set, not clicked (the click would open its menu)", async () => {
    mocks.tabUrl = null;
    const split = [
      ...CHECKOUT.filter((item) => item.ref !== 'e3'),
      row('e7', 'combobox', 'Expiration month'),
      row('e8', 'combobox', 'Expiration year'),
    ];
    const { provider, fills } = fakeProvider(split, { browser: true });
    const result = await tool(provider).execute(
      { observation_id: 'obs1', number_ref: 'e2', exp_month_ref: 'e7', exp_year_ref: 'e8', cvc_ref: 'e4', name_ref: 'e5' },
      signal,
    );
    expect(result.isError).toBeUndefined();
    expect(fills.filter((fill) => fill.action === 'click').map((fill) => fill.ref)).toEqual(['e2', 'e5', 'e4']);
  });

  it('trusts a secure field on the action alone, since it hides its value', async () => {
    const secure = CHECKOUT.map((item) => (item.ref === 'e4' ? { ...item, role: 'securetextfield' } : item));
    const { provider } = fakeProvider(secure, { deaf: ['e4'] });
    const result = await tool(provider).execute(INPUT, signal);
    expect(result.isError).toBeUndefined();
  });

  it('takes a split month/year expiry', async () => {
    const split = [
      ...CHECKOUT.filter((item) => item.ref !== 'e3'),
      row('e7', 'popupbutton', 'Expiration month'),
      row('e8', 'popupbutton', 'Expiration year'),
    ];
    const { provider, fills } = fakeProvider(split);
    const input = { ...INPUT, expiry_ref: undefined, exp_month_ref: 'e7', exp_year_ref: 'e8' };
    const result = await tool(provider).execute(input, signal);
    expect(result.isError).toBeUndefined();
    expect(fills.map((fill) => [fill.ref, fill.value])).toContainEqual(['e7', '08']);
    expect(fills.map((fill) => [fill.ref, fill.value])).toContainEqual(['e8', '2027']);
  });
});
