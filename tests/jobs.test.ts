import { describe, expect, it } from 'vitest';
import {
  JOB_SCHEDULE_PRESETS,
  JOB_TEMPLATES,
  clockSchedule,
  clockScheduleId,
  isJobScheduleId,
  parseSchedule,
  MAX_RETRIES,
  NEVER,
  RETRY_MS,
  matchJob,
  retryAt,
  nextRun,
  scheduleLabel,
  templateChecks,
  isRepeatedSuggestion,
  isSafeIdea,
  jobNeeds,
  sameProduct,
  sameSuggestion,
} from '../src/shared/jobs';
import type { UseCaseSnap } from '../src/shared/use-cases';

/** Tue Mar 10 2026, 10:30 local. */
const tuesday = new Date(2026, 2, 10, 10, 30);

// "Do safe suggestions without asking" must never spend, book, call, or text on its own.
describe('isSafeIdea', () => {
  it('lets picks and mail drafts run; everything that spends, sends, or repeats waits', () => {
    expect(isSafeIdea({ kind: 'discover' })).toBe(true);
    expect(isSafeIdea({ kind: 'email' })).toBe(true);
    // A recurring idea installs a job: a standing commitment nobody said yes to.
    expect(isSafeIdea({ kind: 'email', schedule: 'daily-9' })).toBe(false);
    for (const kind of ['purchase', 'book', 'call', 'text'] as const) expect(isSafeIdea({ kind })).toBe(false);
  });
});

describe('nextRun', () => {
  it('interval schedules count from now', () => {
    expect(nextRun('every-15m', tuesday)).toBe(tuesday.getTime() + 15 * 60_000);
    expect(nextRun('every-1h', tuesday)).toBe(tuesday.getTime() + 60 * 60_000);
    expect(nextRun('every-6h', tuesday)).toBe(tuesday.getTime() + 6 * 60 * 60_000);
  });

  it('daily fires later today when the hour is still ahead', () => {
    const next = new Date(nextRun('daily-18', tuesday));
    expect(next.getDate()).toBe(10);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(0);
  });

  it('daily rolls to tomorrow when the hour has passed', () => {
    const next = new Date(nextRun('daily-9', tuesday));
    expect(next.getDate()).toBe(11);
    expect(next.getHours()).toBe(9);
  });

  it('keeps the minute the user asked for', () => {
    // 10:30 exactly is not after 10:30; 10:45 today is.
    expect(new Date(nextRun('daily-10:30', tuesday)).getDate()).toBe(11);
    const next = new Date(nextRun('weekdays-10:45', tuesday));
    expect(next.getDate()).toBe(10);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(45);
    expect(new Date(nextRun('monthly-15-18:05', tuesday)).getMinutes()).toBe(5);
  });

  it('weekdays skips the weekend', () => {
    const friday = new Date(2026, 2, 13, 10, 0); // Fri Mar 13, past 9
    const next = new Date(nextRun('weekdays-9', friday));
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
  });

  it('weekly lands on the next Monday at 9', () => {
    const next = new Date(nextRun('weekly-1-9', tuesday));
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(16);
    expect(next.getHours()).toBe(9);
    // Monday morning before 9 is still today.
    const monday = new Date(2026, 2, 16, 8, 0);
    expect(new Date(nextRun('weekly-1-9', monday)).getDate()).toBe(16);
  });

  it('monthly lands on the 1st at 9, across the month boundary', () => {
    const next = new Date(nextRun('monthly-1-9', tuesday));
    expect(next.getMonth()).toBe(3); // April
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(9);
  });

  it('on-demand is never due, with a value JSON keeps', () => {
    expect(nextRun('on-demand', tuesday)).toBe(NEVER);
    expect(JSON.parse(JSON.stringify({ at: NEVER })).at).toBe(NEVER);
  });

  it('an overdue job catches up once: the next slot is always in the future', () => {
    // A Mac asleep for three days wakes with nextRunAt long past; computing
    // from now (not the missed slot) means one run, then a full wait.
    for (const id of JOB_SCHEDULE_PRESETS) {
      expect(nextRun(id, tuesday)).toBeGreaterThan(tuesday.getTime());
    }
  });
});

describe('retryAt', () => {
  it('tries a failed run again shortly instead of losing the slot', () => {
    // The 9 AM run died when the Mac slept at 9:00; waking at 9:40 finds it due.
    const nine = new Date(2026, 2, 10, 9, 0);
    expect(retryAt('daily-9', nine, 1)).toBe(nine.getTime() + RETRY_MS);
  });

  it('never retries past the next scheduled slot', () => {
    // Failed at 8:55: the 9:00 slot comes before a 9:05 retry would.
    const early = new Date(2026, 2, 10, 8, 55);
    expect(retryAt('daily-9', early, 1)).toBe(new Date(2026, 2, 10, 9, 0).getTime());
  });

  it('gives up after a few failures in a row, and on-demand jobs wait to be asked', () => {
    expect(retryAt('daily-9', tuesday, MAX_RETRIES + 1)).toBe(nextRun('daily-9', tuesday));
    expect(retryAt('on-demand', tuesday, 1)).toBe(NEVER);
  });
});

