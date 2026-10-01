// When the Suggestions batch is due: once a day at a chosen hour, twice a
// day, or once at an hour Buddy picks for the day. And what the plan allows:
// Free's cost guard covers a month, so it gets one pass a day and never runs
// a suggestion unasked. Pure: main/jobs/ideas.ts reads the clock and the
// store; the tests call these directly.

import { isPaidPlan, type PlanId } from './contracts';

export const SUGGESTION_TIMES = [
  { id: 'morning', label: 'Every morning (9 AM)', hours: [9] },
  { id: 'midday', label: 'Midday (12 PM)', hours: [12] },
  { id: 'afternoon', label: 'Afternoon (4 PM)', hours: [16] },
  { id: 'evening', label: 'Evening (6 PM)', hours: [18] },
  { id: 'twice', label: 'Twice a day (9 AM and 6 PM)', hours: [9, 18] },
  { id: 'random', label: 'Once a day, at random', hours: [] },
] as const;

export type SuggestionTimeId = (typeof SUGGESTION_TIMES)[number]['id'];

export function isSuggestionTimeId(value: unknown): value is SuggestionTimeId {
  return SUGGESTION_TIMES.some((time) => time.id === value);
}

/** The When choices on this plan: Free has no second pass. */
export function suggestionTimesFor(plan: PlanId | null): readonly (typeof SUGGESTION_TIMES)[number][] {
  return plan === 'free' ? SUGGESTION_TIMES.filter((time) => time.id !== 'twice') : SUGGESTION_TIMES;
}

/** The When that runs on this plan. Free keeps the morning of a saved twice a day; the setting itself is left for a later plan. */
export function suggestionTimeFor(time: SuggestionTimeId, plan: PlanId | null): SuggestionTimeId {
  return time === 'twice' && plan === 'free' ? 'morning' : time;
}

/**
 * How many safe suggestions a batch may run unasked: every one on their own
 * OpenRouter key and on the launch plans, none on Free, the first on a paid
 * plan billing Buddy.
 */
export function autoRunCap(plan: PlanId | null, ownOpenRouterKey: boolean): number {
  if (ownOpenRouterKey) return Infinity;
  if (plan === 'free') return 0;
  if (isPaidPlan(plan)) return 1;
  return Infinity;
}

/** The random slot lands in the waking day. */
export const RANDOM_HOURS = { min: 8, max: 20 } as const;

export function pickRandomHour(random: () => number = Math.random): number {
  return RANDOM_HOURS.min + Math.floor(random() * (RANDOM_HOURS.max - RANDOM_HOURS.min + 1));
}

/** Today's slots. Random asks for the day's hour only when it is the choice. */
export function slotHours(time: SuggestionTimeId, randomHour: () => number): readonly number[] {
  const found = SUGGESTION_TIMES.find((entry) => entry.id === time);
  return found && found.hours.length > 0 ? found.hours : [randomHour()];
}

/**
 * Due when a slot has passed today and the last run was before it. A slot
 * missed while the Mac slept runs on the next tick; a run after it counts
 * for every slot it passed.
 */
export function suggestionsDue(hours: readonly number[], checkedAt: number, now: Date): boolean {
  return hours.some((hour) => {
    const slot = new Date(now);
    slot.setHours(hour, 0, 0, 0);
    return now.getTime() >= slot.getTime() && checkedAt < slot.getTime();
  });
}
