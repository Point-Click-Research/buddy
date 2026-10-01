import { describe, expect, it } from 'vitest';
import { findShopper, isSelfReference, shopperHasEntries } from '../src/shared/types';
import {
  buyerComplete,
  useCaseChecks,
  useCaseNudgeBlock,
  type UseCaseSnap,
} from '../src/shared/use-cases';

const emptyBuyer = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address1: '',
  city: '',
  province: '',
  postalCode: '',
};

const fullBuyer = {
  ...emptyBuyer,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'a@b.co',
  phone: '2125550100',
  address1: '1 Main',
  city: 'New York',
  province: 'NY',
  postalCode: '10001',
};

const exa = { name: 'exa', url: 'https://mcp.exa.ai/mcp', enabled: true, status: 'connected' };
const bland = { name: 'bland', url: 'https://mcp.bland.ai/sse', enabled: true, status: 'connected' };

const emptyShopper = {
  name: 'Me',
  products: [],
  travel: [],
  dining: [],
  formFacts: [],
  general: [],
};

function snap(patch: Partial<UseCaseSnap> = {}): UseCaseSnap {
  return {
    disabledBuiltinTools: [],
    screenAwareness: true,
    marksEnabled: true,
    agentModeEnabled: false,
    servers: [],
    hasCard: false,
    shopifyKey: false,
    shipping: emptyBuyer,
    connectedApps: [],
    ...patch,
  };
}

describe('use case checklists', () => {
  it('treats a connected Exa server as product search', () => {
    const ready = useCaseChecks('discover', snap({ servers: [exa] }));
    expect(ready.find((row) => row.label === 'Product search')?.ok).toBe(true);
    const parallel = useCaseChecks('discover', snap({
      servers: [{ name: 'parallel', url: 'https://search.parallel.ai/mcp', enabled: true, status: 'connected' }],
    }));
    expect(parallel.find((row) => row.label === 'Product search')?.ok).toBe(false);
    expect(useCaseChecks('discover', snap()).find((row) => row.label === 'Product search')?.ok).toBe(false);
  });

  it('recommends the Shopify Catalog and circle-to-find-similar on Discover', () => {
    const rows = useCaseChecks('discover', snap({ shopifyKey: true }));
    const catalog = rows.find((row) => row.label === 'Shopify Catalog');
    expect(catalog?.ok).toBe(true);
    expect(catalog?.required).toBe(false);
    const circle = rows.find((row) => row.label === 'Circle to find similar');
    expect(circle?.ok).toBe(true);
    // Circle needs both Eyes and Draw to point.
    const noMarks = useCaseChecks('discover', snap({ marksEnabled: false }));
    expect(noMarks.find((row) => row.label === 'Circle to find similar')?.ok).toBe(false);
  });

  it('purchase is ready with a card, a shipping address, and computer use', () => {
    const rows = useCaseChecks('purchase', snap({ hasCard: true, shipping: fullBuyer, agentModeEnabled: true }));
    expect(rows.map((row) => row.label)).toEqual(['Payment card', 'Shipping address', 'Computer use']);
    expect(rows.every((row) => row.ok)).toBe(true);
    expect(buyerComplete(emptyBuyer)).toBe(false);
  });

  it('book requires only search; browser, phone, and itinerary apps are extras', () => {
    const rows = useCaseChecks('book', snap({ servers: [exa, bland], connectedApps: ['google_maps'] }));
    expect(rows.find((row) => row.label === 'Web search')?.required).toBe(true);
    expect(rows.find((row) => row.label === 'Computer use')?.ok).toBe(false);
    expect(rows.find((row) => row.label === 'Phone calls')?.ok).toBe(true);
    expect(rows.find((row) => row.label === 'Itinerary apps')?.ok).toBe(true);
    const driving = useCaseChecks('book', snap({ agentModeEnabled: true }));
    expect(driving.find((row) => row.label === 'Computer use')?.ok).toBe(true);
  });

  it('call, text, and email each require only their own channel', () => {
    const call = useCaseChecks('call', snap({ servers: [bland] }));
    expect(call.filter((row) => row.required).map((row) => row.label)).toEqual(['Phone calls']);
    expect(call.find((row) => row.label === 'Phone calls')?.ok).toBe(true);
    const text = useCaseChecks('text', snap());
    expect(text.filter((row) => row.required).map((row) => row.label)).toEqual(['Messages']);
    const email = useCaseChecks('email', snap({ connectedApps: ['gmail'] }));
    expect(email.filter((row) => row.required).map((row) => row.label)).toEqual(['Apple Mail']);
    expect(email.find((row) => row.label === 'Gmail')?.ok).toBe(true);
  });

  it('counts a shopper only once a category has entries', () => {
    expect(shopperHasEntries(emptyShopper)).toBe(false);
    expect(shopperHasEntries({ ...emptyShopper, products: ['M tops', 'earth tones'] })).toBe(true);
  });

  it('names each missing piece with the Settings page Buddy opens for it', () => {
    const block = useCaseNudgeBlock(snap());
    expect(block).not.toContain('Browser tabs');
    expect(block).toContain('Payment card (required, page "buy" — Add a payment card');
    expect(block).toContain('Shipping address (required, page "buy" — Fill in the shipping address');
    expect(block).toContain('Computer use (required, page "agent" — Turn on Computer Use so Buddy can check out in his own browser');
    expect(block).toContain('open_settings');
    // Search and calls come with Buddy: nothing for the user to set.
    expect(block).not.toContain('Product search');
    expect(block).not.toContain('Phone calls');
  });

  it('holds app-linked rows back until the connected list is known', () => {
    const block = useCaseNudgeBlock(snap({ servers: [exa, bland] }), { skipApps: true });
    expect(block).not.toContain('Gmail');
    expect(block).not.toContain('Itinerary apps');
  });

  it('says nothing about a pillar that is already set up', () => {
    const ready = useCaseNudgeBlock(snap({ hasCard: true, shipping: fullBuyer, agentModeEnabled: true }));
    expect(ready).not.toContain('Purchase —');
  });

  it('finds shoppers by exact name or a whole word of it', () => {
    const shoppers = [
      { ...emptyShopper, name: 'Me' },
      { ...emptyShopper, name: 'Sanna (girlfriend)' },
      { ...emptyShopper, name: 'Sally' },
    ];
    expect(findShopper(shoppers, 'me')).toBe(0);
    expect(findShopper(shoppers, 'Sanna')).toBe(1); // whole word of a longer name
    expect(findShopper(shoppers, 'Sanna (girlfriend)')).toBe(1);
    expect(findShopper(shoppers, 'Al')).toBe(-1); // never a substring of "Sally"
    expect(findShopper(shoppers, 'Marcus')).toBe(-1); // unknown: caller starts a profile
    expect(findShopper(shoppers, '')).toBe(-1);
  });

  it('treats "me" and friends as the user, whatever the first profile is named', () => {
    for (const alias of ['me', 'Me', 'myself', 'the user', 'I']) {
      expect(isSelfReference(alias)).toBe(true);
    }
    expect(isSelfReference('Zach')).toBe(false); // real names go through findShopper
    expect(isSelfReference('Sanna')).toBe(false);
  });
});
