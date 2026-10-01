import { describe, expect, it } from 'vitest';
import { cardBrand, cardBrandNamed, formatCardNumber, formatCvc, formatExpiry } from '../src/shared/card-brand';

describe('card brand and typing help', () => {
  it('names the brand from the first digits, generic before them', () => {
    expect(cardBrand('').name).toBe('Card');
    expect(cardBrand('4').name).toBe('Visa');
    expect(cardBrand('5555 4444').name).toBe('Mastercard');
    expect(cardBrand('2221').name).toBe('Mastercard');
    expect(cardBrand('3782').name).toBe('Amex');
    expect(cardBrand('6011').name).toBe('Discover');
    expect(cardBrandNamed('Amex •••• 0005').mark).toBe('amex');
    expect(cardBrandNamed('Card •••• 0005').mark).toBe('');
  });

  it('groups digits per brand and drops anything that is not a digit', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-4242 42')).toBe('4242 4242 42');
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    // 19 digits is the ceiling; the overflow group still gets its space.
    expect(formatCardNumber('42424242424242424242999')).toBe('4242 4242 4242 4242 424');
  });

  it('places the expiry slash after the month and caps the security code by brand', () => {
    expect(formatExpiry('1')).toBe('1');
    expect(formatExpiry('12')).toBe('12');
    expect(formatExpiry('122')).toBe('12/2');
    expect(formatExpiry('12/27')).toBe('12/27');
    expect(formatExpiry('12/2027')).toBe('12/20');
    expect(formatCvc('12345', cardBrand('4'))).toBe('123');
    expect(formatCvc('12345', cardBrand('37'))).toBe('1234');
  });
});
