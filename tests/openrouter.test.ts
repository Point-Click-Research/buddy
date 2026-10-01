// The OpenRouter brain speaks Anthropic-shaped history on one side and
// OpenAI's chat format on the other; this pins the translation between
// them — especially that tool-result screenshots survive as a user message,
// since tool messages in this API are text-only and agent turns depend on
// those screenshots — and that the request carries the cache breakpoints
// and the reasoning effort.

import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));
vi.mock('../src/main/settings', () => ({ getApiKey: () => 'sk-test' }));
vi.mock('../src/main/account/credentials', () => ({
  credentials: async () => ({ apiKey: 'sk-test' }),
}));
vi.mock('../src/main/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import { streamOpenRouter, toChat } from '../src/main/ai/openrouter';
import { LIVE_BREAK } from '../src/main/ai/prompt-cache';

const SYSTEM = { role: 'system', content: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral', ttl: '1h' } }] };

describe('toChat', () => {
  it('puts the cached system prompt first and passes plain turns through', () => {
    const chat = toChat('sys', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(chat).toEqual([SYSTEM, { role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi there' }]);
  });

  // The front app's notes change turn to turn; inside the cached part they
  // rewrote the whole prefix (tools included) on every app switch.
  it("keeps the system prompt's live tail outside the cache breakpoint", () => {
    const chat = toChat(`sys${LIVE_BREAK}notes for Safari`, [{ role: 'user', content: 'hello' }]);
    expect(chat[0]).toEqual({
      role: 'system',
      content: [...SYSTEM.content, { type: 'text', text: 'notes for Safari' }],
    });
  });

  it('sends an attached PDF as a file part the user can name', () => {
    const chat = toChat('sys', [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QUJD' }, title: 'lease.pdf' },
          { type: 'text', text: 'What is the rent?' },
        ],
      },
    ]);
    expect(chat[1]).toEqual({
      role: 'user',
      content: [
        { type: 'file', file: { filename: 'lease.pdf', file_data: 'data:application/pdf;base64,QUJD' } },
        { type: 'text', text: 'What is the rent?' },
      ],
    });
  });

  it('turns tool_use into tool_calls and tool_result into a tool message', () => {
    const history: MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'call_1', name: 'read_window', input: { window_id: 7 } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'a window tree' }],
      },
    ];
    const chat = toChat('sys', history);
    expect(chat[1]).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'read_window', arguments: '{"window_id":7}' } },
      ],
    });
    expect(chat[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'a window tree' });
  });

  it('sends user screenshots as image parts and moves tool-result screenshots to a user message', () => {
    const history: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call_9',
            content: [
              { type: 'text', text: 'took a screenshot' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
            ],
          },
        ],
      },
    ];
    const chat = toChat('sys', history);
    expect(chat[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    });
    expect(chat[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_9',
      content: 'took a screenshot\n[screenshot attached below]',
    });
    expect(chat[3]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Screenshots from the tool results above:' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } },
      ],
    });
  });

  it('keeps a cache breakpoint on the text part that carried it', () => {
    const chat = toChat('sys', [
      {
        role: 'user',
        content: [{ type: 'text', text: 'earlier', cache_control: { type: 'ephemeral', ttl: '5m' } }],
      },
    ]);
    expect(chat[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'earlier', cache_control: { type: 'ephemeral', ttl: '5m' } }],
    });
  });

  it('records an assistant turn that only called tools with null content', () => {
    const chat = toChat('sys', [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_2', name: 'erase', input: {} }],
      },
    ]);
    expect(chat[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'erase', arguments: '{}' } }],
    });
  });
});

async function* answer() {
  yield { choices: [{ delta: { content: 'ok' } }] };
}

const draw: Tool = { name: 'draw', description: '', input_schema: { type: 'object', properties: {} } };

describe('streamOpenRouter', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(answer());
  });

  it("sends the effort as OpenRouter's reasoning parameter, max as xhigh, and none when unset", async () => {
    const handlers = { onTextDelta: vi.fn(), onToolUse: vi.fn() };
    const signal = new AbortController().signal;
    await expect(streamOpenRouter([], 'sys', [draw], handlers, signal, 'anthropic/claude-sonnet-5', 100, 'max')).resolves.toEqual([
      { type: 'text', text: 'ok' },
    ]);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 100,
      reasoning: { effort: 'xhigh' },
      tools: [{ type: 'function', function: { name: 'draw' } }],
    });

    create.mockClear();
    await streamOpenRouter([], 'sys', [], handlers, signal, 'anthropic/claude-haiku-4-5', 100);
    expect(create.mock.calls[0][0].reasoning).toBeUndefined();
    expect(create.mock.calls[0][0].tools).toBeUndefined();
  });
});
