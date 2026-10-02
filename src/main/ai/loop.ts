// The multi-step tool loop shared by guide mode and (later) agent mode:
// stream one model turn, execute its tool calls, send the results back, and
// repeat until the model stops calling tools or the step limit is hit.
// The model client is injected so the loop is unit-testable without the API.

import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { beginToolBatch } from './batch';
import type { RegisteredTool, ToolOutcome, ToolRegistry } from './tools';
import { errorMessage } from '../../shared/errors';

const DEFAULT_SLOW_TOOL_MS = 1500;

export interface ModelStreamHandlers {
  onTextDelta(delta: string): void;
  /** The turn hit the token ceiling and was cut off mid-thought. */
  onTruncated?(): void;
  /** Called when a tool_use block starts streaming — its input is still coming. */
  onToolUseStart?(name: string): void;
  /** Called the moment a tool_use block finishes streaming. */
  onToolUse(id: string, name: string, input: unknown): void;
}

/** One streaming model call, resolving to the assistant's full content blocks. */
export type ModelClient = (
  messages: MessageParam[],
  handlers: ModelStreamHandlers,
  signal: AbortSignal,
) => Promise<ContentBlockParam[]>;

export interface ToolLoopOptions {
  callModel: ModelClient;
  tools: ToolRegistry;
  /** Prior conversation. Never mutated. */
  history: MessageParam[];
  /** The new user turn (screenshots + transcript). */
  userContent: ContentBlockParam[];
  /** Hard cap on model calls for this request. */
  maxModelCalls: number;
  signal: AbortSignal;
  /** Model text only — tool results never pass through here. */
  onTextDelta(delta: string): void;
  /**
   * The tool whose work the user is currently waiting on, then null when the
   * batch is done and the model is thinking again. The caller decides what a
   * name is worth showing as — it knows which tools wait on the user.
   */
  onToolActivity?(name: string | null): void;
  /** Fired at most once per request when a tool call is taking a while. */
  onSlowTool?(): void;
  slowToolMs?: number;
  /**
   * Agent mode: before each model call, keep only this many of the most
   * recent screenshots in the loop's turns; older ones become placeholders.
   */
  keepRecentImages?: number;
  /**
   * Agent mode (per the computer-use docs): when one action in a batch
   * fails, the remaining actions are answered as not-executed errors.
   */
  haltBatchOnError?: boolean;
  /**
   * Guide mode: a reply that already says the answer and only drew is
   * finished. Another model call would only be a chance to draw it again.
   */
  stopAfterSpokenDraw?: boolean;
  /**
   * Guide mode: hold each model call's text until it is known to be an
   * answer. Text followed by a lookup ("let me check…") is narration and is
   * dropped; text followed by a spokenAlongside/immediate tool, or by nothing,
   * is the answer and is released. The prompt forbids narration; this is
   * what enforces it.
   */
  speakOnlyAnswers?: boolean;
}

export interface ToolLoopResult {
  /**
   * Every new turn: the user turn, then alternating assistant / tool_result
   * turns. Empty when aborted — cancelled requests leave no history.
   */
  turns: MessageParam[];
  /**
   * `truncated` is a turn that ran out of tokens before it could act or
   * finish: unlike `done`, nothing about it says the work is over.
   */
  stopReason: 'done' | 'limit' | 'aborted' | 'truncated';
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const { tools, signal } = options;
  const slowToolMs = options.slowToolMs ?? DEFAULT_SLOW_TOOL_MS;
  const aborted: ToolLoopResult = { turns: [], stopReason: 'aborted' };
  const turns: MessageParam[] = [{ role: 'user', content: options.userContent }];
  let slowToolNotified = false;
  const text = messageJoiner(options.onTextDelta);

