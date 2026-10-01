// Shapes a conversation's model context: the last N exchanges, with images
// pruned from all but the most recent request's turns (images are huge; old
// ones add nothing). Pure module — the conversation store owns the state.

import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';

const MAX_EXCHANGES = 5;

/**
 * The context after one completed request: the old messages with their
 * images pruned, then the new turns, trimmed to the last MAX_EXCHANGES
 * exchanges. An exchange runs from a plain user turn (the question) through
 * its answer, tool rounds included — trimming by raw message count instead
 * would let one tool-heavy exchange evict the whole conversation's memory a
 * couple of questions later. Callers pass only the turns of a successful
 * response, so a cancelled or failed request never leaves a lone user turn
 * behind.
 */
export function appendTurns(context: MessageParam[], turns: MessageParam[]): MessageParam[] {
  if (turns.length === 0) return context;
  const next = [...context.map(pruneMessage), ...turns];
  const starts: number[] = [];
  next.forEach((message, i) => {
    if (message.role === 'user' && !isToolResultTurn(message)) starts.push(i);
  });
  // Cutting at an exchange start keeps every tool_use with its tool_result
  // and the context user-first, so no post-trim repair is needed.
  if (starts.length <= MAX_EXCHANGES) return next;
  return next.slice(starts[starts.length - MAX_EXCHANGES]!);
}

/** The context with every image pruned, ready to persist. Non-mutating. */
export function withoutImages(context: MessageParam[]): MessageParam[] {
  return context.map(pruneMessage);
}

/**
 * Rewrite the last user turn's spoken text after the user corrects the
 * transcript, in place. No-op if that turn is not in the context.
 */
export function correctUserText(context: MessageParam[], from: string, to: string): boolean {
  if (!from || from === to) return false;
  for (let i = context.length - 1; i >= 0; i--) {
    const message = context[i]!;
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    for (let j = message.content.length - 1; j >= 0; j--) {
      const block = message.content[j]!;
      if (block.type !== 'text' || block.text !== from) continue;
      message.content[j] = { type: 'text', text: to };
      return true;
    }
  }
  return false;
}

function isToolResultTurn(message: MessageParam): boolean {
  return (
    Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result')
  );
}

/**
 * The message with every image and document block replaced by a placeholder
 * text block, including images nested inside tool_result content. A PDF is
 * as big as a stack of screenshots and read the same way. Non-mutating.
 */
function pruneMessage(message: MessageParam): MessageParam {
  if (!Array.isArray(message.content)) return message;
  return { ...message, content: message.content.map(pruneBlock) };
}

function pruneBlock(block: ContentBlockParam): ContentBlockParam {
  if (block.type === 'image') return { type: 'text', text: '[screenshot omitted]' };
  if (block.type === 'document') return { type: 'text', text: `[document omitted${block.title ? `: ${block.title}` : ''}]` };
  if (block.type === 'tool_result' && Array.isArray(block.content)) {
    return {
      ...block,
      content: block.content.map((inner) =>
        inner.type === 'image' ? { type: 'text' as const, text: '[image omitted]' } : inner,
      ),
    };
  }
  return block;
}
