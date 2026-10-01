import { describe, expect, it } from 'vitest';
import { isAggregatorPage, pickPlaces, placeLine, toPlace } from '../src/main/exa/place-format';
import type { ExaResult } from '../src/main/exa/format';

const own: ExaResult = {
  title: 'Via Carota',
  url: 'https://www.viacarota.com/',
  image: 'https://www.viacarota.com/photo.jpg',
  summary: JSON.stringify({
    name: 'Via Carota',
    cuisine: 'Italian',
    area: 'West Village, New York',
    priceTier: '$$$',
    reservationUrl: 'https://resy.com/cities/ny/via-carota',
  }),
};

describe('place search formatting', () => {
  it('drops aggregators and listing pages, keeps a place\'s own page', () => {
    expect(isAggregatorPage('https://www.yelp.com/biz/via-carota-new-york')).toBe(true);
    expect(isAggregatorPage('https://www.tripadvisor.com/Restaurant_Review-g60763')).toBe(true);
    expect(isAggregatorPage('https://resy.com/cities/ny/via-carota')).toBe(true);
    expect(isAggregatorPage('https://ny.eater.com/maps/best-west-village-restaurants')).toBe(true);
    expect(isAggregatorPage('https://www.somehotel.com/search?location=lisbon')).toBe(true);
    expect(isAggregatorPage('https://www.viacarota.com/')).toBe(false);
    expect(isAggregatorPage('https://www.thehoxton.com/lisbon/')).toBe(false);
  });

  it('reads the summary and keeps only a real price tier', () => {
    const place = toPlace(own);
    expect(place).toMatchObject({ name: 'Via Carota', kind: 'Italian', area: 'West Village, New York', priceTier: '$$$' });
    const odd = toPlace({ ...own, summary: JSON.stringify({ name: 'X', priceTier: '$45 a head' }) });
    expect(odd?.priceTier).toBeUndefined();
  });

  it('dedupes by site and caps the list', () => {
    const picks = pickPlaces(
      [own, { ...own, url: 'https://viacarota.com/menu' }, { url: 'https://www.yelp.com/biz/x', title: 'X' }, { url: 'https://www.lartusi.com/', title: "L'Artusi" }],
      5,
    );
    expect(picks.map((place) => place.name)).toEqual(['Via Carota', "L'Artusi"]);
  });

  it('renders the same one-line shape as a product', () => {
    expect(placeLine(toPlace(own)!)).toBe(
      '- Via Carota — $$$ (Italian, West Village, New York, book: https://resy.com/cities/ny/via-carota, photo: https://www.viacarota.com/photo.jpg) · https://www.viacarota.com/',
    );
  });
});
