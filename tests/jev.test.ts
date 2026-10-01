// Asking Jev and reading its answers. The request is one state and named
// typed questions; the answers come back under the same names. Anything
// malformed must read as "no answer", never as a confident one.

import { describe, expect, it } from 'vitest';
import { decide, fromSystemOne, readChoice, readNoul, type SystemOne } from '../src/main/ai/jev';

const OPTIONS = { billing: 'Charges and refunds', shipping: 'Delivery', other: null };

function answering(answers: Record<string, unknown>, seen: unknown[] = []): SystemOne {
  return async (request) => {
    seen.push(request);
    return { answers };
  };
}

describe('choices', () => {
  it('sends one choice question per ask and reads each answer back by name', async () => {
    const seen: Array<{ state: unknown; questions: Record<string, { type: string; instructions?: unknown; criteria?: unknown }> }> = [];
    const jev = fromSystemOne(
      answering(
        {
          team: { type: 'choice', choice: 'billing', confidence: 0.93, probabilities: { billing: 0.95, shipping: 0.04, other: 0.01 } },
          tone: { type: 'choice', choice: 'calm', confidence: 0.6, probabilities: { calm: 0.7, angry: 0.3 } },
        },
        seen,
      ),
    );
    const answers = await jev.choices(
      { ticket: 'charged twice' },
      {
        team: { question: 'Which team?', options: OPTIONS },
        tone: { question: 'What tone?', options: { calm: null, angry: null } },
      },
    );
    expect(answers).toEqual({ team: { choice: 'billing', confidence: 0.93 }, tone: { choice: 'calm', confidence: 0.6 } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.state).toEqual({ ticket: 'charged twice' });
    expect(seen[0]!.questions.team).toEqual({ type: 'choice', instructions: 'Which team?', criteria: OPTIONS });
  });

  it('never asks a question with fewer than two options, and answers it null', async () => {
    const seen: Array<{ questions: Record<string, unknown> }> = [];
    const jev = fromSystemOne(answering({ team: { type: 'choice', choice: 'billing', confidence: 1 } }, seen));
    const answers = await jev.choices('x', {
      team: { question: 'Which team?', options: OPTIONS },
      lone: { question: 'Only one?', options: { only: null } },
    });
    expect(answers.lone).toBeNull();
    expect(answers.team?.choice).toBe('billing');
    expect(Object.keys(seen[0]!.questions)).toEqual(['team']);
  });

  it('answers null for every question when the call fails', async () => {
    const jev = fromSystemOne(async () => {
      throw new Error('429');
    });
    expect(await decide(jev, 'x', 'q', OPTIONS)).toBeNull();
  });
});

describe('judge', () => {
  it('reads the yes probability of a noul', async () => {
    const jev = fromSystemOne(answering({ yes: { type: 'noul', noul: 0.91 } }));
    expect(await jev.judge('the order is placed', 'Is it done?')).toBe(0.91);
  });
});

describe('readChoice', () => {
  const labels = Object.keys(OPTIONS);

  it('reads a label that was offered, with its confidence', () => {
    expect(readChoice({ type: 'choice', choice: 'shipping', confidence: 0.5 }, labels)).toEqual({
      choice: 'shipping',
      confidence: 0.5,
    });
  });

  it('rejects a label that was not offered', () => {
    expect(readChoice({ type: 'choice', choice: 'returns', confidence: 0.9 }, labels)).toBeNull();
  });

  it('rejects answers that are not answers at all', () => {
    expect(readChoice('billing', labels)).toBeNull();
    expect(readChoice(null, labels)).toBeNull();
    expect(readChoice({}, labels)).toBeNull();
    expect(readChoice({ choice: 'billing', confidence: 'high' }, labels)).toBeNull();
    expect(readChoice({ choice: 'billing', confidence: NaN }, labels)).toBeNull();
  });
});

describe('readNoul', () => {
  it('reads a probability and rejects anything else', () => {
    expect(readNoul({ type: 'noul', noul: 0.2 })).toBe(0.2);
    expect(readNoul({ noul: 1.5 })).toBeNull();
    expect(readNoul({ noul: 'yes' })).toBeNull();
    expect(readNoul(undefined)).toBeNull();
  });
});
