// Streaming Ollama client: the free, local, open-weight brain. Speaks the
// same contract as streamClaude — Anthropic-shaped messages and tools in,
// text deltas and tool_use blocks out — so the tool loop cannot tell which
// brain is answering and history stays in one format.

import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { totalmem } from 'node:os';
import { promisify } from 'node:util';
import { type KeyTestResult, type OllamaStatus } from '../../shared/types';
import { createLogger } from '../log';
import { truncateResult } from '../mcp/results';
import { getSettings } from '../settings';
import { broadcast } from '../windows';
import type { ModelStreamHandlers } from './loop';
import { splitSystem } from './prompt-cache';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('ollama');
const execFileAsync = promisify(execFile);

/**
 * Ollama keeps the end of a prompt that overflows its context and drops the
 * front, where the system prompt and tools sit, which reads as the model
 * ignoring its instructions. 16k stays runnable on 16 GB; with 32 GB there is
 * room for a turn's full prompt, tools, and screenshots.
 */
const NUM_CTX = totalmem() >= 32 * 2 ** 30 ? 32_768 : 16_384;
/** These always reason, and default to a level that keeps a spoken reply waiting. */
const REASONS_LOW = /^(gpt-oss|muse-glimmer)(:|$)/;
/** Ollama unloads after 5 idle minutes, and every cold load stalls a turn. */
const KEEP_ALIVE_MS = 30 * 60_000;
/**
 * About 1,500 tokens of any one tool result. A local model reads a few
 * hundred tokens a second, and one web search returns thousands.
 */
const LOCAL_RESULT_CHARS = 6_000;
/** A cold 8B reads a full prompt in about a minute; give a slower Mac room. */
const WARM_TIMEOUT_MS = 5 * 60_000;

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Base64 images, no data: prefix. */
  images?: string[];
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  /** Which tool a role:'tool' message answers. */
  tool_name?: string;
}

interface OllamaTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/**
 * Anthropic-shaped history → Ollama chat messages. Exported for tests.
 * Screenshots inside tool results are dropped with a note: the local models
 * we target take images only on user turns.
 */
export function toOllamaChat(system: string, messages: MessageParam[]): OllamaMessage[] {
  // Ollama reuses whatever start of the prompt matches the last request, and
  // the template puts the tools after the system message. A live tail there
  // (the front app's notes) would make every turn re-read all the tools, so
  // the tail rides on the latest ask instead.
  const [head, live] = splitSystem(system);
  const chat: OllamaMessage[] = [{ role: 'system', content: head }];
  // tool_result blocks carry only the tool_use id; Ollama wants the name.
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    if (typeof message.content === 'string') {
      chat.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const texts: string[] = [];
      const calls: NonNullable<OllamaMessage['tool_calls']> = [];
      for (const block of message.content) {
        if (block.type === 'text') texts.push(block.text);
        if (block.type === 'tool_use') {
          toolNames.set(block.id, block.name);
          calls.push({
            function: { name: block.name, arguments: (block.input ?? {}) as Record<string, unknown> },
          });
        }
      }
      chat.push({
        role: 'assistant',
        content: texts.join('\n'),
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }
    // A user turn: tool results become role:'tool' messages; whatever is
    // left (text and screenshots) becomes one user message after them.
    const texts: string[] = [];
    const images: string[] = [];
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        chat.push({
          role: 'tool',
          content: flattenToolResult(block.content),
          ...(toolNames.has(block.tool_use_id)
            ? { tool_name: toolNames.get(block.tool_use_id) }
            : {}),
        });
      } else if (block.type === 'text') {
        texts.push(block.text);
      } else if (block.type === 'image' && block.source.type === 'base64') {
        images.push(block.source.data);
      } else if (block.type === 'document') {
        // Local models take images only; the file's name is all that can reach it.
        texts.push(`[${block.title ?? 'A PDF'} was attached, but this model cannot read PDFs. Say so.]`);
      }
    }
    if (texts.length > 0 || images.length > 0) {
      chat.push({
        role: 'user',
        content: texts.join('\n'),
        ...(images.length > 0 ? { images } : {}),
      });
    }
  }
  if (live) {
    const ask = chat.findLast((message) => message.role === 'user');
    if (ask) ask.content = `${live}\n\n${ask.content}`;
    else chat[0].content = `${head}\n\n${live}`;
  }
  return chat;
}

