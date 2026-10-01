// The local brain speaks Anthropic-shaped history on one side and Ollama's
// chat format on the other; this pins the translation between them.

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/settings', () => ({
  getSettings: () => ({ ollamaUrl: 'http://localhost:11434' }),
}));
vi.mock('../src/main/windows', () => ({ broadcast: () => {} }));
vi.mock('../src/main/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import { stripImages, toOllamaChat, toOllamaTools } from '../src/main/ai/ollama';
import { LIVE_BREAK } from '../src/main/ai/prompt-cache';

describe('toOllamaChat', () => {
  it('puts the system prompt first and passes plain turns through', () => {
    const chat = toOllamaChat('be brief', [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    expect(chat).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  // The tools follow the system message, so a tail that changes per turn
  // there would make Ollama re-read every tool on every turn.
  it('keeps the system message to the cached head and puts the live tail on the latest ask', () => {
    const chat = toOllamaChat(`rules${LIVE_BREAK}front app: Mail`, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'any new mail?' },
    ]);
    expect(chat[0]).toEqual({ role: 'system', content: 'rules' });
    expect(chat[1]).toEqual({ role: 'user', content: 'hello' });
    expect(chat[3]).toEqual({ role: 'user', content: 'front app: Mail\n\nany new mail?' });
  });

  it('turns tool_use into tool_calls and tool_result into a named tool message', () => {
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
    const chat = toOllamaChat('sys', history);
    expect(chat[1]).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [{ function: { name: 'read_window', arguments: { window_id: 7 } } }],
    });
    expect(chat[2]).toEqual({ role: 'tool', content: 'a window tree', tool_name: 'read_window' });
  });

  it('carries screenshots on user turns and drops them from tool results', () => {
    const history: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Display 1, frame_id f1' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: 'what is this?' },
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
    const chat = toOllamaChat('sys', history);
    expect(chat[1]).toEqual({
      role: 'user',
      content: 'Display 1, frame_id f1\nwhat is this?',
      images: ['AAAA'],
    });
    expect(chat[2]).toEqual({
      role: 'tool',
      content: 'took a screenshot\n[screenshot omitted]',
    });
  });

  // A laptop reads a few hundred tokens a second; one search dump cost 19s.
  it('caps a long tool result', () => {
    const history: MessageParam[] = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'x'.repeat(50_000) }] },
    ];
    const [, result] = toOllamaChat('sys', history);
    expect(result.content.length).toBeLessThan(6_100);
    expect(result.content).toContain('[Result truncated: showing 6000 of 50000 characters.]');
  });
});

describe('toOllamaTools', () => {
  const tool = (name: string, description: string) => ({ name, description, input_schema: { type: 'object' as const } });

  it('drops the drawing and task tools and keeps each description to its first sentence', () => {
    const tools = toOllamaTools([
      tool('draw', 'Draw on the screen.'),
      tool('list_files', 'List files (node_modules, .git, dist, …). Use it before reading.'),
      tool('mail', 'The Mac Mail app — never send.'),
    ]);
    expect(tools.map((t) => [t.function.name, t.function.description])).toEqual([
      ['list_files', 'List files (node_modules, .git, dist, …).'],
      ['mail', 'The Mac Mail app — never send.'],
    ]);
  });
});

// A text-only local model rejects any request carrying images, so the retry
// path strips them and says so — the model must not guess at a screen it
// never saw.
describe('stripImages', () => {
  it('removes images and notes the omission, leaving other turns alone', () => {
    const stripped = stripImages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what is this?', images: ['AAAA'] },
      { role: 'assistant', content: 'an answer' },
    ]);
    expect(stripped).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what is this?\n[screenshots omitted: this model cannot see images]' },
      { role: 'assistant', content: 'an answer' },
    ]);
  });
});
