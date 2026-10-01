import { describe, expect, it } from 'vitest';
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { appendTurns, correctUserText, withoutImages } from '../src/main/ai/history';

function userContent(question: string): ContentBlockParam[] {
  return [
    { type: 'text', text: 'Screen 1 (cursor is here), 1568x980' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
    { type: 'text', text: question },
  ];
}

/** A simple text-only exchange, as the tool loop returns it. */
function exchange(question: string, answer: string): MessageParam[] {
  return [
    { role: 'user', content: userContent(question) },
    { role: 'assistant', content: [{ type: 'text', text: answer }] },
  ];
}

describe('conversation context', () => {
  it('keeps images only on the most recent user turn', () => {
    let context = appendTurns([], exchange('first question', 'first answer'));
    context = appendTurns(context, exchange('second question', 'second answer'));

    const [firstUser, , secondUser] = context;
    const firstBlocks = firstUser!.content as ContentBlockParam[];
    const secondBlocks = secondUser!.content as ContentBlockParam[];

    expect(firstBlocks.some((b) => b.type === 'image')).toBe(false);
    expect(firstBlocks.filter((b) => b.type === 'text').map((b) => b.text)).toContain(
      '[screenshot omitted]',
    );
    expect(secondBlocks.some((b) => b.type === 'image')).toBe(true);
  });

  it('keeps the question text when pruning images', () => {
    let context = appendTurns([], exchange('where is the save button', 'answer'));
    context = appendTurns(context, exchange('next', 'answer'));

    const blocks = context[0]!.content as ContentBlockParam[];
    expect(blocks.filter((b) => b.type === 'text').map((b) => b.text)).toContain(
      'where is the save button',
    );
  });

  it('prunes images nested inside old tool_result blocks', () => {
    let context = appendTurns(
      [],
      [
        { role: 'user', content: userContent('search for it') },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'web_search', input: {} }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'found it' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img' } },
              ],
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'here you go' }] },
      ],
    );
    context = appendTurns(context, exchange('next question', 'answer'));

    const resultTurn = context[2]!.content as ContentBlockParam[];
    const result = resultTurn[0]!;
    if (result.type !== 'tool_result' || !Array.isArray(result.content)) {
      throw new Error('expected a tool_result with block content');
    }
    expect(result.content.some((b) => b.type === 'image')).toBe(false);
    expect(result.content).toContainEqual({ type: 'text', text: 'found it' });
    expect(result.content).toContainEqual({ type: 'text', text: '[image omitted]' });
  });

  it('caps the context at 5 exchanges and stays user-first', () => {
    let context: MessageParam[] = [];
    for (let i = 0; i < 8; i++) {
      context = appendTurns(context, exchange(`question ${i}`, `answer ${i}`));
    }
    // 5 text-only exchanges of 2 messages each survive, starting at question 3.
    expect(context.length).toBe(10);
    expect(context[0]!.role).toBe('user');
    const firstBlocks = context[0]!.content as ContentBlockParam[];
    expect(firstBlocks.filter((b) => b.type === 'text').map((b) => b.text)).toContain('question 3');
    // Roles must strictly alternate for the Anthropic API.
    for (let i = 1; i < context.length; i++) {
      expect(context[i]!.role).not.toBe(context[i - 1]!.role);
    }
    // The most recent exchange is intact at the end.
    const last = context.at(-1)!.content as ContentBlockParam[];
    expect(last[0]).toEqual({ type: 'text', text: 'answer 7' });
  });

  it('keeps a tool-heavy exchange in context through later follow-ups', () => {
    // One search exchange with three tool rounds (8 messages on its own)...
    const searchExchange: MessageParam[] = [{ role: 'user', content: userContent('find me a coat') }];
    for (let round = 0; round < 3; round++) {
      searchExchange.push(
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: `tu_${round}`, name: 'web_search', input: {} }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: `tu_${round}`, content: `results ${round}` }],
        },
      );
    }
    searchExchange.push({ role: 'assistant', content: [{ type: 'text', text: 'found one' }] });

    // ...followed by two short follow-ups must not evict the search results.
    let context = appendTurns([], searchExchange);
    context = appendTurns(context, exchange('that link is broken', 'try searching instead'));
    context = appendTurns(context, exchange('try another link you found', 'sure'));

    const json = JSON.stringify(context);
    expect(json).toContain('results 0');
    expect(json).toContain('results 2');
    expect(json).toContain('find me a coat');
  });

  it('does not mutate the context it was given', () => {
    const first = exchange('q', 'a');
    const before = JSON.stringify(first);
    appendTurns(first, exchange('next', 'answer'));
    expect(JSON.stringify(first)).toBe(before);
  });

  it('rewrites the last user transcript after a correction', () => {
    const context = appendTurns([], exchange('open kubenetes', 'sure'));
    expect(correctUserText(context, 'open kubenetes', 'open kubernetes')).toBe(true);
    const blocks = context[0]!.content as ContentBlockParam[];
    expect(blocks.filter((b) => b.type === 'text').map((b) => b.text)).toContain('open kubernetes');
  });

  it('never lets the context start with an orphaned tool_result turn', () => {
    let context: MessageParam[] = [];
    // Exchanges with tool calls take 4 messages each; force lots of trimming.
    for (let i = 0; i < 6; i++) {
      context = appendTurns(context, [
        { role: 'user', content: userContent(`q${i}`) },
        { role: 'assistant', content: [{ type: 'tool_use', id: `tu_${i}`, name: 'point', input: {} }] },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: 'drawn' }],
        },
        { role: 'assistant', content: [{ type: 'text', text: `a${i}` }] },
      ]);
    }
    const first = context[0]!;
    expect(first.role).toBe('user');
    const blocks = first.content as ContentBlockParam[];
    expect(blocks.some((b) => b.type === 'tool_result')).toBe(false);
  });

  it('withoutImages prunes every image, including the latest turn', () => {
    const context = appendTurns([], exchange('question', 'answer'));
    const persisted = withoutImages(context);
    const persistedBlocks = persisted[0]!.content as ContentBlockParam[];
    expect(persistedBlocks.some((b) => b.type === 'image')).toBe(false);
    // The live context is untouched: its latest images stay for the follow-up.
    const liveBlocks = context[0]!.content as ContentBlockParam[];
    expect(liveBlocks.some((b) => b.type === 'image')).toBe(true);
  });
});