function flattenToolResult(content: ToolResultBlockParam['content']): string {
  const text =
    typeof content === 'string'
      ? content
      : (content ?? []).map((block) => (block.type === 'text' ? block.text : '[screenshot omitted]')).join('\n');
  return truncateResult(text, LOCAL_RESULT_CHARS);
}

/**
 * The chat without its screenshots, each noted as missing so a text-only
 * model knows it cannot see the screen instead of guessing at it.
 * Exported for tests.
 */
export function stripImages(chat: OllamaMessage[]): OllamaMessage[] {
  return chat.map((message) => {
    if (!message.images) return message;
    const { images: _images, ...rest } = message;
    return { ...rest, content: `${rest.content}\n[screenshots omitted: this model cannot see images]`.trim() };
  });
}

/**
 * Tools the local brain never sees. The drawing schemas (shape grammars,
 * anchor specs) reliably overwhelm the small models we target — a mangled
 * draw call wastes the whole turn. And agent tasks run on the cloud brain,
 * so with it unavailable an approved propose_task could only fail after the
 * user said yes to it. The guide prompt leaves out both for the same reason
 * (GuideContext.local).
 */
const LOCAL_TOOL_SKIP = new Set(['draw', 'update_drawing', 'erase', 'propose_task']);
/**
 * What a tool does, without the when-and-how that follows: a local model
 * reads every description at a few hundred tokens a second on each cold
 * start, and the guide prompt carries the routing.
 */
const FIRST_SENTENCE = /^.+?[.!?](?=\s|$)/s;

/** Anthropic tool definitions → Ollama function-calling tools. */
export function toOllamaTools(tools: Tool[]): OllamaTool[] {
  return tools.flatMap((tool): OllamaTool[] => {
    if (LOCAL_TOOL_SKIP.has(tool.name)) return [];
    const description = tool.description?.trim() ?? '';
    return [{
      type: 'function',
      function: {
        name: tool.name,
        description: description.match(FIRST_SENTENCE)?.[0] ?? description,
        parameters: tool.input_schema as Record<string, unknown>,
      },
    }];
  });
}

/**
 * Ollama keeps one cache: the last request it read. When that request began
 * with the same model, system prompt, and tools, they are still cached.
 */
let lastHead = { key: '', at: 0 };
const headKey = (model: string, chat: OllamaMessage[], tools: Tool[]): string =>
  `${model}\n${chat[0].content}\n${JSON.stringify(tools)}`;

/** POST one chat request; `extra` overrides the streaming defaults. */
async function postChat(
  model: string,
  chat: OllamaMessage[],
  tools: Tool[],
  signal: AbortSignal,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const url = getSettings().ollamaUrl;
  // Set as it's sent: Ollama answers a streaming request only once it has read it.
  lastHead = { key: headKey(model, chat, tools), at: Date.now() };
  try {
    const response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: chat,
        tools: toOllamaTools(tools),
        stream: true,
        ...(REASONS_LOW.test(model) ? { think: 'low' } : {}),
        keep_alive: `${KEEP_ALIVE_MS / 1000}s`,
        options: { num_ctx: NUM_CTX },
        ...extra,
      }),
      signal,
    });
    if (!response.ok) lastHead = { key: '', at: 0 };
    return response;
  } catch (error) {
    lastHead = { key: '', at: 0 };
    if (signal.aborted) throw error;
    throw new Error(`Ollama isn't reachable at ${url} — start the Ollama app and try again.`);
  }
}

/**
 * Read a system prompt and tools into Ollama's cache before anyone asks, so
 * the first turn doesn't spend a minute on them while the user waits. The
 * one-token reply is thrown away. Skipped when they are already cached: a
 * warm-up then would only cut the last conversation out of the cache.
 */
export async function warmOllama(system: string, tools: Tool[], model: string): Promise<void> {
  const chat = toOllamaChat(system, []);
  if (lastHead.key === headKey(model, chat, tools) && Date.now() - lastHead.at < KEEP_ALIVE_MS) return;
  const started = Date.now();
  const response = await postChat(model, chat, tools, AbortSignal.timeout(WARM_TIMEOUT_MS), {
    stream: false,
    options: { num_ctx: NUM_CTX, num_predict: 1 },
  });
  const detail = (await response.text()).slice(0, 300);
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}: ${detail}`);
  log.info(`warmed ${model} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

