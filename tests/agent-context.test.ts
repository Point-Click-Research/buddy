import { describe, expect, it } from 'vitest';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { agentHandoverTurns, agentOutcomeTurns, toolResultText } from '../src/main/chat/agent-context';

function text(turns: MessageParam[]): string {
  return turns
    .flatMap((turn) => (Array.isArray(turn.content) ? turn.content : []))
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}

describe('agent handover context', () => {
  it('gives the next turn the request, the goal, and the steps', () => {
    const turns = agentHandoverTurns(
      'open my Notes app and write a poem about Scotty',
      'Open Notes and write a poem about Scotty?',
      ['Open Notes', 'Write a poem about Scotty'],
    );
    const body = text(turns);
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(body).toContain('poem about Scotty');
    expect(body).toContain('1. Open Notes');
    expect(body).toContain('2. Write a poem about Scotty');
  });
});

describe('agent outcome context', () => {
  it('keeps the request, what the user heard, the work log, and a link only a tool returned', () => {
    const turns = agentOutcomeTurns(
      'Research bachelor party cities and put them in a spreadsheet.',
      'Created the sheet and wrote the twenty cities.',
      'Done. The spreadsheet is ready.',
      'Spreadsheet created: https://docs.google.com/spreadsheets/d/abc123/edit',
    );
    const body = text(turns);

    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant']);
    expect(body).toContain('Research bachelor party cities');
    expect(body).toContain('The spreadsheet is ready.');
    expect(body).toContain('wrote the twenty cities');
    expect(body).toContain('https://docs.google.com/spreadsheets/d/abc123/edit');
  });

  it('lists a link from the trimmed start of a long work log', () => {
    const url = 'https://docs.google.com/spreadsheets/d/from-the-start/edit';
    const head = `EARLY NOTE that should be cut. Sheet: ${url}\n`;
    const tail = `${'researched another city.\n'.repeat(800)}Final row written.`;
    const body = text(agentOutcomeTurns('make the sheet', `${head}${tail}`, 'Done.'));

    expect(body).toContain('Work log (earlier part trimmed)');
    expect(body).toContain('Final row written.');
    expect(body).not.toContain('EARLY NOTE');
    expect(body).toContain(url);
  });

  it('lists each link once, without the sentence punctuation after it', () => {
    const url = 'https://docs.google.com/spreadsheets/d/abc123/edit';
    const body = text(agentOutcomeTurns('make the sheet', `Here it is: ${url}.`, 'Done.', `created ${url}`));
    const listed = body.split('\n').filter((line) => line.startsWith('- '));

    expect(listed).toEqual([`- ${url}`]);
  });

  it('records nothing when the run left nothing', () => {
    expect(agentOutcomeTurns('   ', '', '', '')).toEqual([]);
  });
});

describe('tool result text', () => {
  it('reads result text and skips images', () => {
    const results: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'opened the sheet' },
          {
            type: 'tool_result',
            tool_use_id: 'tu_2',
            content: [
              { type: 'text', text: 'https://example.com/sheet' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc' } },
            ],
          },
        ],
      },
    ];
    expect(toolResultText(results)).toBe('opened the sheet\nhttps://example.com/sheet');
  });
});
