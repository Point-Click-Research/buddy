import { describe, expect, it } from 'vitest';
import { looksLikeCardNumber } from '../src/main/about-me';

describe('looksLikeCardNumber', () => {
  it('rejects well-known test PANs, including spaced and dashed forms', () => {
    expect(looksLikeCardNumber('4111111111111111')).toBe(true);
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('4111-1111-1111-1111')).toBe(true);
    expect(looksLikeCardNumber('378282246310005')).toBe(true);
    expect(looksLikeCardNumber('Name: Jane\nCard: 4111111111111111')).toBe(true);
  });

  it('rejects 4-4-4-4 groups even when Luhn fails', () => {
    expect(looksLikeCardNumber('1234-5678-9012-3456')).toBe(true);
  });

  it('allows ordinary form facts', () => {
    expect(
      looksLikeCardNumber(
        'Name: Jane Doe\nEmail: jane@example.com\nPhone: 555-010-1234\nAddress: 123 Main St',
      ),
    ).toBe(false);
    expect(looksLikeCardNumber('')).toBe(false);
    expect(looksLikeCardNumber('Order #20240916')).toBe(false);
  });
});
