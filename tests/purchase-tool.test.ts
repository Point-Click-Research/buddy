// record_purchase files an order as the volume Buddy drives: the store from
// the real page in Buddy's browser, from the model in the user's browser;
// the total in cents; never an attempt.

import { describe, expect, it, vi } from 'vitest';
import type { ToolRegistry } from '../src/main/ai/tools';

const apiFetch = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const browserStatus = vi.hoisted(() => vi.fn(() => ({ url: 'https://www.koio.co/checkout/thank-you' })));

vi.mock('../src/main/account/api', () => ({ apiFetch }));
vi.mock('../src/main/browser/window', () => ({ browserStatus }));
vi.mock('../src/main/log', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {} }) }));

const { addRecordPurchaseTool } = await import('../src/main/payment/purchase-tool');

function tool(mode: 'browser' | 'watch') {
  const registry: ToolRegistry = new Map();
  addRecordPurchaseTool(registry, () => mode);
  const { execute } = registry.get('record_purchase')!;
  return { execute: async (input: unknown) => execute(input, new AbortController().signal) };
}

const sent = () => JSON.parse((apiFetch.mock.calls.at(-1) as unknown as [string, { body: string }])[1].body);

describe('record_purchase', () => {
  it("in Buddy's browser, takes the store from the page and posts cents", async () => {
    const outcome = await tool('browser').execute({ total: 249.99, category: 'shoes', item_count: 2, store: 'evil.example' });
    expect(outcome.isError).toBeUndefined();
    expect(sent()).toEqual({
      merchant: 'koio.co',
      amountCents: 24999,
      currency: 'USD',
      category: 'shoes',
      itemCount: 2,
      channel: 'buddy_browser',
    });
  });

  it("in the user's browser, takes the store from the model and needs one", async () => {
    expect((await tool('watch').execute({ total: 12, category: 'groceries' })).isError).toBe(true);
    await tool('watch').execute({ total: 12, category: 'groceries', store: 'https://www.instacart.com/orders/1', currency: 'cad' });
    expect(sent()).toMatchObject({ merchant: 'instacart.com', amountCents: 1200, currency: 'CAD', itemCount: 1, channel: 'user_browser' });
  });

  it('refuses a missing total or an unknown category', async () => {
    expect((await tool('browser').execute({ category: 'shoes' })).isError).toBe(true);
    expect((await tool('browser').execute({ total: 5, category: 'yachts' })).isError).toBe(true);
  });
});
