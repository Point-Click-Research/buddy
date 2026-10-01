import { describe, expect, it } from 'vitest';
import { looksLikeCheckout, looksLikeMacOnly } from '../src/main/agent/checkout-intent';

describe('looksLikeCheckout', () => {
  it('reads buying from the goal or any step', () => {
    expect(looksLikeCheckout('Buy the Harvest & Mill crew socks in Large', [])).toBe(true);
    expect(looksLikeCheckout('Get the socks', ['Open the product page', 'Add to bag', 'Check out as a guest'])).toBe(true);
    expect(looksLikeCheckout('Complete checkout for the tee', [])).toBe(true);
    expect(looksLikeCheckout('Order this one', [])).toBe(true);
    expect(looksLikeCheckout('Fill in payment details and place the order', [])).toBe(true);
  });

  it('leaves the rest of the web alone', () => {
    expect(looksLikeCheckout('Find three linen shirts under $80', ['Search', 'Open the best match'])).toBe(false);
    expect(looksLikeCheckout('Book a table for two on Friday', ['Open the reservation page'])).toBe(false);
    expect(looksLikeCheckout('Organize my Downloads folder', [])).toBe(false);
    // "order" as arrangement, not purchase.
    expect(looksLikeCheckout('Sort the files in date order', [])).toBe(false);
  });
});

describe('looksLikeMacOnly', () => {
  it('reads a Mac app or the computer itself from the goal or a step', () => {
    expect(looksLikeMacOnly('Add a circle to the canvas in Figma', [])).toBe(true);
    expect(looksLikeMacOnly('Tidy up', ['Open Finder', 'Move last month out of Downloads folder'])).toBe(true);
    expect(looksLikeMacOnly('Do this on my Mac', ['Click the button in System Settings'])).toBe(true);
  });

  it('leaves a website as a page Buddy\'s browser could open, even one named like an app', () => {
    expect(looksLikeMacOnly('Book a table for two on Friday', ['Open the reservation page'])).toBe(false);
    expect(looksLikeMacOnly('Duplicate the file', ['Open figma.com', 'Find the Buddy canvas'])).toBe(false);
    expect(looksLikeMacOnly('Read this tab', ['It is open in Safari'])).toBe(false);
  });
});
