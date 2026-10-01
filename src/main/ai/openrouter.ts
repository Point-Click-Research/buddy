// The streaming brain: every cloud model through OpenRouter's OpenAI-compatible
// API. Buddy's history and tools stay Anthropic-shaped (the tool loop and the
// saved conversations never learn which vendor answered); this file translates
// on the way out and back. Anthropic prompt caching rides along as
// cache_control on the system prompt and the previous turn, which OpenRouter
// forwards to Anthropic and other vendors ignore.

import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import OpenAI from 'openai';
import type { ModelEffort } from '../../shared/types';
import { createLogger } from '../log';
import { credentials } from '../account/credentials';
import { reasoningEffort } from './effort';
import type { ModelStreamHandlers } from './loop';
import { cachePriorTurn, splitSystem } from './prompt-cache';
import { turnHeaders } from './turn-scope';

const log = createLogger('openrouter');

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

/** An Anthropic-style cache breakpoint, as OpenRouter takes it on a content part. */
type CacheControl = { type: 'ephemeral'; ttl?: string };

type ContentPart =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'image_url'; image_url: { url: string } }
  /** A PDF, as OpenRouter takes one; Anthropic models read it natively. */
  | { type: 'file'; file: { filename: string; file_data: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Which tool_use a role:'tool' message answers. */
  tool_call_id?: string;
}

/**
 * The system prompt's head is the same for every call of a session, so it
 * is cached for an hour; the breakpoint covers everything before it, tools
 * included. Its live tail (see prompt-cache) rides after the breakpoint.
 */
const SYSTEM_CACHE: CacheControl = { type: 'ephemeral', ttl: '1h' };

function systemMessage(system: string): ChatMessage {
  const [head, live] = splitSystem(system);
  const content: ContentPart[] = [{ type: 'text', text: head, cache_control: SYSTEM_CACHE }];
  if (live) content.push({ type: 'text', text: live });
  return { role: 'system', content };
}

/**
 * Anthropic-shaped history → OpenAI chat messages. Exported for tests.
 * Tool messages are text-only in this API, so screenshots inside tool
 * results move to a labelled user message right after them — agent turns
 * lean on those screenshots, so dropping them is not an option. A block's
 * cache_control (from prompt-cache.ts) is kept on the text part that carries it.
 */
export function toChat(system: string, messages: MessageParam[]): ChatMessage[] {
  const chat: ChatMessage[] = [systemMessage(system)];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      chat.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const texts: string[] = [];
      const calls: NonNullable<ChatMessage['tool_calls']> = [];
      for (const block of message.content) {
        if (block.type === 'text') texts.push(block.text);
        if (block.type === 'tool_use') {
          calls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      chat.push({
        role: 'assistant',
        content: texts.length > 0 ? texts.join('\n') : null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // A user turn: tool results become role:'tool' messages; whatever is
    // left (text, images, and the tool results' screenshots) becomes one
    // user message after them.
    const parts: ContentPart[] = [];
    const fromTools: ContentPart[] = [];
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        chat.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattenToolResult(block.content),
        });
        fromTools.push(...toolResultImages(block.content));
      } else if (block.type === 'text') {
        const cache = (block as { cache_control?: CacheControl }).cache_control;
        parts.push({ type: 'text', text: block.text, ...(cache ? { cache_control: cache } : {}) });
      } else if (block.type === 'image' && block.source.type === 'base64') {
        parts.push(imagePart(block.source.media_type, block.source.data));
      } else if (block.type === 'document' && block.source.type === 'base64') {
        parts.push({
          type: 'file',
          file: { filename: block.title ?? 'document.pdf', file_data: `data:${block.source.media_type};base64,${block.source.data}` },
        });
      }
    }
    if (fromTools.length > 0) {
      parts.push({ type: 'text', text: 'Screenshots from the tool results above:' }, ...fromTools);
    }
    if (parts.length > 0) chat.push({ role: 'user', content: parts });
  }
  return chat;
}

