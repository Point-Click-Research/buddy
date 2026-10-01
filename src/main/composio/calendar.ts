// Google Calendar events, read into one shape for the morning suggestions
// (as prompt lines) and the moment watcher (with ends, places, and the focus
// and away blocks that mean quiet). Pure: apps.ts fetches, this reads
// whatever shape the toolkit returned.

import type { MomentEvent } from '../../shared/moments';

interface CalendarEvent {
  summary?: string;
  title?: string;
  location?: string;
  status?: string;
  eventType?: string;
  event_type?: string;
  start?: { dateTime?: string; date?: string } | string;
  start_time?: string;
  end?: { dateTime?: string; date?: string } | string;
  end_time?: string;
}

/** Event types that are status, not plans: a focus block, a day away. Working location says nothing about the day. */
const BLOCK_KINDS: Record<string, MomentEvent['kind'] | undefined> = {
  focusTime: 'focus',
  outOfOffice: 'away',
};
const ONE_HOUR = 60 * 60_000;

/** From local midnight today through `days` ahead, as RFC3339 with this Mac's offset. */
export function calendarWindow(days: number, now = new Date()): { time_min: string; time_max: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { time_min: rfc3339(start), time_max: rfc3339(end) };
}

/**
 * Every plan, focus block, and day away in the response, soonest first, each
 * once. Cancelled events and working-location markers are left out.
 */
export function calendarEvents(data: unknown): MomentEvent[] {
  const raw: CalendarEvent[] = [];
  collectEvents(data, raw, 0);
  const seen = new Set<string>();
  const events: MomentEvent[] = [];
  for (const event of raw) {
    const type = event.eventType ?? event.event_type ?? '';
    if (event.status === 'cancelled' || type === 'workingLocation') continue;
    const title = (event.summary || event.title || '').trim();
    const start = eventStart(event);
    if (!title || !start) continue;
    const key = `${start.at.getTime()} ${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const location = event.location?.trim() ?? '';
    events.push({
      title,
      start: start.at.getTime(),
      end: eventEnd(event, start),
      allDay: start.allDay,
      // A link is where the call is, not somewhere to go.
      place: /^https?:\/\//i.test(location) ? '' : location,
      kind: BLOCK_KINDS[type] ?? 'plan',
    });
  }
  return events.sort((a, b) => a.start - b.start);
}

/** "- Fri, Oct 2, 7:00 PM — Dinner with Sam · Via Carota" lines for the plans, soonest first, at most `limit`. */
export function calendarLines(data: unknown, limit: number): string[] {
  return calendarEvents(data)
    .filter((event) => event.kind === 'plan')
    .slice(0, limit)
    .map((event) => {
      const at = new Date(event.start);
      const when = event.allDay
        ? at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : at.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      return `- ${when} — ${event.title}${event.place ? ` · ${event.place}` : ''}`;
    });
}

/** Every object with a title and a start, wherever the response nests them. */
function collectEvents(value: unknown, out: CalendarEvent[], depth: number): void {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectEvents(item, out, depth + 1);
    return;
  }
  const record = value as CalendarEvent & Record<string, unknown>;
  const titled = typeof record.summary === 'string' || typeof record.title === 'string';
  if (titled && (record.start || record.start_time)) {
    out.push(record);
    return;
  }
  for (const nested of Object.values(record)) collectEvents(nested, out, depth + 1);
}

function eventStart(event: CalendarEvent): { at: Date; allDay: boolean } | null {
  return eventTime(event.start, event.start_time);
}

/** The end as given; an all-day event ends at the next midnight, a timed one without an end an hour on. */
function eventEnd(event: CalendarEvent, start: { at: Date; allDay: boolean }): number {
  const parsed = eventTime(event.end, event.end_time);
  if (parsed && parsed.at.getTime() > start.at.getTime()) return parsed.at.getTime();
  if (start.allDay) {
    const midnight = new Date(start.at);
    midnight.setDate(midnight.getDate() + 1);
    return midnight.getTime();
  }
  return start.at.getTime() + ONE_HOUR;
}

function eventTime(
  value: CalendarEvent['start'],
  fallback: string | undefined,
): { at: Date; allDay: boolean } | null {
  const date = typeof value === 'object' ? value.date : undefined;
  const allDay = Boolean(date) && !(typeof value === 'object' && value.dateTime);
  // An all-day date is a local day; "2026-10-31" alone would parse as UTC midnight.
  const raw = typeof value === 'string' ? value : (value?.dateTime ?? fallback ?? (date ? `${date}T00:00:00` : ''));
  const at = new Date(raw);
  return raw && !Number.isNaN(at.getTime()) ? { at, allDay } : null;
}

function rfc3339(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const abs = Math.abs(offset);
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${zone}`;
}
