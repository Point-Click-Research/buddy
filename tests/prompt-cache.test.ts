import { describe, expect, it } from 'vitest';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { cachePriorTurn, LIVE_BREAK, splitSystem } from '../src/main/ai/prompt-cache';

describe('splitSystem', () => {
  it('splits a prompt at the live break, and leaves one without it whole', () => {
    expect(splitSystem(`rules${LIVE_BREAK}front app notes`)).toEqual(['rules', 'front app notes']);
    expect(splitSystem('rules')).toEqual(['rules', '']);
  });
});

describe('cachePriorTurn', () => {
  it('leaves a single message untouched', () => {
    const messages: MessageParam[] = [{ role: 'user', content: 'hi' }];
    expect(cachePriorTurn(messages)).toBe(messages);
  });

  it('marks the previous turn and leaves the newest message alone', () => {
    const newest: MessageParam = { role: 'user', content: [{ type: 'text', text: 'tool result' }] };
    const messages: MessageParam[] = [
      { role: 'user', content: 'what is this' },
      { role: 'assistant', content: [{ type: 'text', text: 'a button' }] },
      newest,
    ];
    const cached = cachePriorTurn(messages);
    expect(cached[2]).toBe(newest);
    expect(messages[0]).toEqual({ role: 'user', content: 'what is this' });
    const prior = cached[1]!.content;
    expect(Array.isArray(prior) && prior[0] && 'cache_control' in prior[0] && prior[0].cache_control).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    });
  });
});
