import { describe, expect, it } from 'vitest';
import { productLine, type CatalogProduct } from '../src/main/shopify/format';

const product: CatalogProduct = {
  title: 'Trail Runner Pro',
  url: 'https://example-running.myshopify.com/products/trail-runner-pro',
  price_range: {
    min: { amount: 8999, currency: 'USD' },
    max: { amount: 12999, currency: 'USD' },
  },
  variants: [
    {
      price: { amount: 8999, currency: 'USD' },
      availability: { available: true, status: 'in_stock' },
      seller: { name: 'Example Running', domain: 'example-running.myshopify.com' },
    },
  ],
  rating: { value: 4.5, scale_max: 5, count: 120 },
};

describe('catalog product lines', () => {
  it('reads as one line with price range, seller, rating, and the link', () => {
    expect(productLine(product)).toBe(
      '- Trail Runner Pro — $89.99–$129.99 (Example Running, 4.5★ of 120) · https://example-running.myshopify.com/products/trail-runner-pro',
    );
  });

  it('collapses a single-point price range to one figure', () => {
    const single = { ...product, price_range: { min: { amount: 8999, currency: 'USD' }, max: { amount: 8999, currency: 'USD' } } };
    expect(productLine(single)).toContain('— $89.99 (');
    expect(productLine(single)).not.toContain('–$');
  });

  it('survives a sparse product without inventing fields', () => {
    expect(productLine({ title: 'Mystery Item' })).toBe('- Mystery Item');
    expect(productLine({})).toBe('- (untitled)');
  });

  it('spells out non-USD currencies instead of faking a dollar sign', () => {
    const euro = { ...product, price_range: { min: { amount: 5000, currency: 'EUR' } }, rating: undefined, variants: [] };
    expect(productLine(euro)).toContain('50.00 EUR');
    expect(productLine(euro)).not.toContain('$');
  });
});
