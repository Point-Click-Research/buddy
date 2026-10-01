// The confirmation card for a tool call, in plain language: "Create call
// with Buddy's Phone?" over what it does. That is the model's own one-line
// summary when it gave one, else the arguments as labelled lines, never raw
// JSON and never the ids and tokens that mean nothing to a person. Shared by
// MCP servers and Composio apps. Pure module.

import { mcpServerLabel, type ConfirmCard } from '../../shared/types';

/** The card clips long argument lists; the model keeps the full set. */
const DETAIL_LIMIT = 700;
/** One value's share of the card (a call's task prompt can run long). */
const VALUE_LIMIT = 200;
/** Past this many, a list reads as its count: 58 message ids tell the user nothing. */
const LIST_LIMIT = 5;

export function toolConfirmCard(app: string, tool: string, args: unknown, summary = ''): ConfirmCard {
  const detail = summary || describeArgs(args);
  return {
    title: `${sentence(humanize(tool))} with ${mcpServerLabel({ name: app })}?`,
    detail: detail.length > DETAIL_LIMIT ? `${detail.slice(0, DETAIL_LIMIT)}…` : detail,
  };
}

/** "create_call", "SEND_EMAIL", "createCall" → "create call". */
export function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Arguments as "**Label**: value" lines (the card renders markdown). Empty
 * values are left out; nested objects indent under their label.
 */
export function describeArgs(args: unknown, indent = ''): string {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args)
    .filter(([key, value]) => value !== null && value !== undefined && value !== '' && !isIdentifier(key, value))
    .map(([key, value]) => {
      const label = `${indent}**${sentence(humanize(key))}**`;
      return typeof value === 'object' && !flatArray(value)
        ? `${label}\n${describeArgs(value, `${indent}    `)}`
        : `${label}: ${formatValue(value)}`;
    })
    .join('\n');
}

/** An id field ("event_id", "calendarId", "message_ids"), or a value that is only a machine token. */
const ID_KEY = /(?:^|[_\s-])ids?$|[a-z]Ids?$/;
const TOKEN = /^(?=.*\d)(?=.*[a-z])[A-Za-z0-9_-]{16,}$/i;

function isIdentifier(key: string, value: unknown): boolean {
  if (ID_KEY.test(key)) return true;
  return typeof value === 'string' && TOKEN.test(value.trim());
}

function flatArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null);
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.length > LIST_LIMIT ? `${value.length} items` : value.map(formatValue).join(', ');
  }
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > VALUE_LIMIT ? `${text.slice(0, VALUE_LIMIT)}…` : text;
}

function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
