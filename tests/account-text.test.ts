import { isPaidPlan, nextPlanUp } from '../src/shared/contracts';
import { describe, expect, it } from 'vitest';
import type { AccountView } from '../src/shared/types';
import {
  formatIdentity,
  meterFraction,
  meterLine,
  planIncludes,
  planLabel,
  poolFraction,
  poolLine,
  usageLevel,
} from '../src/renderer/shared/account-text';

const view = (plan: AccountView['plan'], meters: AccountView['meters'] = null, over: Partial<AccountView> = {}): AccountView =>
  ({ plan, meters, usage: null, periodEnd: null, ...over }) as AccountView;

describe('the plan as it reads', () => {
  it('names each plan and what a day of it holds', () => {
    expect(planLabel(view('early'))).toBe('Early');
    expect(planLabel(view('waitlist'))).toBe('Waitlist');
    expect(planLabel(view('max'))).toBe('Max');
    expect(planLabel(view('plus'))).toBe('Pro+');
    const day = { resetsAt: '2026-09-29T04:00:00.000Z' };
    expect(planIncludes(view('early', { ...day, talk: { used: 3, limit: null }, tasks: { used: 1, limit: 3 } }))).toBe(
      'Unlimited talk, 3 agent tasks a day. Refills at midnight.',
    );
    expect(planIncludes(view('waitlist', { ...day, talk: { used: 3, limit: 20 }, tasks: { used: 0, limit: 0 } }))).toBe(
      '20 asks a day, no agent tasks. Refills at midnight.',
    );
    expect(planIncludes(view('free', { ...day, talk: { used: 0, limit: 25 }, tasks: { used: 0, limit: 1 } }))).toBe(
      '25 asks a day, 1 agent task a day. Refills at midnight.',
    );
    expect(planIncludes(view('free'))).toBe('Usage unavailable right now');
  });

  it('reads a paid plan as a pool of model use for the month', () => {
    const usage = { spentCents: 3210, budgetCents: 5000 };
    expect(planIncludes(view('pro', null, { usage, periodEnd: '2026-10-01T12:00:00.000Z' }))).toBe(
      'Unlimited talk and agent tasks, $50.00 of model use a month. Refills on October 1.',
    );
    expect(planIncludes(view('max'))).toBe('Usage unavailable right now');
    expect(poolLine(usage)).toBe('$32.10 of $50.00');
    expect(poolFraction(usage)).toBeCloseTo(0.642);
    expect(poolFraction({ spentCents: 9000, budgetCents: 5000 })).toBe(1);
  });

  it('reads a meter as a count against its limit, and unlimited as no fraction', () => {
    expect(meterLine({ used: 3, limit: 5 })).toBe('3 of 5');
    expect(meterLine({ used: 30, limit: null })).toBe('Unlimited');
    expect(meterFraction({ used: 4, limit: 5 })).toBe(0.8);
    expect(meterFraction({ used: 9, limit: 5 })).toBe(1);
    expect(meterFraction({ used: 9, limit: null })).toBe(0);
    expect(meterFraction(null)).toBe(0);
  });
});

describe('formatIdentity', () => {
  it('formats a bare US phone number', () => {
    expect(formatIdentity('2035550123')).toBe('(203) 555-0123');
    expect(formatIdentity('12035550123')).toBe('(203) 555-0123');
  });

  it('leaves emails and other numbers alone', () => {
    expect(formatIdentity('zach@example.com')).toBe('zach@example.com');
    expect(formatIdentity('442071838750')).toBe('442071838750');
  });
});

describe('the paid ladder', () => {
  it('steps to the next plan Stripe sells, and stops at the top', () => {
    const all = ['pro', 'plus', 'max'] as const;
    expect(nextPlanUp('free', all)).toBe('pro');
    expect(nextPlanUp(null, all)).toBe('pro');
    expect(nextPlanUp('pro', all)).toBe('plus');
    expect(nextPlanUp('plus', all)).toBe('max');
    expect(nextPlanUp('max', all)).toBeNull();
    expect(nextPlanUp('pro', ['pro', 'max'])).toBe('max');
    expect(nextPlanUp('early', ['pro'])).toBe('pro');
    expect(nextPlanUp('pro', ['pro'])).toBeNull();
    expect(isPaidPlan('plus')).toBe(true);
    expect(isPaidPlan('early')).toBe(false);
  });
});

describe('usageLevel', () => {
  it('warns from 80% and alarms when spent', () => {
    expect(usageLevel(0.5)).toBe('ok');
    expect(usageLevel(0.8)).toBe('warn');
    expect(usageLevel(1)).toBe('danger');
  });
});
