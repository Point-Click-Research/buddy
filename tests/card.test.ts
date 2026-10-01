// The saved payment card: validation on the way in, and a summary that
// carries the brand and last4 but never the digits.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const secrets: Record<string, string> = {};
vi.mock('../src/main/settings', () => ({
  getAppSecret: (name: string) => secrets[name] ?? null,
  setAppSecret: (name: string, value: string) => {
    if (!value) delete secrets[name];
    else secrets[name] = value;
  },
}));

import { cardSummary, hasPaymentCard, loadPaymentCard, savePaymentCard } from '../src/main/payment/card';

const VALID = { number: '4242 4242 4242 4242', expiry: '08/27', cvc: '123', name: 'Ada Lovelace' };

describe('savePaymentCard', () => {
  beforeEach(() => {
    for (const key of Object.keys(secrets)) delete secrets[key];
  });

  it('stores a valid card, normalized', () => {
    savePaymentCard(VALID);
    expect(loadPaymentCard()).toEqual({
      number: '4242424242424242',
      expMonth: 8,
      expYear: 2027,
      cvc: '123',
      name: 'Ada Lovelace',
    });
    expect(hasPaymentCard()).toBe(true);
  });

  it('rejects a number that fails Luhn', () => {
    expect(() => savePaymentCard({ ...VALID, number: '4242 4242 4242 4241' })).toThrow(/card number/i);
    expect(hasPaymentCard()).toBe(false);
  });

  it('rejects a malformed expiry and month 13', () => {
    expect(() => savePaymentCard({ ...VALID, expiry: 'August 2027' })).toThrow(/MM\/YY/);
    expect(() => savePaymentCard({ ...VALID, expiry: '13/27' })).toThrow(/MM\/YY/);
  });

  it('takes a four-digit year', () => {
    savePaymentCard({ ...VALID, expiry: '8/2027' });
    expect(loadPaymentCard()).toMatchObject({ expMonth: 8, expYear: 2027 });
  });

  it('rejects a security code that is not 3 or 4 digits, and requires a name', () => {
    expect(() => savePaymentCard({ ...VALID, cvc: '12' })).toThrow(/security code/i);
    expect(() => savePaymentCard({ ...VALID, cvc: '12345' })).toThrow(/security code/i);
    expect(() => savePaymentCard({ ...VALID, name: '  ' })).toThrow(/name/i);
  });

  it('never puts the digits in a validation error', () => {
    try {
      savePaymentCard({ ...VALID, cvc: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('4242');
    }
  });

  it('clears with null', () => {
    savePaymentCard(VALID);
    savePaymentCard(null);
    expect(loadPaymentCard()).toBeNull();
    expect(cardSummary()).toBe('');
  });
});

describe('cardSummary', () => {
  it('shows the brand and last4 only', () => {
    savePaymentCard(VALID);
    expect(cardSummary()).toBe('Visa •••• 4242');
    savePaymentCard({ ...VALID, number: '5555 5555 5555 4444' });
    expect(cardSummary()).toBe('Mastercard •••• 4444');
    savePaymentCard({ ...VALID, number: '3782 822463 10005', cvc: '1234' });
    expect(cardSummary()).toBe('Amex •••• 0005');
  });
});
