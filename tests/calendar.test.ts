import { describe, expect, it } from 'vitest';
import { calendarEvents, calendarLines, calendarWindow } from '../src/main/composio/calendar';

const data = {
  calendars: [
    {
      items: [
        {
          summary: 'Dinner with Sam',
          start: { dateTime: '2026-10-02T19:00:00-04:00' },
          end: { dateTime: '2026-10-02T21:00:00-04:00' },
          location: 'Via Carota',
        },
      ],
    },
    {
      items: [
        { summary: 'Halloween', start: { date: '2026-10-31' } },
        { summary: 'Standup', start: { dateTime: '2026-09-28T09:00:00-04:00' }, location: 'https://zoom.us/j/1' },
        { summary: 'Heads down', eventType: 'focusTime', start: { dateTime: '2026-09-28T13:00:00-04:00' }, end: { dateTime: '2026-09-28T15:00:00-04:00' } },
        { summary: 'Home', eventType: 'workingLocation', start: { date: '2026-09-28' } },
        { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-09-29T09:00:00-04:00' } },
      ],
    },
  ],
};

describe('calendarLines', () => {
  it('lists plans soonest first across calendars and leaves out status blocks', () => {
    const lines = calendarLines(data, 10);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Standup');
    expect(lines[1]).toContain('Dinner with Sam · Via Carota');
    expect(lines[2]).toContain('Halloween');
    expect(calendarLines(data, 1)).toHaveLength(1);
  });
});

describe('calendarEvents', () => {
  it('keeps ends, places, and focus blocks; a link is not a place', () => {
    const events = calendarEvents(data);
    expect(events.map((event) => event.title)).toEqual(['Standup', 'Heads down', 'Dinner with Sam', 'Halloween']);
    const [standup, focus, dinner, halloween] = events;
    expect(standup!.place).toBe('');
    expect(standup!.end - standup!.start).toBe(60 * 60_000); // no end given: an hour
    expect(focus!.kind).toBe('focus');
    expect(dinner!.place).toBe('Via Carota');
    expect(dinner!.end - dinner!.start).toBe(2 * 60 * 60_000);
    expect(halloween!.allDay).toBe(true);
    expect(halloween!.end - halloween!.start).toBe(24 * 60 * 60_000);
  });

  it('asks for local midnight through the window, with the offset', () => {
    const window = calendarWindow(14, new Date(2026, 8, 27, 13, 0));
    expect(window.time_min).toMatch(/^2026-09-27T00:00:00[+-]\d\d:\d\d$/);
    expect(window.time_max).toMatch(/^2026-10-11T00:00:00[+-]\d\d:\d\d$/);
  });
});
