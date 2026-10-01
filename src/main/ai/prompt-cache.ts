// Where a Claude request marks its prompt cache. The system prompt is cached
// for an hour at the call site. Inside a tool loop the transcript grows every
// step, so the previous turn gets a short breakpoint and the newest message
// — a fresh screenshot or tool result — is left uncached.

import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';

const FIVE_MINUTES = { type: 'ephemeral' as const, ttl: '5m' as const };

/**
 * Where a system prompt's cached head ends and its live tail begins. The
 * tail is what changes turn to turn (the front app's notes, this
 * turn's marks); everything before the break, tools included, is what the
 * hour-long cache is keyed on, so a switch of apps no longer rewrites it.
 */
export const LIVE_BREAK = '\n\n[[live]]\n\n';

/** A system prompt as its cached head and live tail; the tail is '' without a break. */
export function splitSystem(system: string): [head: string, live: string] {
  const at = system.indexOf(LIVE_BREAK);
  return at === -1 ? [system, ''] : [system.slice(0, at), system.slice(at + LIVE_BREAK.length)];
}

/**
 * A copy of `messages` with a 5-minute cache breakpoint on the last block of
 * the previous turn. Fewer than two messages is returned unchanged. Never
 * mutates the input: the loop keeps these objects and writes them to history.
 */
export function cachePriorTurn(messages: MessageParam[]): MessageParam[] {
  if (messages.length < 2) return messages;
  const at = messages.length - 2;
  return messages.map((message, index) => (index === at ? markLastBlock(message) : message));
}

function markLastBlock(message: MessageParam): MessageParam {
  if (typeof message.content === 'string') {
    return {
      ...message,
      content: [{ type: 'text', text: message.content, cache_control: FIVE_MINUTES }],
    };
  }
  const blocks = message.content;
  if (blocks.length === 0) return message;
  const last = blocks.length - 1;
  return {
    ...message,
    content: blocks.map((block, index) =>
      index === last ? ({ ...block, cache_control: FIVE_MINUTES } as ContentBlockParam) : block,
    ),
  };
}
