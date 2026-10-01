// The merchant gate: card details are filled only on an HTTPS page whose
// registrable domain the user chose — noted from opened tabs, named in the
// approved plan, or on the standing trusted list. Everything else fails
// closed with a reason the model can act on.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  settings: { trustedMerchants: [] as string[] },
  updateSettings: vi.fn(),
  plan: null as { goal: string; steps: string[] } | null,
}));
vi.mock('../src/main/settings', () => ({
  getSettings: () => mocks.settings,
  updateSettings: mocks.updateSettings,
}));
vi.mock('../src/main/mcp/confirm', () => ({ getSessionPlan: () => mocks.plan }));
vi.mock('../src/main/apple/jxa', () => ({ runJxa: vi.fn() }));
vi.mock('../src/main/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import { registrableDomain } from '../src/shared/link-text';
import {
  allowFill,
  clearNotedMerchants,
  hostsInText,
  noteMerchantUrl,
  trustMerchant,
} from '../src/main/payment/merchant';

beforeEach(() => {
  clearNotedMerchants();
  mocks.settings.trustedMerchants = [];
  mocks.plan = null;
  mocks.updateSettings.mockClear();
});

describe('registrableDomain', () => {
  it('strips subdomains and keeps ccTLD second levels', () => {
    expect(registrableDomain('www.amazon.com')).toBe('amazon.com');
    expect(registrableDomain('checkout.shop.example.com')).toBe('example.com');
    expect(registrableDomain('www.amazon.co.uk')).toBe('amazon.co.uk');
    expect(registrableDomain('amazon.com')).toBe('amazon.com');
  });
});

describe('hostsInText', () => {
  it('finds domains in plan text, deduped by registrable domain', () => {
    expect(hostsInText('Buy the mug on Amazon.com and check www.amazon.com/dp/B01')).toEqual(['amazon.com']);
    expect(hostsInText('no hosts here')).toEqual([]);
  });
});

describe('allowFill', () => {
  it('refuses plain HTTP even on a chosen merchant', () => {
    noteMerchantUrl('https://amazon.com/dp/B01');
    const verdict = allowFill('http://amazon.com/checkout');
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/not HTTPS/i));
  });

  it('allows a host Buddy opened this conversation, matched by registrable domain', () => {
    noteMerchantUrl('https://www.amazon.com/dp/B01');
    expect(allowFill('https://checkout.amazon.com/pay')).toEqual({ ok: true, host: 'amazon.com' });
  });

  it('never notes an http page', () => {
    noteMerchantUrl('http://evil.example/product');
    expect(allowFill('https://evil.example/pay')).toMatchObject({ ok: false });
  });

  it('allows a merchant named in the approved plan', () => {
    mocks.plan = { goal: 'Buy the mug on etsy.com', steps: ['open the product page'] };
    expect(allowFill('https://www.etsy.com/checkout')).toEqual({ ok: true, host: 'etsy.com' });
  });

  it('allows a merchant on the trusted list', () => {
    mocks.settings.trustedMerchants = ['zappos.com'];
    expect(allowFill('https://secure.zappos.com/pay')).toEqual({ ok: true, host: 'zappos.com' });
  });

  it('refuses an unrelated host with a reason naming it', () => {
    noteMerchantUrl('https://amazon.com/dp/B01');
    const verdict = allowFill('https://pay-secure.example/checkout');
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict).toHaveProperty('reason', expect.stringContaining('pay-secure.example'));
    expect(verdict).toHaveProperty('reason', expect.stringMatching(/ask_user/));
  });

  it('forgets noted merchants when cleared (conversation change)', () => {
    noteMerchantUrl('https://amazon.com/dp/B01');
    clearNotedMerchants();
    expect(allowFill('https://amazon.com/pay')).toMatchObject({ ok: false });
  });
});

describe('trustMerchant', () => {
  it('adds the registrable domain once', () => {
    trustMerchant('checkout.amazon.com');
    expect(mocks.updateSettings).toHaveBeenCalledWith({ trustedMerchants: ['amazon.com'] });
    mocks.settings.trustedMerchants = ['amazon.com'];
    mocks.updateSettings.mockClear();
    trustMerchant('amazon.com');
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
