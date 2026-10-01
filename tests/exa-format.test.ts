import { describe, expect, it } from 'vitest';
import { isListingPage, pickWebProducts, toWebProduct, webProductLine, type ExaProductResult } from '../src/main/exa/format';

const belt: ExaProductResult = {
  title: 'Brown Leather Belt | Example Co',
  url: 'https://example.com/products/brown-leather-belt?variant=1',
  image: 'https://cdn.example.com/belt.jpg',
  summary: JSON.stringify({ name: 'Brown Leather Belt', price: 68, currency: 'usd', seller: 'Example Co', inStock: true }),
};

describe('exa product lines', () => {
  it('reads as one line with the summary name, price, seller, photo, and link', () => {
    expect(webProductLine(toWebProduct(belt)!)).toBe(
      '- Brown Leather Belt — $68.00 (Example Co, photo: https://cdn.example.com/belt.jpg) · https://example.com/products/brown-leather-belt?variant=1',
    );
  });

  it('falls back to the page title when the summary is missing or malformed', () => {
    expect(toWebProduct({ url: belt.url, title: 'Belt', summary: 'not json' })).toMatchObject({ title: 'Belt', price: undefined });
    expect(webProductLine(toWebProduct({ url: belt.url, title: 'Belt' })!)).toBe(`- Belt · ${belt.url}`);
  });

  it('drops search-results and listing pages, never a product page', () => {
    expect(isListingPage('https://www.amazon.com/s?k=leather+belt')).toBe(true);
    expect(isListingPage('https://www.nordstrom.com/browse/men/accessories')).toBe(true);
    expect(isListingPage('https://shop.example.com/collections/belts')).toBe(true);
    expect(isListingPage('https://www.example.com/')).toBe(true);
    expect(isListingPage('https://www.amazon.com/dp/B0EXAMPLE')).toBe(false);
    expect(isListingPage('https://example.com/products/brown-leather-belt')).toBe(false);
  });

  it('applies the price cap, skips out-of-stock, dedupes by page, and stops at the limit', () => {
    const results: ExaProductResult[] = [
      belt,
      { ...belt, url: 'https://example.com/products/brown-leather-belt/' },
      { ...belt, url: 'https://example.com/products/pricey', summary: JSON.stringify({ name: 'Pricey', price: 120 }) },
      { ...belt, url: 'https://example.com/products/gone', summary: JSON.stringify({ name: 'Gone', price: 20, inStock: false }) },
      { ...belt, url: 'https://example.com/products/second', summary: JSON.stringify({ name: 'Second', price: 40 }) },
      { ...belt, url: 'https://example.com/products/third', summary: JSON.stringify({ name: 'Third', price: 40 }) },
    ];
    expect(pickWebProducts(results, 2, 80).map((product) => product.title)).toEqual(['Brown Leather Belt', 'Second']);
  });
});
