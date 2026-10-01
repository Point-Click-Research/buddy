// What to say when the Buddy API answers 402. Three refusals share the
// status: the day's talk or tasks are used up (limit_exceeded, what the user
// sees on Account), the pool or cost guard is spent (budget_exceeded), and a
// paid plan's pool is spent with extra usage off (on_demand_required, which
// the card asks about first). Each names the plan and when it refills, and
// the next step depends on both: a waitlist account moves up with a code,
// a paid plan can step up the ladder, Max is the top.

import {
  BudgetExceededSchema,
  LimitExceededSchema,
  OnDemandRequiredSchema,
  isPaidPlan,
  resetsDaily,
  type MeterName,
  type PlanId,
} from '../../shared/contracts';

export interface BudgetFacts {
  plan: PlanId | null;
  /** When it refills, ISO, from the 402 or the last /v1/me. */
  resetsAt: string | null;
  /** Stripe is set up, so Upgrade under Account actually opens a page. */
  billing: boolean;
  /** Which daily meter ran out; absent for the cost guard. */
  meter?: MeterName;
  limit?: number;
  /** A paid plan's pool is spent and extra usage is off: the switch is the next step. */
  onDemand?: boolean;
}

export interface Refusal {
  plan: PlanId;
  resetsAt: string;
  meter?: MeterName;
  limit?: number;
  onDemand?: boolean;
}

/** The 402 body, whether the SDK parsed it or left it in the message. */
export function readBudget(error: unknown): Refusal | null {
  const candidates = [error, (error as { error?: unknown } | null)?.error];
  const raw = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const start = raw.indexOf('{');
  if (start >= 0) {
    try {
      candidates.push(JSON.parse(raw.slice(start)));
    } catch {
      // not JSON
    }
  }
  for (const candidate of candidates) {
    const limit = LimitExceededSchema.safeParse(candidate);
    if (limit.success) {
      const { plan, resetsAt, meter } = limit.data;
      return { plan, resetsAt, meter, limit: limit.data.limit };
    }
    const budget = BudgetExceededSchema.safeParse(candidate);
    if (budget.success) return { plan: budget.data.plan, resetsAt: budget.data.resetsAt };
    const onDemand = OnDemandRequiredSchema.safeParse(candidate);
    if (onDemand.success) return { plan: onDemand.data.plan, resetsAt: onDemand.data.resetsAt, onDemand: true };
  }
  return null;
}

/** Spoken when a turn stops because the day's meter or the allowance is spent. */
export function budgetSpentMessage({ plan, resetsAt, billing, meter, limit, onDemand }: BudgetFacts): string {
  if (onDemand) {
    return "That's past this month's included usage. Turn on extra usage under Settings → Account to keep going; it's billed at the end of the month at model cost.";
  }
  if (plan === 'waitlist') {
    const upgrade = billing ? ' You can also upgrade there.' : '';
    return `I'd love to help with that. Once you're off the waitlist I can search, shop, and get things done for you. For today I'm all talked out, but I'll be back at midnight. If a friend already on Buddy shares a code, entering it under Settings → Account gets you in sooner.${upgrade}`;
  }
  const daily = meter !== undefined || (plan !== null && resetsDaily(plan));
  const refill = daily
    ? 'It comes back at midnight.'
    : resetsAt && !Number.isNaN(new Date(resetsAt).getTime())
      ? `It comes back on ${new Date(resetsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
      : 'Settings → Account says when it comes back.';
  const talkGoesOn = meter === 'tasks' ? 'Talk keeps working.' : '';
  return [whatRanOut(meter, limit), refill, talkGoesOn, planStep(plan, billing), OWN_KEY].filter(Boolean).join(' ');
}

function whatRanOut(meter: MeterName | undefined, limit: number | undefined): string {
  if (meter === 'tasks') return `You've used today's ${limit ?? ''} agent tasks.`.replace('  ', ' ');
  if (meter === 'talk') return `You've used today's ${limit ?? ''} asks.`.replace('  ', ' ');
  return "You've used up your Buddy credit.";
}

const EXTRA = "Turn on extra usage under Settings → Account to keep going; it's billed at the end of the month at model cost.";
const OWN_KEY = 'A key of your own under Developer → API keys keeps going until then.';

/** The plan's way forward, only where it exists: Max has no upgrade, and Upgrade needs Stripe. */
function planStep(plan: PlanId | null, billing: boolean): string {
  if (plan === 'max') return EXTRA;
  if (isPaidPlan(plan)) {
    return billing
      ? 'Upgrade under Settings → Account for more included usage, or turn on extra usage there (billed at the end of the month at model cost).'
      : EXTRA;
  }
  if (plan === 'free') {
    const code = 'A code from someone already in moves you up, under Settings → Account.';
    return billing ? `${code} You can also upgrade there.` : code;
  }
  if (plan === 'early') return billing ? 'You can upgrade under Settings → Account for more each day.' : '';
  return billing ? 'You can upgrade under Settings → Account.' : '';
}