describe('matchJob', () => {
  const jobs = [{ name: 'Paper towels' }, { name: 'Toilet paper' }, { name: 'Daily email brief' }];

  it('takes the exact name, then the job sharing the most words', () => {
    expect(matchJob('Toilet paper', jobs)?.name).toBe('Toilet paper');
    expect(matchJob('run my paper towels job', jobs)?.name).toBe('Paper towels');
    expect(matchJob('do the email brief now', jobs)?.name).toBe('Daily email brief');
  });

  it('refuses a tie or a miss instead of guessing', () => {
    expect(matchJob('paper', jobs)).toBeNull(); // both paper jobs tie
    expect(matchJob('the price check', jobs)).toBeNull();
  });
});

describe('schedules and templates', () => {
  it('every schedule has a label, with the time as asked', () => {
    for (const id of JOB_SCHEDULE_PRESETS) {
      expect(scheduleLabel(id)).not.toBe(id);
    }
    expect(scheduleLabel('daily-9')).toBe('Every day at 9:00 AM');
    expect(scheduleLabel('daily-10:30')).toBe('Every day at 10:30 AM');
    expect(scheduleLabel('weekly-1-9')).toBe('Every Monday at 9:00 AM');
    expect(scheduleLabel('monthly-22-18:15')).toBe('Monthly on the 22nd at 6:15 PM');
  });

  it('reads any clock time and refuses what is not a schedule', () => {
    expect(parseSchedule('daily-10:30')).toEqual({ kind: 'daily', hour: 10, minute: 30 });
    expect(parseSchedule('weekly-5-7')).toEqual({ kind: 'weekly', day: 5, hour: 7, minute: 0 });
    expect(clockScheduleId({ kind: 'monthly', day: 1, hour: 9, minute: 5 })).toBe('monthly-1-9:05');
    // Switching cadence keeps the time and only the day that applies.
    expect(clockScheduleId(clockSchedule('daily', { day: 3, hour: 7, minute: 30 }))).toBe('daily-7:30');
    expect(clockScheduleId(clockSchedule('weekly', { hour: 7, minute: 30 }))).toBe('weekly-1-7:30');
    for (const bad of ['daily', 'daily-25', 'daily-9:60', 'weekly-9', 'weekly-7-9', 'monthly-0-9', 'hourly-9', 9]) {
      expect(isJobScheduleId(bad)).toBe(false);
    }
  });

  it('every template uses a known schedule and has needs to render', () => {
    for (const template of JOB_TEMPLATES) {
      expect(isJobScheduleId(template.schedule)).toBe(true);
      expect(template.prompt.length).toBeGreaterThan(0);
    }
  });

  it('the outing and ride templates carry their needs in their own words', () => {
    for (const id of ['weekly-outing', 'ride-to-plans']) {
      const template = JOB_TEMPLATES.find((entry) => entry.id === id)!;
      expect(jobNeeds(template.prompt)).toEqual(template.needs);
    }
  });
});

const snap = (overrides: Partial<UseCaseSnap>): UseCaseSnap => ({
  disabledBuiltinTools: [],
  screenAwareness: false,
  marksEnabled: false,
  agentModeEnabled: false,
  servers: [],
  hasCard: false,
  shopifyKey: false,
  shipping: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address1: '',
    city: '',
    province: '',
    postalCode: '',
  },
  connectedApps: [],
  ...overrides,
});

describe('sameSuggestion', () => {
  it('treats a reworded pick as the same suggestion', () => {
    expect(sameSuggestion('Order the Therabody WaveSolo for Cam', 'Buy the Therabody WaveSolo for Cam')).toBe(true);
    expect(sameSuggestion('Watch for new Veja Esplar colorways', 'See new Veja Esplar colorways')).toBe(true);
  });

  it('catches a rewording through what the idea is about', () => {
    const earlier = [{ title: 'Grab groceries for the week?', about: 'order weekly groceries instacart' }];
    expect(isRepeatedSuggestion({ title: 'Restock the fridge before Sunday?', about: 'order groceries instacart' }, earlier)).toBe(true);
    expect(isRepeatedSuggestion({ title: 'Restock the fridge before Sunday?', about: 'book table friday dinner' }, earlier)).toBe(false);
    // Without the key, titles alone decide, as before.
    expect(isRepeatedSuggestion({ title: 'Restock the fridge before Sunday?' }, earlier)).toBe(false);
  });

  it('keeps different products apart', () => {
    expect(sameSuggestion('Anne Satin Coat for Amanda', 'Marc Fisher Itzia bootie, navy suede')).toBe(false);
    expect(sameSuggestion('Anne Satin Coat for Amanda', 'Anne Satin Dress for Amanda')).toBe(false);
    // The opening verb and a person are not a product.
    expect(sameSuggestion('Buy Zach the Larroudé George Sneaker', 'Buy Zach the Taylor Stitch sweater')).toBe(false);
    expect(sameSuggestion('Order the Larroudé George Sneaker', 'Buy Zach the Larroudé George Sneaker')).toBe(true);
  });

  it('treats the same product page as a repeat even when the title changed', () => {
    expect(sameProduct('https://shop.example/wave?ref=1', 'https://shop.example/wave')).toBe(true);
    expect(sameProduct('https://shop.example/a', 'https://shop.example/b')).toBe(false);
    expect(
      isRepeatedSuggestion(
        { title: 'In black this time', url: 'https://shop.example/wave' },
        [{ title: 'Order the Therabody WaveSolo for Cam', url: 'https://shop.example/wave?ref=1' }],
      ),
    ).toBe(true);
  });
});

