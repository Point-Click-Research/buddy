// Reading a spoken ask with Jev before the brain is chosen: one request
// answers both what kind of ask it is and which tool it ends in, and an
// unconfident answer is no opinion at all.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';
import { lastReply, NO_INTENT, readIntent, toolHint } from '../src/main/ai/intent';
import type { Jev, JevAsk, JevChoice } from '../src/main/ai/jev';
import type { ToolRegistry } from '../src/main/ai/tools';

function registry(): ToolRegistry {
  const tool = (name: string, description: string, immediate = false) => ({
    definition: { name, description, input_schema: { type: 'object' } } as Tool,
    immediate,
    execute: () => ({ content: '' }),
  });
  return new Map([
    ['point', tool('point', 'Point at one thing on screen.', true)],
    ['send_message', tool('send_message', 'Send an iMessage or SMS through Messages.')],
    ['media_control', tool('media_control', 'Play, pause, skip, or change the volume.')],
  ]);
}

/** A Jev answering by question name, and recording what it was asked. */
function jevAnswering(answers: Record<string, JevChoice | null>, asked: Record<string, JevAsk>[] = []): Jev {
  return {
    async choices(_state, asks) {
      asked.push(asks as Record<string, JevAsk>);
      return Object.fromEntries(Object.keys(asks).map((name) => [name, answers[name] ?? null])) as Awaited<
        ReturnType<Jev['choices']>
      >;
    },
    judge: async () => null,
  };
}

describe('readIntent', () => {
  it('asks both questions in one call, over the tools that are not annotations', async () => {
    const asked: Record<string, JevAsk>[] = [];
    const jev = jevAnswering(
      { kind: { choice: 'act', confidence: 0.95 }, tool: { choice: 'send_message', confidence: 0.9 } },
      asked,
    );
    const intent = await readIntent(jev, 'tell Sam I am running late', registry());
    expect(intent).toEqual({ deep: true, tool: 'send_message', drive: false, chat: false });
    expect(asked).toHaveLength(1);
    expect(Object.keys(asked[0]!.tool!.options)).toEqual(['send_message', 'media_control', 'none']);
    // No propose_task this turn (agent mode off): the drive question is not asked.
    expect(asked[0]!.drive).toBeUndefined();
  });

  // "Open Figma and add a circle" read as act, but the tool pick was unsure,
  // so the model opened Figma and stopped. Working inside an app is a task.
  it('flags an ask that means working inside an app, only when a task can be proposed', async () => {
    const tools = registry();
    tools.set('propose_task', {
      definition: { name: 'propose_task', description: 'Propose taking control.', input_schema: { type: 'object' } } as Tool,
      execute: () => ({ content: '' }),
    });
    const jev = jevAnswering({
      kind: { choice: 'act', confidence: 1 },
      tool: { choice: 'send_message', confidence: 0.3 },
      drive: { choice: 'yes', confidence: 0.92 },
    });
    const intent = await readIntent(jev, 'open Figma and add a circle to the buddy canvas', tools);
    expect(intent).toEqual({ deep: true, tool: null, drive: true, chat: false });
    expect(toolHint(intent)).toMatch(/propose_task for the whole job/);
  });

  // "That's not a circle, that's a comment" alone read as a screen question.
  it("reads a follow-up against Buddy's last reply", async () => {
    const states: unknown[] = [];
    const jev: Jev = {
      async choices(state, asks) {
        states.push(state);
        return Object.fromEntries(Object.keys(asks).map((name) => [name, null])) as Awaited<ReturnType<Jev['choices']>>;
      },
      judge: async () => null,
    };
    const history = [
      { role: 'user' as const, content: 'add a circle in Figma' },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'I created a blue circle on the canvas.' }] },
    ];
    await readIntent(jev, "that's not a circle, that's a comment", registry(), lastReply(history));
    expect(states[0]).toEqual({
      ask: "that's not a circle, that's a comment",
      previous_reply: 'I created a blue circle on the canvas.',
    });
    expect(lastReply([])).toBe('');
  });

  it('reads a screen question as fast-model work with no tool', async () => {
    const jev = jevAnswering({
      kind: { choice: 'read_screen', confidence: 0.9 },
      tool: { choice: 'none', confidence: 0.97 },
    });
    expect(await readIntent(jev, 'what does the red badge mean', registry())).toEqual({
      deep: false,
      tool: null,
      drive: false,
      chat: false,
    });
  });

  // "Hey buddy" was a full turn: the guide prompt, every tool schema, and a
  // screenshot per display, for a two-word answer.
  it('reads small talk as a light turn, from the words alone or from Jev', async () => {
    const light = { deep: false, tool: null, drive: false, chat: true };
    const asked: Record<string, JevAsk>[] = [];
    const jev = jevAnswering({ kind: { choice: 'act', confidence: 1 } }, asked);
    expect(await readIntent(jev, 'hey buddy', registry())).toEqual(light);
    expect(await readIntent(null, "what's up?", registry())).toEqual(light);
    expect(await readIntent(jev, 'thanks!', registry())).toEqual(light);
    expect(asked).toHaveLength(0);
    // Not a plain hello: Jev is asked, and it can still say chat.
    const worded = jevAnswering({ kind: { choice: 'chat', confidence: 0.9 }, tool: { choice: 'none', confidence: 0.9 } });
    expect(await readIntent(worded, 'just checking you are still around', registry())).toEqual(light);
    // A hello that Jev sees ending in a tool is not small talk.
    const tooled = jevAnswering({ kind: { choice: 'chat', confidence: 0.9 }, tool: { choice: 'media_control', confidence: 0.9 } });
    expect((await readIntent(tooled, 'hey, pause', registry())).chat).toBe(false);
    expect((await readIntent(null, 'hey, what is this?', registry())).chat).toBe(false);
  });

  it('has no opinion below the confidence floor, and none at all without Jev', async () => {
    const unsure = jevAnswering({
      kind: { choice: 'act', confidence: 0.4 },
      tool: { choice: 'media_control', confidence: 0.5 },
    });
    expect(await readIntent(unsure, 'hmm the music', registry())).toEqual(NO_INTENT);
    expect(await readIntent(null, 'pause it', registry())).toEqual(NO_INTENT);
  });
});

describe('toolHint', () => {
  it('names the tool as a hint, or says nothing', () => {
    expect(toolHint({ deep: true, tool: 'send_message', drive: false, chat: false })).toContain('send_message');
    expect(toolHint(NO_INTENT)).toBeUndefined();
  });
});
