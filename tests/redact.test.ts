// Once fill_payment has typed the card, the next window read echoes the
// values. These tests pin the seam: armed, the digits are masked in every
// spacing and images are withheld; disarmed, nothing is touched.

import { afterEach, describe, expect, it } from 'vitest';
import {
  armRedaction,
  disarmRedaction,
  isRedactionArmed,
  redactCardText,
  redactToolOutcome,
} from '../src/main/payment/redact';

const CARD = { number: '4242424242424242', expMonth: 8, expYear: 2027, cvc: '123', name: 'Ada' };

afterEach(() => disarmRedaction());

describe('redactCardText', () => {
  it('does nothing while disarmed', () => {
    expect(redactCardText('4242424242424242')).toBe('4242424242424242');
    expect(isRedactionArmed()).toBe(false);
  });

  it('masks the number as typed and as forms re-space it', () => {
    armRedaction(CARD);
    expect(redactCardText('e12 | textfield | Card number | =4242424242424242')).not.toContain('4242');
    expect(redactCardText('shows 4242 4242 4242 4242 now')).not.toContain('4242 4242');
    expect(redactCardText('4242-4242-4242-4242')).not.toContain('4242-4242');
  });

  it('masks the expiry in its usual spellings', () => {
    armRedaction(CARD);
    expect(redactCardText('Expiry =08/27')).not.toContain('08/27');
    expect(redactCardText('valid 8/27')).not.toContain('8/27');
    expect(redactCardText('Expiration =08/2027')).not.toContain('2027');
  });

  it('masks the CVC only where it reads as a field value', () => {
    armRedaction(CARD);
    expect(redactCardText('e9 | textfield | CVC | =123')).not.toMatch(/=123\b/);
    // A bare 123 elsewhere is a price or a quantity, not the code.
    expect(redactCardText('123 results for mugs')).toContain('123 results');
  });

  it('masks other card-shaped numbers as a safety net', () => {
    armRedaction(CARD);
    // A different valid PAN on screen (another saved card the form remembers).
    expect(redactCardText('stored card 5555555555554444')).not.toContain('5555555555554444');
    // An order number that fails Luhn stays.
    expect(redactCardText('order 1234567890123456')).toContain('1234567890123456');
  });

  it('leaves unrelated text alone', () => {
    armRedaction(CARD);
    const text = 'Subtotal $84.12 · ships to 123 Main St · window_id 4821';
    expect(redactCardText(text)).toBe(text);
  });
});

describe('redactToolOutcome', () => {
  it('masks text blocks and withholds images while armed', () => {
    armRedaction(CARD);
    const outcome = redactToolOutcome({
      content: [
        { type: 'text', text: 'Card number =4242424242424242' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } },
      ],
    });
    const blocks = outcome.content as Array<{ type: string; text?: string }>;
    expect(blocks.every((block) => block.type === 'text')).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain('4242');
    expect(JSON.stringify(blocks)).toMatch(/withheld/i);
  });

  it('passes outcomes through untouched while disarmed', () => {
    const outcome = { content: 'frame_id f1 (1280x800)' };
    expect(redactToolOutcome(outcome)).toBe(outcome);
  });
});
