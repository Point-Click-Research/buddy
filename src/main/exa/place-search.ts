// dining_search and lodging_search: a restaurant's or hotel's own page from
// the open web, through Exa steered at that kind of place, with the stable
// facts pulled off it. Nothing date-dependent is asked for: a table or a
// rate for specific dates is the booking step, done in the browser.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { type ToolOutcome, type ToolRegistry, toolArgs } from '../ai/tools';
import { createLogger } from '../log';
import { publishLinks } from '../sources';
import { exaAvailable, exaSearch } from './client';
import { DINING_SUMMARY_SCHEMA, LODGING_SUMMARY_SCHEMA, pickPlaces, placeLine } from './place-format';
import { errorMessage } from '../../shared/errors';

const log = createLogger('exa-places');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
// Aggregator listings and repeats are dropped after the fact, so overfetch.
const OVERFETCH = 3;

interface PlaceKind {
  name: 'dining_search' | 'lodging_search';
  /** Exa's category hint. */
  category: string;
  definition: Tool;
  summaryQuery: string;
  schema: object;
  /** "restaurant pages", for the empty-result line. */
  noun: string;
}

const DINING: PlaceKind = {
  name: 'dining_search',
  category: 'restaurant',
  noun: 'restaurants',
  summaryQuery:
    'The single restaurant this page belongs to: its name, cuisine, neighborhood and city, price tier ($ to $$$$), and where to reserve.',
  schema: DINING_SUMMARY_SCHEMA,
  definition: {
    name: 'dining_search',
    description:
      "Restaurants' own pages, each with cuisine, neighborhood, price tier, and where to reserve. " +
      'Call it for "where should we eat", "find a table", "a good sushi place in…" asks before the web search tool. ' +
      'It finds the place; whether a table is free on a date is the booking step.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What they want, with the place and any taste ("romantic Italian in the West Village, not too loud").',
        },
        limit: { type: 'number', description: `How many restaurants (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
      required: ['query'],
    },
  },
};

const LODGING: PlaceKind = {
  name: 'lodging_search',
  category: 'hotel',
  noun: 'places to stay',
  summaryQuery:
    'The single hotel, inn, or rental this page belongs to: its name, what kind of place it is, its town or neighborhood, and its feel.',
  schema: LODGING_SUMMARY_SCHEMA,
  definition: {
    name: 'lodging_search',
    description:
      "Hotels', inns', and rentals' own pages, each with what kind of place it is, where, and its feel. No rates: those depend on dates, " +
      'so present a pick as somewhere to check for their dates, never with a price. Call it for "where should we stay", ' +
      '"a hotel in…" asks before the web search tool.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What they want, with the place and any taste ("boutique hotel in Lisbon with a rooftop, walkable").',
        },
        limit: { type: 'number', description: `How many places (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).` },
      },
      required: ['query'],
    },
  },
};

export function addPlaceSearchTools(registry: ToolRegistry): void {
  if (!exaAvailable()) return;
  for (const kind of [DINING, LODGING]) {
    registry.set(kind.name, {
      definition: kind.definition,
      execute: (input, signal) => searchPlaces(kind, input, signal),
    });
  }
}

async function searchPlaces(kind: PlaceKind, input: unknown, signal: AbortSignal): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  if (!query) return { content: `${kind.name} needs a query.`, isError: true };
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(args['limit']) || DEFAULT_LIMIT));

  try {
    const results = await exaSearch(
      {
        query,
        category: kind.category,
        numResults: limit * OVERFETCH,
        summary: { query: kind.summaryQuery, schema: kind.schema },
      },
      signal,
    );
    const places = pickPlaces(results, limit);
    if (places.length === 0) {
      return { content: `No ${kind.noun} matched "${query}". Try the web search tool instead.` };
    }
    publishLinks(places.map((place) => place.url).join('\n'));
    return { content: `${kind.noun[0]!.toUpperCase()}${kind.noun.slice(1)} for "${query}":\n${places.map(placeLine).join('\n')}` };
  } catch (error) {
    if (signal.aborted) return { content: 'Cancelled.', isError: true };
    const detail = errorMessage(error);
    log.warn(`${kind.name} failed: ${detail}`);
    return { content: `${kind.name} failed: ${detail}`, isError: true };
  }
}
