// One model turn with nobody at the screen: no state machine, no speech, no
// captions, no screenshots, no global session. The job scheduler and the
// Ideas run go through here; the guide session keeps its richer pipeline in
// session/guide-turn.ts. Because nothing global is touched, headless turns can run
// concurrently with each other and with a foreground turn.

import type { ContentBlockParam, MessageParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { streamBrain } from '../ai/brain';
import { resolveEffort } from '../ai/effort';
import { runToolLoop, type ToolLoopResult } from '../ai/loop';
import { toolDefinitions, type ToolRegistry } from '../ai/tools';
import { recordExchangeIn } from '../chat/conversations';
import { endLiveCall, placesCall } from '../mcp/manager';
import { getSettings } from '../settings';

export interface HeadlessTurnOptions {
  system: string;
  /** The whole user message for the model. */
  prompt: string;
  /** A line for the model ahead of the prompt (Jev's read of the ask); not the user's words. */
  hint?: string;
  /** Files the user sent with the prompt (a texted photo), as the model's blocks. */
  attachments?: ContentBlockParam[];
  tools: ToolRegistry;
  signal: AbortSignal;
  maxModelCalls: number;
  /** When set, the exchange lands in this conversation as `userText` + reply. */
  record?: { conversationId: string; userText: string };
  /** Earlier turns the model should remember; a job run passes none. */
  history?: MessageParam[];
  /**
   * What the model says alongside a tool call ("Calling them now"), the
   * moment it says it: a text thread sends it on as its own message.
   */
  onProgress?: (text: string) => void;
  /** A tool call is taking a while. Text threads acknowledge; jobs leave it. */
  onWork?: () => void;
}

export interface HeadlessTurnResult {
  /** Everything the model said, joined — the run's report. */
  text: string;
  /**
   * The words that close the turn, without what was said alongside tool
   * calls on the way (narration, or progress already sent).
   */
  reply: string;
  /** The turn's messages, for a caller that records the exchange itself. */
  turns: MessageParam[];
  stopReason: ToolLoopResult['stopReason'];
}

export async function runHeadlessTurn(options: HeadlessTurnOptions): Promise<HeadlessTurnResult> {
  const settings = getSettings();
  const result = await runToolLoop({
    callModel: async (messages, handlers, loopSignal) => {
      const content = await streamBrain(messages, options.system, toolDefinitions(options.tools), handlers, loopSignal, {
        model: settings.brainModel,
        effort: resolveEffort(settings.brainEffort, 'answer'),
      });
      if (options.onProgress && calledTools(content)) {
        const said = blockText(content);
        if (said) options.onProgress(said);
      }
      return content;
    },
    tools: options.tools,
    // A job's continuity is its REMEMBER note, not model context (history
    // would grow without bound on an hourly schedule); a text thread remembers.
    history: options.history ?? [],
    userContent: [
      ...(options.attachments ?? []),
      ...(options.hint ? [{ type: 'text' as const, text: options.hint }] : []),
      { type: 'text', text: options.prompt },
    ],
    maxModelCalls: options.maxModelCalls,
    signal: options.signal,
    onTextDelta: () => undefined,
    onSlowTool: options.onWork,
  });
  const turns = result.stopReason === 'limit' ? await wrapUp(options, result.turns) : result.turns;
  if (turns.some((turn) => turn.role === 'assistant' && toolUses(turn).some((use) => placesCall(use.name)))) {
    endLiveCall();
  }
  const text = assistantText(turns, false);
  if (options.record && result.stopReason !== 'aborted') {
    recordExchangeIn(options.record.conversationId, options.record.userText, text, turns);
  }
  return { text, reply: assistantText(turns, true), turns, stopReason: result.stopReason };
}

const WRAP_UP =
  'You are out of steps. Do not call any more tools: write your reply now from what you have done, and say what you did not get to.';

/**
 * Out of steps with the work half done: one more call, with no tools, so the
 * run still says what it did. Without it the last call's tool results are
 * the end of the turn, and the report is silence.
 */
async function wrapUp(options: HeadlessTurnOptions, turns: MessageParam[]): Promise<MessageParam[]> {
  const last = turns[turns.length - 1];
  if (options.signal.aborted || last?.role !== 'user' || !Array.isArray(last.content)) return turns;
  const closing: MessageParam = { role: 'user', content: [...last.content, { type: 'text', text: WRAP_UP }] };
  const settings = getSettings();
  try {
    const content = await streamBrain(
      [...(options.history ?? []), ...turns.slice(0, -1), closing],
      options.system,
      [],
      { onTextDelta: () => undefined, onToolUse: () => undefined },
      options.signal,
      { model: settings.brainModel, effort: resolveEffort(settings.brainEffort, 'answer') },
    );
    return [...turns.slice(0, -1), closing, { role: 'assistant', content }];
  } catch {
    return turns;
  }
}

/** The turns' assistant text, paragraph breaks kept; `closing` skips what was said alongside tool calls. */
function assistantText(turns: MessageParam[], closing: boolean): string {
  return turns
    .filter((turn) => turn.role === 'assistant' && Array.isArray(turn.content))
    .filter((turn) => !(closing && calledTools(turn.content as ContentBlockParam[])))
    .map((turn) => blockText(turn.content as ContentBlockParam[]))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function blockText(content: ContentBlockParam[]): string {
  return content
    .flatMap((block) => (block.type === 'text' && block.text.trim() ? [block.text.trim()] : []))
    .join('\n\n');
}

function toolUses(turn: MessageParam): ToolUseBlockParam[] {
  return Array.isArray(turn.content)
    ? turn.content.filter((block): block is ToolUseBlockParam => block.type === 'tool_use')
    : [];
}

function calledTools(content: ContentBlockParam[]): boolean {
  return content.some((block) => block.type === 'tool_use');
}
