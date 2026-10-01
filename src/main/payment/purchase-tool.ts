// record_purchase: how an agent task files an order it placed, in Buddy's
// browser or the user's. Called only once the confirmation page shows; what
// it records is the store, the total, and the kind of thing, which goes to
// the Buddy API as the volume Buddy drives. In Buddy's browser the store is
// read from the real URL.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { PURCHASE_CATEGORIES, type Purchase } from '../../shared/contracts';
import { registrableDomain } from '../../shared/link-text';
import type { AgentTaskMode } from '../../shared/types';
import { apiFetch } from '../account/api';
import { toolArgs, type ToolOutcome, type ToolRegistry } from '../ai/tools';
import { browserStatus } from '../browser/window';
import { createLogger } from '../log';

const log = createLogger('purchases');

const RECORD_PURCHASE: Tool = {
  name: 'record_purchase',
  description:
    'File an order you just placed, right after the page confirms it (an order number, a thank-you page). ' +
    'Never for an intent or an attempt; only for what the page shows went through. One call per order.',
  input_schema: {
    type: 'object',
    properties: {
      store: { type: 'string', description: 'The store\'s domain ("koio.co"). Ignored in Buddy\'s browser, where it is read from the page.' },
      total: { type: 'number', description: 'The order total as charged, as a number (249.99).' },
      currency: { type: 'string', description: 'ISO code, "USD" unless the page shows another.' },
      category: { type: 'string', enum: [...PURCHASE_CATEGORIES], description: 'What the order was mostly for.' },
      item_count: { type: 'integer', description: 'How many items were in the order.' },
    },
    required: ['total', 'category'],
  },
};

export function addRecordPurchaseTool(registry: ToolRegistry, mode: () => AgentTaskMode): void {
  registry.set('record_purchase', { definition: RECORD_PURCHASE, execute: (input) => recordPurchase(input, mode()) });
}

function recordPurchase(input: unknown, mode: AgentTaskMode): ToolOutcome {
  const args = toolArgs(input);
  const total = Number(args['total']);
  const category = PURCHASE_CATEGORIES.find((name) => name === args['category']);
  if (!Number.isFinite(total) || total < 0) return { content: 'total must be the order total as a number.', isError: true };
  if (!category) return { content: `category must be one of ${PURCHASE_CATEGORIES.join(', ')}.`, isError: true };

  const inBuddyBrowser = mode === 'browser';
  const host = inBuddyBrowser ? hostOf(browserStatus().url) : hostOf(String(args['store'] ?? ''));
  if (!host) {
    return { content: inBuddyBrowser ? 'No store page is open; nothing recorded.' : 'store must be the store\'s domain.', isError: true };
  }

  const currency = String(args['currency'] ?? 'USD').toUpperCase();
  const count = Number(args['item_count']);
  void send({
    merchant: host,
    amountCents: Math.round(total * 100),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    category,
    itemCount: Number.isInteger(count) && count > 0 ? count : 1,
    channel: inBuddyBrowser ? 'buddy_browser' : 'user_browser',
  });
  return { content: `Recorded the order at ${host}.` };
}

/** A URL or a bare host, as a store's registrable domain; '' when it is neither. */
function hostOf(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  try {
    return registrableDomain(new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname);
  } catch {
    return '';
  }
}

/** Best effort: a lost row is not worth failing the task over, and there is no account to bill it to when signed out. */
async function send(purchase: Purchase): Promise<void> {
  try {
    const response = await apiFetch('/v1/purchases', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(purchase),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    log.warn(`purchase at ${purchase.merchant} not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
}
