// Dates people plan around, so a suggestions run can offer something before
// the day arrives even when no holiday calendar is connected. US dates.
// Pure: the prompt and tests both call this.

/** How far ahead a date still counts as coming up. */
export const OCCASION_WINDOW_DAYS = 45;

interface Occasion {
  at: Date;
  name: string;
}

/** "Fri, Oct 31 — Halloween" lines from today through the window, soonest first. */
export function upcomingOccasions(now = new Date(), withinDays = OCCASION_WINDOW_DAYS): string[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + withinDays);
  const found: Occasion[] = [];
  for (const year of [start.getFullYear(), start.getFullYear() + 1]) {
    for (const occasion of occasions(year)) {
      if (occasion.at >= start && occasion.at < end) found.push(occasion);
    }
  }
  found.sort((a, b) => a.at.getTime() - b.at.getTime());
  return found.map(
    (occasion) =>
      `${occasion.at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — ${occasion.name}`,
  );
}

function occasions(year: number): Occasion[] {
  const on = (month: number, day: number, name: string): Occasion => ({
    at: new Date(year, month, day),
    name,
  });
  return [
    on(0, 1, "New Year's Day"),
    on(1, 14, "Valentine's Day"),
    { at: nthWeekday(year, 4, 0, 2), name: "Mother's Day" },
    { at: lastWeekday(year, 4, 1), name: 'Memorial Day' },
    { at: nthWeekday(year, 5, 0, 3), name: "Father's Day" },
    on(6, 4, 'Independence Day'),
    { at: nthWeekday(year, 8, 1, 1), name: 'Labor Day' },
    on(9, 31, 'Halloween'),
    { at: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving' },
    on(11, 24, 'Christmas Eve'),
    on(11, 25, 'Christmas'),
    on(11, 31, "New Year's Eve"),
  ];
}

/** The nth weekday in a month. weekday: 0 Sunday … 6 Saturday. month: 0–11. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const delta = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + delta + (n - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const delta = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - delta);
}