/** Send one streaming request and return the assistant's full content blocks. */
export async function streamOllama(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  handlers: ModelStreamHandlers,
  signal: AbortSignal,
  model: string,
): Promise<ContentBlockParam[]> {
  const post = (chat: OllamaMessage[]): Promise<Response> => postChat(model, chat, tools, signal);

  log.info(`asking ${model} (local)`);
  let response = await post(toOllamaChat(system, messages));
  if (response.status === 400) {
    // A text-only model refuses the whole request over the screenshots.
    // Nothing has streamed yet, so drop the images and ask again — a blind
    // answer beats a failed turn.
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (!/multimodal/i.test(detail)) throw new Error(`Ollama HTTP 400: ${detail}`);
    log.warn(`${model} has no vision; retrying without screenshots`);
    response = await post(stripImages(toOllamaChat(system, messages)));
  }
  if (response.status === 404) {
    throw new Error(`The local model "${model}" isn't installed — download it in Settings → Providers.`);
  }
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`Ollama HTTP ${response.status}: ${detail}`);
  }

  let text = '';
  const blocks: ContentBlockParam[] = [];
  let calls = 0;
  for await (const chunk of ndjson<{
    message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> };
    error?: string;
  }>(response.body)) {
    if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
    const delta = chunk.message?.content ?? '';
    if (delta) {
      text += delta;
      handlers.onTextDelta(delta);
    }
    for (const call of chunk.message?.tool_calls ?? []) {
      // Ollama delivers each call complete, so start and finish land together.
      const id = `local_${Date.now()}_${calls++}`;
      log.info(`tool ${call.function.name}`);
      handlers.onToolUseStart?.(call.function.name);
      handlers.onToolUse(id, call.function.name, call.function.arguments);
      blocks.push({ type: 'tool_use', id, name: call.function.name, input: call.function.arguments });
    }
  }

  // Anthropic rejects empty text blocks, and this history may reach Claude
  // later (key fixed mid-conversation) — never record one.
  if (text.trim()) blocks.unshift({ type: 'text', text });
  if (blocks.length === 0) blocks.push({ type: 'text', text: '(the local model said nothing)' });
  return blocks;
}

/** Yield each JSON object of a newline-delimited stream. */
async function* ndjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
}

// --- Settings-page helpers ----------------------------------------------------

/** Is Ollama running, and which models does it have? Fast and never throws. */
export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const response = await fetch(`${getSettings().ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return { running: true, models: (data.models ?? []).map((entry) => entry.name) };
  } catch {
    return { running: false, models: [] };
  }
}

/** Where Homebrew puts itself; a GUI app's PATH does not include either. */
const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];

/**
 * Install Ollama through Homebrew and start it, so the user need not leave
 * Buddy. Without Homebrew, says so; the page then falls back to the download.
 */
export async function installOllama(): Promise<KeyTestResult> {
  const brew = BREW_PATHS.find((path) => existsSync(path));
  if (!brew) return { ok: false, message: 'Homebrew is not installed, so Buddy cannot install Ollama itself.' };
  try {
    log.info('installing ollama with brew');
    await execFileAsync(brew, ['install', 'ollama'], { timeout: 10 * 60_000 });
    await execFileAsync(brew, ['services', 'start', 'ollama'], { timeout: 60_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, message: `Homebrew could not install Ollama: ${detail}` };
  }
  // brew services comes up in a moment; wait for the API rather than reporting early.
  for (let tries = 0; tries < 10; tries++) {
    if ((await ollamaStatus()).running) return { ok: true, message: 'Ollama is installed and running.' };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, message: 'Ollama installed but has not started yet. Open the Ollama app to start it.' };
}

/** Download a model, broadcasting progress ticks to the settings window. */
export async function pullOllamaModel(model: string): Promise<KeyTestResult> {
  try {
    const response = await fetch(`${getSettings().ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      return { ok: false, message: `Ollama HTTP ${response.status}: ${detail}` };
    }
    let lastPercent = -1;
    for await (const chunk of ndjson<{ error?: string; total?: number; completed?: number }>(
      response.body,
    )) {
      if (chunk.error) return { ok: false, message: chunk.error };
      if (!chunk.total || !chunk.completed) continue;
      // Whole percents only: the ticks arrive far too often to forward raw.
      const percent = Math.floor((chunk.completed / chunk.total) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        broadcast(IpcChannels.ollamaPullProgress, { model, percent });
      }
    }
    log.info(`pulled ${model}`);
    return { ok: true, message: `${model} is ready.` };
  } catch {
    return { ok: false, message: 'Ollama isn\'t reachable — start the Ollama app and try again.' };
  }
}