describe('templateChecks', () => {
  it('search is unmet with no server, met with a connected one', () => {
    const missing = templateChecks(['search'], snap({}));
    expect(missing).toHaveLength(1);
    expect(missing[0]!.ok).toBe(false);
    // Search comes with Buddy: there is nothing to set up, so no fix.
    expect(missing[0]!.fix).toBeNull();

    const ready = templateChecks(
      ['search'],
      snap({ servers: [{ name: 'Exa', url: 'https://mcp.exa.ai/mcp', enabled: true, status: 'connected' }] }),
    );
    expect(ready[0]!.ok).toBe(true);
    expect(ready[0]!.fix).toBeNull();
  });

  it('app needs read the connected slugs', () => {
    expect(templateChecks(['app:gmail'], snap({}))[0]!.ok).toBe(false);
    const ready = templateChecks(['app:gmail'], snap({ connectedApps: ['gmail'] }))[0]!;
    expect(ready.ok).toBe(true);
    expect(ready.label).toBe('Gmail');
  });

  it('checkout is the whole Purchase checklist, every missing row with a Settings page', () => {
    const rows = templateChecks(['checkout'], snap({}));
    expect(rows.map((row) => row.label)).toEqual(['Payment card', 'Shipping address', 'Computer use']);
    for (const row of rows) expect(row.fix).not.toBeNull();
  });

  it('a signed-in store needs that account in Buddy\'s browser, not a saved card', () => {
    const labels = (prompt: string): string[] =>
      templateChecks(jobNeeds(prompt, ['checkout']), snap({})).map((row) => row.label);
    expect(labels('Reorder 1 of paper towels from [Amazon](site:amazon.com). Then buy it.')).toEqual([
      'Amazon account',
      'Computer use',
    ]);
    expect(labels('Reorder paper towels from amazon.com and buy them.')).toEqual(['Amazon account', 'Computer use']);
    expect(labels('Book the cabin on Airbnb for Friday.')).toEqual(['Airbnb account', 'Computer use']);

    const missing = templateChecks(jobNeeds('Reorder from amazon.com.'), snap({}));
    expect(missing[0]).toMatchObject({ label: 'Amazon account', ok: false, fix: { page: 'browser' } });
    const ready = templateChecks(jobNeeds('Reorder from amazon.com.'), snap({ signedInHosts: ['amazon.com'] }));
    expect(ready[0]).toMatchObject({ label: 'Amazon account', ok: true, fix: null });

    expect(labels('Reorder paper towels from the usual store.')).toEqual(['Payment card', 'Shipping address', 'Computer use']);
    expect(labels('Stop if it is above the target price.')).toEqual(['Payment card', 'Shipping address', 'Computer use']);
  });

  it('a blank job reads its needs off the words', () => {
    const needs = jobNeeds(
      'Schedule a date night at a restaurant in West Village. If it does not take OpenTable or Resy reservations, ' +
        'find their phone number and call to book the dinner.',
    );
    expect(needs).toEqual(['site:opentable.com', 'site:resy.com', 'search', 'phone']);
    const labels = templateChecks(needs, snap({})).map((row) => row.label);
    expect(labels).toEqual(['OpenTable account', 'Computer use', 'Resy account', 'Web search', 'Phone calls']);

    expect(jobNeeds('Go through my [Gmail](app:gmail) and draft replies.')).toEqual(['app:gmail']);
    expect(jobNeeds('Add the plan to Notion.')).toEqual(['app:notion']);
    expect(jobNeeds('Say good morning.')).toEqual([]);
  });

  it('phone is the Bland row, included with Buddy', () => {
    expect(templateChecks(['phone'], snap({}))[0]!.fix).toBeNull();
    const ready = templateChecks(
      ['phone'],
      snap({ servers: [{ name: 'bland', url: 'https://api.bland.ai/v1/mcp', enabled: true, status: 'connected' }] }),
    )[0]!;
    expect(ready.ok).toBe(true);
  });
});
