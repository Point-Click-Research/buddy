// How the account reads (name, plan, today's talk and tasks), for the
// Account page and the chat window's account bar.

import { PLAN_NAMES, isPaidPlan, type Meter, type PlanId } from '../../shared/contracts';
import type { AccountView } from '../../shared/types';

/** "Zach Ryan", or '' before they have given a name. */
export function fullName(view: AccountView): string {
  return [view.firstName, view.lastName].filter(Boolean).join(' ');
}

/** The email as is; a US phone number Supabase stores bare ("2035550123") as "(203) 555-0123". */
export function formatIdentity(identity: string): string {
  const us = identity.replace(/\D/g, '').match(/^1?(\d{3})(\d{3})(\d{4})$/);
  return us && !identity.includes('@') ? `(${us[1]}) ${us[2]}-${us[3]}` : identity;
}

/** Share of a day's limit used, 0–1. 0 when unlimited or unknown. */
export function meterFraction(meter: Meter | null | undefined): number {
  return meter && meter.limit ? Math.min(1, meter.used / meter.limit) : 0;
}

/** How loud a meter should read: amber from 80%, red once used up. */
export function usageLevel(fraction: number): 'ok' | 'warn' | 'danger' {
  return fraction >= 1 ? 'danger' : fraction >= 0.8 ? 'warn' : 'ok';
}

/** "Unlimited", or "3 of 5". */
export function meterLine(meter: Meter): string {
  return meter.limit === null ? 'Unlimited' : `${meter.used} of ${meter.limit}`;
}

type Usage = NonNullable<AccountView['usage']>;

/** Share of the period's pool used, 0–1. */
export function poolFraction(usage: Usage): number {
  return usage.budgetCents > 0 ? Math.min(1, usage.spentCents / usage.budgetCents) : 0;
}

/** "$32.10 of $50.00". */
export function poolLine(usage: Usage): string {
  return `${dollars(usage.spentCents)} of ${dollars(usage.budgetCents)}`;
}

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "October 1", or '' when the date is unknown. */
export function resetsOn(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
}

/**
 * One line of what the plan includes, and when it refills. Daily plans count
 * talk and tasks; a paid plan is a pool of model use for the month.
 */
export function planIncludes(view: AccountView): string {
  if (isPaidPlan(view.plan)) {
    if (!view.usage) return 'Usage unavailable right now';
    const on = resetsOn(view.periodEnd);
    return `Unlimited talk and agent tasks, ${dollars(view.usage.budgetCents)} of model use a month.${on ? ` Refills on ${on}.` : ''}`;
  }
  const meters = view.meters;
  if (!meters) return 'Usage unavailable right now';
  const talk = meters.talk.limit === null ? 'Unlimited talk' : `${meters.talk.limit} asks a day`;
  const tasks =
    meters.tasks.limit === 0
      ? 'no agent tasks'
      : `${meters.tasks.limit === null ? 'unlimited' : meters.tasks.limit} agent task${meters.tasks.limit === 1 ? '' : 's'} a day`;
  return `${talk}, ${tasks}. Refills at midnight.`;
}

export function planLabel(view: AccountView): string {
  return planName(view.plan);
}

/** "Pro+", for a plan id on its own (an upgrade button, a note). */
export function planName(plan: PlanId | null): string {
  return PLAN_NAMES[plan ?? 'free'];
}