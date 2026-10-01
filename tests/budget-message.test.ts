import { describe, expect, it } from 'vitest';
import { budgetSpentMessage, readBudget, type BudgetFacts } from '../src/main/ai/budget-message';

const RESETS = '2026-10-15T12:00:00.000Z';

const facts = (over: Partial<BudgetFacts> = {}): BudgetFacts => ({
  plan: 'waitlist',
  resetsAt: RESETS,
  billing: false,
  ...over,
});

const body = {
  error: 'budget_exceeded' as const,
  plan: 'waitlist' as const,
  spentCents: 100,
  budgetCents: 100,
  resetsAt: RESETS,
};

const limit = {
  error: 'limit_exceeded' as const,
  plan: 'free' as const,
  meter: 'tasks' as const,
  used: 1,
  limit: 1,
  resetsAt: RESETS,
};

describe('the day\'s meter is used up', () => {
  it('names the tasks, says talk goes on, and refills at midnight on every plan', () => {
    const message = budgetSpentMessage(facts({ plan: 'free', meter: 'tasks', limit: 1, billing: true }));
    expect(message).toContain("today's 1 agent tasks");
    expect(message).toContain('at midnight');
    expect(message).toContain('Talk keeps working');
    expect(message).toContain('upgrade');
    expect(message).toContain('A key of your own');
  });

  it('names the asks when those run out', () => {
    const talk = budgetSpentMessage(facts({ plan: 'free', meter: 'talk', limit: 20 }));
    expect(talk).toContain("today's 20 asks");
    expect(talk).not.toContain('Talk keeps working');
  });

  it('sends Pro and Pro+ up the ladder and Max to its own keys', () => {
    const pro = budgetSpentMessage(facts({ plan: 'pro', meter: 'tasks', limit: 5, billing: true }));
    expect(pro).toContain('Upgrade under Settings');
    expect(budgetSpentMessage(facts({ plan: 'plus', billing: true }))).toContain('Upgrade under Settings');
    const max = budgetSpentMessage(facts({ plan: 'max', meter: 'tasks', limit: 30, billing: true }));
    expect(max).toContain('extra usage');
    expect(max).toContain('API keys');
    expect(max).not.toContain('Upgrade');
  });
});

describe('the cost guard is spent', () => {
  it('talks a waitlist account through it: what comes after the waitlist, back at midnight, a code', () => {
    for (const meter of [undefined, 'talk', 'tasks'] as const) {
      const message = budgetSpentMessage(facts({ meter, limit: 20 }));
      expect(message).toContain('off the waitlist I can search');
      expect(message).toContain('at midnight');
      expect(message).toContain('shares a code');
      expect(message).not.toMatch(/credit|asks|October|upgrade|API keys/);
    }
  });

  it('offers upgrade only when Stripe can open', () => {
    expect(budgetSpentMessage(facts({ billing: true }))).toContain('upgrade');
    const pro = budgetSpentMessage(facts({ plan: 'pro', billing: false }));
    expect(pro).toContain('October 15');
    expect(pro).toContain('extra usage');
    expect(pro).toContain('API keys');
    expect(pro).not.toContain('Upgrade');
  });

  it('says midnight on Early, and a date on Free', () => {
    expect(budgetSpentMessage(facts({ plan: 'early' }))).toContain('at midnight');
    expect(budgetSpentMessage(facts({ plan: 'free' }))).toContain('October 15');
  });

  it('does not invent a date or an upgrade when neither is known', () => {
    const message = budgetSpentMessage(facts({ plan: null, resetsAt: null }));
    expect(message).toContain('Settings → Account says when');
    expect(message).not.toContain('upgrade');
  });
});

describe('a paid plan past its pool with extra usage off', () => {
  const asked = { ...body, error: 'on_demand_required' as const, plan: 'pro' as const, spentCents: 5000, budgetCents: 5000 };

  it('is read as the ask, and points at the switch', () => {
    expect(readBudget({ error: asked })).toEqual({ plan: 'pro', resetsAt: RESETS, onDemand: true });
    expect(readBudget(new Error(`402 ${JSON.stringify(asked)}`))?.onDemand).toBe(true);
    const message = budgetSpentMessage(facts({ plan: 'pro', billing: true, onDemand: true }));
    expect(message).toContain('extra usage');
    expect(message).toContain('Settings → Account');
    expect(message).not.toContain('Upgrade');
  });
});

describe('reading the 402', () => {
  it('reads either body from the SDK error or from its message', () => {
    expect(readBudget({ error: body })?.plan).toBe('waitlist');
    expect(readBudget(new Error(`402 ${JSON.stringify(body)}`))?.resetsAt).toBe(RESETS);
    expect(readBudget({ error: limit })).toEqual({ plan: 'free', resetsAt: RESETS, meter: 'tasks', limit: 1 });
    expect(readBudget(new Error(`402 ${JSON.stringify(limit)}`))?.meter).toBe('tasks');
    expect(readBudget(new Error('rate limited'))).toBeNull();
  });
});
