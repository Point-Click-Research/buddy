import { describe, expect, it } from 'vitest';
import { ideaMessage } from '../src/shared/jobs';
import { plainText } from '../src/main/texts/parse';

describe('ideaMessage', () => {
  it("uses the idea's own text when it has one", () => {
    expect(
      ideaMessage({
        title: 'Email a prep note for the Serende call?',
        blurb: 'Tomorrow at 2:00 PM.',
        message: 'Your Serende call is tomorrow at 2. Want me to put together a quick agenda?',
      }),
    ).toBe('Your Serende call is tomorrow at 2. Want me to put together a quick agenda?');
  });

  it('otherwise leads with the why-now, then asks', () => {
    expect(ideaMessage({ title: 'Book a car to SoHo?', blurb: "Your 3pm is in 20 min, and you're still at the Mac." })).toBe(
      "Your 3pm is in 20 min, and you're still at the Mac. Book a car to SoHo?",
    );
  });
});

describe('plainText', () => {
  it('never lets an em dash go out in a text', () => {
    expect(plainText('Halloween is Oct 31 — still time to sew it.')).toBe('Halloween is Oct 31, still time to sew it.');
  });
});