  for (let call = 1; call <= options.maxModelCalls; call++) {
    if (options.keepRecentImages !== undefined) pruneOldImages(turns, options.keepRecentImages);
    text.nextMessage();

    // Immediate tools (annotations) run as their blocks finish streaming;
    // cache their outcomes so they aren't executed twice below.
    const immediate = new Map<string, Promise<ToolOutcome>>();
    let truncated = false;
    const speech = speechGate(tools, options.speakOnlyAnswers ? text.emit : null);

    const assistantContent = await options.callModel(
      [...options.history, ...turns],
      {
        onTextDelta: speech ? speech.onText : text.emit,
        onTruncated: () => {
          truncated = true;
        },
        // What Buddy is doing is known as soon as the block's name streams in;
        // waiting for its JSON would leave a long draw call looking like a hang.
        onToolUseStart: (name) => {
          speech?.onTool(name);
          if (tools.has(name)) options.onToolActivity?.(name);
        },
        onToolUse: (id, name, input) => {
          speech?.onTool(name);
          const tool = tools.get(name);
          if (tool?.immediate && !signal.aborted) immediate.set(id, execute(tool, input, signal));
        },
      },
      signal,
    );
    if (signal.aborted) return aborted;
    speech?.onEnd();
    // Narration the gate dropped was never heard, so it must not stay in the
    // model's context either: left there, the model believes it already gave
    // the answer and says nothing after the tool returns, and the turn ends
    // silent. With it gone, the next call opens with the answer itself.
    const kept = speech?.dropped()
      ? assistantContent.filter((block) => block.type !== 'text')
      : assistantContent;
    turns.push({ role: 'assistant', content: kept });

    const toolUses = assistantContent.filter(
      (block): block is ToolUseBlockParam => block.type === 'tool_use',
    );
    // No tool calls ends the loop — but a turn cut off mid-sentence stopped
    // for lack of room, not because there was nothing left to do. A turn that
    // did call tools keeps going: their results give the model its next turn
    // to finish the thought in.
    if (toolUses.length === 0) return { turns, stopReason: truncated ? 'truncated' : 'done' };

    const lastCall = call === options.maxModelCalls;
    // Arm the one-time "still working" filler only if a tool actually runs now
    // and it's doing work rather than waiting on the user.
    const anyPending = toolUses.some(
      (use) =>
        !immediate.has(use.id) && !lastCall && tools.has(use.name) && !tools.get(use.name)!.waitsForUser,
    );
    const slowTimer = anyPending
      ? setTimeout(() => {
          if (!slowToolNotified) {
            slowToolNotified = true;
            options.onSlowTool?.();
          }
        }, slowToolMs)
      : null;

    // Execute strictly in order: computer-use actions build on each other
    // (e.g. "open Spotlight" then "type"), so concurrency would race the UI.
    const outcomes: ToolOutcome[] = [];
    let batchFailed = false;
    let loopEnded = false;
    beginToolBatch();
    for (const use of toolUses) {
      const cached = immediate.get(use.id);
      if (cached) {
        outcomes.push(await cached);
        continue;
      }
      if (lastCall) {
        outcomes.push({ content: 'Step limit reached; this tool call was not executed.', isError: true });
        continue;
      }
      if (batchFailed) {
        outcomes.push({ content: 'Not executed: an earlier action in this batch failed.', isError: true });
        continue;
      }
      if (loopEnded) {
        outcomes.push({ content: 'Not executed: the task already ended.', isError: true });
        continue;
      }
      const tool = tools.get(use.name);
      if (tool) options.onToolActivity?.(use.name);
      const outcome = tool
        ? await execute(tool, use.input, signal)
        : { content: `Unknown tool: ${use.name}`, isError: true };
      if (signal.aborted) {
        if (slowTimer) clearTimeout(slowTimer);
        return aborted;
      }
      if (outcome.isError && options.haltBatchOnError) batchFailed = true;
      if (outcome.endLoop) loopEnded = true;
      outcomes.push(outcome);
    }
    if (slowTimer) clearTimeout(slowTimer);
    if (signal.aborted) return aborted;
    // The batch is done; until the next turn says something, Buddy is thinking.
    options.onToolActivity?.(null);

    turns.push({ role: 'user', content: toolUses.map((use, i) => toResult(use, outcomes[i]!)) });
    // A tool (task_complete) declared the conversation over: stop cleanly.
    if (loopEnded) return { turns, stopReason: 'done' };
    // The answer was already spoken alongside the drawing. Stopping here is
    // what keeps a second draw call from happening before the user hears it.
    if (options.stopAfterSpokenDraw && spokenDrawFinished(assistantContent, toolUses, outcomes)) {
      return { turns, stopReason: 'done' };
    }
    if (lastCall) return { turns, stopReason: 'limit' };
  }

  // Only reachable with maxModelCalls < 1.
  return { turns, stopReason: 'limit' };
}

