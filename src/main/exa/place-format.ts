// Exa's place-search results (restaurants, hotels and rentals), turned into
// one line each. Aggregator listings and repeats are dropped; a place's own
// page is what the user wants to open. Pure module: no Electron, no network.

import { productLine } from '../product-line';
import { parseSummary, text, type ExaResult } from './format';

/** What Exa is asked to pull off a restaurant page. Price is a tier, never a number. */
export const DINING_SUMMARY_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Restaurant',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The restaurant name.' },
    cuisine: { type: 'string', description: 'The kind of food, in a word or two ("Italian", "omakase", "wine bar").' },
    area: { type: 'string', description: 'Neighborhood and city ("West Village, New York").' },
    priceTier: { type: 'string', description: 'One of $, $$, $$$, $$$$ when the page or its style makes it clear.' },
    reservationUrl: { type: 'string', description: 'Where to book (Resy, OpenTable, Tock, or the page itself), if shown.' },
  },
  required: ['name'],
} as const;

/** What Exa is asked to pull off a hotel or rental page. Rates depend on dates, so none are asked for. */
export const LODGING_SUMMARY_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Lodging',
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The hotel, inn, or rental name.' },
    kind: { type: 'string', description: 'Hotel, boutique hotel, inn, rental, cabin, or similar.' },
    area: { type: 'string', description: 'Neighborhood or town and region ("Sonoma, California").' },
    style: { type: 'string', description: 'The feel in a few words ("modern, rooftop pool", "historic, fireplaces").' },
  },
  required: ['name'],
} as const;

export interface Place {
  name: string;
  url: string;
  /** Cuisine for dining, kind for lodging. */
  kind?: string;
  area?: string;
  /** $–$$$$ for dining; lodging carries no price. */
  priceTier?: string;
  style?: string;
  reservationUrl?: string;
  image?: string;
}

/**
 * Directory and booking-engine pages list many places; only a place's own
 * page is one place. Yelp, TripAdvisor and friends are dropped outright.
 */
const AGGREGATOR = /(^|\.)(yelp|tripadvisor|opentable|resy|booking|expedia|hotels|kayak|trivago|airbnb|vrbo|google|eater|timeout|thrillist|infatuation)\.(com|co|net|org)$/i;
const LISTING_PATH = /\/(search|s|explore|best|top|list|guide|neighborhoods?|category|c)(\/|\?|$)|[?&](q|query|find_desc|location)=/i;

export function isAggregatorPage(url: string): boolean {
  try {
    const { hostname, pathname, search } = new URL(url);
    return AGGREGATOR.test(hostname.replace(/^www\./, '')) || LISTING_PATH.test(pathname + search);
  } catch {
    return true;
  }
}

export function toPlace(result: ExaResult): Place | null {
  if (!result.url || isAggregatorPage(result.url)) return null;
  const summary = parseSummary(result.summary);
  const name = text(summary['name']) || result.title?.trim();
  if (!name) return null;
  const tier = text(summary['priceTier']);
  return {
    name,
    url: result.url,
    kind: text(summary['cuisine']) ?? text(summary['kind']),
    area: text(summary['area']),
    priceTier: tier && /^\${1,4}$/.test(tier) ? tier : undefined,
    style: text(summary['style']),
    reservationUrl: text(summary['reservationUrl']),
    image: result.image,
  };
}

/** Aggregators and repeats gone, best-ranked first, at most `limit`. */
export function pickPlaces(results: ExaResult[], limit: number): Place[] {
  const seen = new Set<string>();
  const picks: Place[] = [];
  for (const result of results) {
    const place = toPlace(result);
    if (!place) continue;
    const key = new URL(place.url).hostname.replace(/^www\./, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push(place);
    if (picks.length === limit) break;
  }
  return picks;
}

/** "- Name — $$ (Italian, West Village, book: https://…, photo: https://…) · https://…" */
export function placeLine(place: Place): string {
  return productLine({
    title: place.name,
    price: place.priceTier,
    extras: [
      place.kind,
      place.area,
      place.style,
      place.reservationUrl ? `book: ${place.reservationUrl}` : undefined,
      place.image ? `photo: ${place.image}` : undefined,
    ],
    url: place.url,
  });
}