function imagePart(mediaType: string, data: string): ContentPart {
  return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data}` } };
}

function flattenToolResult(content: ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .map((block) => (block.type === 'text' ? block.text : '[screenshot attached below]'))
    .join('\n');
}

function toolResultImages(content: ToolResultBlockParam['content']): ContentPart[] {
  if (typeof content === 'string' || !content) return [];
  const images: ContentPart[] = [];
  for (const block of content) {
    if (block.type === 'image' && block.source.type === 'base64') {
      images.push(imagePart(block.source.media_type, block.source.data));
    }
  }
  return images;
}

/** Anthropic tool definitions → OpenAI function-calling tools. */
function toChatTools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
}

/**
 * OpenRouter for this user: their own key, or Buddy's through the API. Null
 * when neither can serve it. Through the API, the call names the turn it is
 * part of, so the plan's daily meters count turns rather than model calls.
 */
export async function openRouterClient(timeout?: number): Promise<OpenAI | null> {
  const auth = await credentials('openrouter');
  if (!auth) return null;
  return new OpenAI({
    apiKey: auth.apiKey,
    baseURL: auth.baseURL ?? OPENROUTER_URL,
    maxRetries: 0,
    defaultHeaders: { 'X-Title': 'Buddy', ...(auth.baseURL ? turnHeaders() : {}) },
    ...(timeout ? { timeout } : {}),
  });
}

/** Send one streaming request and return the assistant's full content blocks. */
export async function streamOpenRouter(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  handlers: ModelStreamHandlers,
  signal: AbortSignal,
  model: string,
  maxTokens: number,
  effort?: ModelEffort,
): Promise<ContentBlockParam[]> {
  const client = await openRouterClient();
  if (!client) {
    throw new Error('No way to reach OpenRouter — sign in under Settings → Account, or add its key under Developer → API keys.');
  }

  const reasoning = reasoningEffort(effort);
  const chat = toChat(system, cachePriorTurn(messages));
  log.info(`asking ${model}${reasoning ? ` (effort ${reasoning})` : ''}: ${requestShape(system, tools, chat)}`);
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      messages: chat as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      ...(tools.length > 0 ? { tools: toChatTools(tools) } : {}),
      // OpenRouter normalizes max_tokens for every model it fronts.
      max_tokens: maxTokens,
      // Its one reasoning parameter, mapped onto each vendor's own.
      ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    { signal },
  );

  let text = '';
  const calls: Array<{ id: string; name: string; args: string }> = [];
  let truncated = false;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    if (choice.delta?.content) {
      text += choice.delta.content;
      handlers.onTextDelta(choice.delta.content);
    }
    for (const call of choice.delta?.tool_calls ?? []) {
      const slot = (calls[call.index] ??= { id: '', name: '', args: '' });
      if (call.id) slot.id = call.id;
      if (call.function?.name) {
        slot.name += call.function.name;
        // The name arrives with the first fragment, long before the argument
        // JSON finishes — a big draw call is seconds of silence otherwise.
        handlers.onToolUseStart?.(slot.name);
      }
      if (call.function?.arguments) slot.args += call.function.arguments;
    }
    if (choice.finish_reason === 'length') truncated = true;
  }

  const blocks: ContentBlockParam[] = [];
  if (text.trim()) blocks.push({ type: 'text', text });
  calls.forEach((call, index) => {
    const input = parseArgs(call.args);
    const id = call.id || `call_${Date.now()}_${index}`;
    log.info(`tool ${toolLabel(call.name, input)}`);
    handlers.onToolUse(id, call.name, input);
    blocks.push({ type: 'tool_use', id, name: call.name, input });
  });
  if (truncated) {
    log.warn(`response hit the ${maxTokens}-token ceiling and was cut off`);
    handlers.onTruncated?.();
  }
  // History is Anthropic-shaped, and an empty text block is not a valid one.
  if (blocks.length === 0) blocks.push({ type: 'text', text: '(the model said nothing)' });
  return blocks;
}

/**
 * Roughly what the request weighs, for the log: the cached head (tools and
 * the system prompt's head, in thousands of characters), the live tail, the
 * history, and how many images ride along. ~4 characters to a token.
 */
function requestShape(system: string, tools: Tool[], chat: ChatMessage[]): string {
  const [head, live] = splitSystem(system);
  const k = (chars: number) => `${(chars / 1000).toFixed(1)}k`;
  let history = 0;
  let images = 0;
  for (const message of chat.slice(1)) {
    if (typeof message.content === 'string') history += message.content.length;
    for (const part of Array.isArray(message.content) ? message.content : []) {
      if (part.type === 'text') history += part.text.length;
      else images += 1;
    }
    for (const call of message.tool_calls ?? []) history += call.function.arguments.length;
  }
  return `cached head ${k(JSON.stringify(tools).length + head.length)} (${tools.length} tools), live ${k(live.length)}, history ${k(history)}, ${images} images`;
}

/** How much of a call's arguments the log shows: enough to see the target and the words, never a document. */
const LOG_ARGS_CHARS = 160;

/** `computer click_element {"ref":"e3",…}`: the tool, its action, and its arguments clipped. */
export function toolLabel(name: string, input: unknown): string {
  if (input === null || typeof input !== 'object') return name;
  const { action, ...rest } = input as { action?: unknown } & Record<string, unknown>;
  const head = name === 'computer' && typeof action === 'string' ? `computer ${action}` : name;
  const args = JSON.stringify(name === 'computer' ? rest : input);
  return args === '{}' ? head : `${head} ${args.length > LOG_ARGS_CHARS ? `${args.slice(0, LOG_ARGS_CHARS)}…` : args}`;
}

function parseArgs(args: string): Record<string, unknown> {
  try {
    return args ? (JSON.parse(args) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