const OMITTED = { type: 'text', text: '[screenshot omitted]' } as const;

const DRAWING_TOOLS = new Set(['draw', 'update_drawing', 'erase']);

/** A tool whose same-turn text is the answer rather than a "let me check". */
function speaksAlongside(tools: ToolRegistry, name: string): boolean {
  const tool = tools.get(name);
  return Boolean(tool?.immediate || tool?.spokenAlongside);
}

interface SpeechGate {
  onText(delta: string): void;
  onTool(name: string): void;
  onEnd(): void;
  /** The call's text was narration before a lookup, and none of it was spoken. */
  dropped(): boolean;
}

/**
 * One model call's speech gate. Text is held until the first tool call
 * decides it: a spoken-alongside tool releases it and lets the rest through,
 * any other tool drops it and mutes the call. A call that ends without a
 * tool was an answer, so its text is released whole. Null when off.
 */
/**
 * The text the user hears and reads, across model calls. Each call is its
 * own message ("That's your play button." then, after a drawing, "Just
 * click it."), and the model starts the next one without a space, so the
 * caption ran them together. A message that follows words already said
 * opens with a paragraph break, as the saved transcript joins them.
 */
export function messageJoiner(emit: (delta: string) => void): { emit: (delta: string) => void; nextMessage: () => void } {
  let said = false;
  let opening = true;
  return {
    emit: (delta) => {
      if (!delta) return;
      const out = opening && said && !/^\s/.test(delta) ? `\n\n${delta}` : delta;
      opening = false;
      if (delta.trim()) said = true;
      emit(out);
    },
    nextMessage: () => {
      opening = true;
    },
  };
}

function speechGate(tools: ToolRegistry, speak: ((delta: string) => void) | null): SpeechGate | null {
  if (!speak) return null;
  let held: string[] | null = [];
  let muted = false;
  const release = (): void => {
    for (const delta of held ?? []) speak(delta);
    held = null;
  };
  return {
    onText: (delta) => {
      if (muted) return;
      if (held) held.push(delta);
      else speak(delta);
    },
    onTool: (name) => {
      if (!held) return; // already decided by an earlier block
      if (speaksAlongside(tools, name)) release();
      else {
        held = null;
        muted = true;
      }
    },
    onEnd: release,
    dropped: () => muted,
  };
}

/** Speech plus nothing but a successful drawing: the turn is over. */
function spokenDrawFinished(
  content: ContentBlockParam[],
  uses: ToolUseBlockParam[],
  outcomes: ToolOutcome[],
): boolean {
  const spoke = content.some((block) => block.type === 'text' && block.text.trim().length > 0);
  if (!spoke || uses.length === 0) return false;
  return uses.every((use) => DRAWING_TOOLS.has(use.name)) && outcomes.every((outcome) => !outcome.isError);
}

/**
 * Replace all but the `keep` most recent image blocks (in user content and
 * inside tool_results) with placeholders. Screenshots dominate the context;
 * old ones add nothing the newest ones don't show better.
 */
export function pruneOldImages(turns: MessageParam[], keep: number): void {
  const replacers: Array<() => void> = [];
  for (const turn of turns) {
    if (!Array.isArray(turn.content)) continue;
    const content = turn.content as ContentBlockParam[];
    content.forEach((block, i) => {
      if (block.type === 'image') {
        replacers.push(() => {
          content[i] = OMITTED;
        });
      } else if (block.type === 'tool_result' && Array.isArray(block.content)) {
        const inner = block.content;
        inner.forEach((innerBlock, j) => {
          if (innerBlock.type === 'image') {
            replacers.push(() => {
              inner[j] = OMITTED;
            });
          }
        });
      }
    });
  }
  for (const replace of replacers.slice(0, Math.max(0, replacers.length - keep))) replace();
}

/** Run one tool; a thrown error becomes an error outcome instead of killing the loop. */
async function execute(
  tool: RegisteredTool,
  input: unknown,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  try {
    return await tool.execute(input, signal);
  } catch (error) {
    return { content: errorMessage(error), isError: true };
  }
}

function toResult(use: ToolUseBlockParam, outcome: ToolOutcome): ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: use.id,
    content: outcome.content,
    ...(outcome.isError ? { is_error: true } : {}),
  };
}
