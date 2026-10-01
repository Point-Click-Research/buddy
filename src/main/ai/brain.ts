// Which brain answers a turn: the cloud (every model through OpenRouter)
// when its key exists and works, with the local Ollama model as the
// fallback; picking 'ollama' itself means local always, no cloud tried. The
// same demotion pattern as the voices in speech/tts.ts — a dead key is
// retired for the run with one visible explanation, instead of failing every
// turn the same way.

import type { ContentBlockParam, MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { BRAIN_PROVIDERS, type ModelEffort } from '../../shared/types';
import { createLogger } from '../log';
import { managedModels } from '../account/api';
import { providerReady, SIGN_IN_MESSAGE, signInRequired } from '../account/credentials';
import { isOnDemandRequired, offerOnDemand } from '../account/on-demand';
import { getApiKey, getSettings } from '../settings';
import { broadcast } from '../windows';
import { isBudgetExceeded, isDeadKey, isNetworkError, noteKeyFailure } from './api-errors';
import { resolveEffort } from './effort';
import type { ModelStreamHandlers } from './loop';
import { streamOllama, warmOllama } from './ollama';
import { streamOpenRouter } from './openrouter';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('brain');

/** The one cloud provider, and the key every cloud model bills to. */
const CLOUD = 'openrouter';

// Spoken answers are short, but one draw call describing a whole route can
// run to thousands of tokens of JSON. Hitting the ceiling truncates that
// call mid-object, so the shape is rejected and the turn has nothing to say.
// Unused headroom costs nothing: only generated tokens are billed.
const GUIDE_MAX_TOKENS = 8192;

export interface StreamOverrides {
  /** Defaults to the thinking model from settings. */
  model?: string;
  /**
   * Used when `model` turns out not to exist on this account — a typo in
   * settings, or a tier that doesn't include it. Losing the answer over a
   * model name is a worse outcome than answering a little slower.
   */
  fallbackModel?: string;
  /** Agent turns need more room than spoken answers. */
  maxTokens?: number;
  /**
   * Already resolved (Auto-detect applied). Omitted for the fast model,
   * which has no effort setting. Dropped when the model cannot take it.
   */
  effort?: ModelEffort;
}

/** The cloud brain's key died this run. In memory only, like tts's demoted set. */
let demoted = false;

/** A new or freshly tested brain key means retry the cloud next turn. */
export function reviveBrain(): void {
  demoted = false;
}

/** Models this account turned out not to have. We stop asking for them. */
const unavailable = new Set<string>();

/** Models that refused an effort level once. Sending it again would only buy another 400 and a second request. */
const noEffort = new Set<string>();

/** Models already swapped for the plan this run, so the notice shows once each. */
const swapped = new Set<string>();

/**
 * The model to ask for on Buddy's keys: the one wanted when the plan
 * includes it, otherwise the fast model, which every plan has. On Pro, the
 * user's own key is never limited this way. On Free it is ignored.
 */
function planModel(wanted: string): string {
  if (getApiKey(CLOUD)) return wanted;
  const allowed = managedModels();
  // OpenRouter's rolling aliases wear a leading tilde (~openai/gpt-sol-latest);
  // the vendor behind it is what the plan lists.
  const id = wanted.replace(/^~/, '');
  if (allowed === null || allowed.some((prefix) => id.startsWith(prefix))) return wanted;
  const fast = BRAIN_PROVIDERS[CLOUD].fastModel;
  if (!swapped.has(wanted)) {
    swapped.add(wanted);
    log.warn(`${wanted} is not in this plan; using ${fast}`);
    broadcast(IpcChannels.sessionError, `${wanted} isn't in your plan, so Buddy is using ${fast}. Upgrade under Settings → Account for the full lineup.`);
  }
  return fast;
}

/**
 * One streaming turn on the cloud — no local fallback. Agent mode and
 * distillation use this directly: their work needs the cloud brain or none
 * at all.
 */
export async function streamCloud(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  handlers: ModelStreamHandlers,
  signal: AbortSignal,
  overrides: StreamOverrides = {},
): Promise<ContentBlockParam[]> {
  const settings = getSettings();
  const maxTokens = overrides.maxTokens ?? GUIDE_MAX_TOKENS;
  const send = (model: string, effort: ModelEffort | undefined): Promise<ContentBlockParam[]> =>
    streamOpenRouter(messages, system, tools, handlers, signal, model, maxTokens, effort);
  // A 400 for an unsupported effort level happens before any text streams, so
  // one retry without the field cannot double up an answer or a tool call.
  const ask = async (model: string): Promise<ContentBlockParam[]> => {
    const effort = noEffort.has(model) ? undefined : overrides.effort;
    try {
      return await send(model, effort);
    } catch (error) {
      if (!effort || !isEffortRejected(error)) throw error;
      noEffort.add(model);
      log.warn(`${model} does not take an effort level; sending it without one from now on`);
      return send(model, undefined);
    }
  };

  const wanted = planModel(overrides.model || settings.brainModel);
  const fallback = overrides.fallbackModel && planModel(overrides.fallbackModel);
  const request = async (): Promise<ContentBlockParam[]> => {
    // A model we already know this account lacks isn't worth a second 404.
    if (fallback && unavailable.has(wanted)) return ask(fallback);
    try {
      return await ask(wanted);
    } catch (error) {
      // The request is rejected before any content streams, so retrying can't
      // double up on text or re-run a tool call.
      if (!fallback || fallback === wanted || !isUnknownModel(error)) throw error;
      unavailable.add(wanted);
      log.warn(`${wanted} is not available on this account; using ${fallback} instead`);
      return ask(fallback);
    }
  };
  try {
    return await request();
  } catch (error) {
    // The pool is spent and extra usage is off: the API refuses before any
    // content streams, so one yes on the card and the same call goes again.
    if (isOnDemandRequired(error) && !signal.aborted && (await offerOnDemand(signal))) return request();
    // Every cloud turn (guide, agent, side jobs) passes here, so a refused or
    // out-of-credits key lands on the Providers page whichever path hit it.
    noteKeyFailure(CLOUD, error);
    throw error;
  }
}

/**
 * One streaming model turn by whichever brain is available. The cloud first;
 * the local model when 'ollama' is the picked provider, when there is no key,
 * in airplane mode, or when the cloud fails before anything has streamed —
 * with the reason shown to the user. No local model configured = the
 * original error.
 */
export async function streamBrain(
  messages: MessageParam[],
  system: string,
  tools: Tool[],
  handlers: ModelStreamHandlers,
  signal: AbortSignal,
  overrides: StreamOverrides = {},
): Promise<ContentBlockParam[]> {
  const settings = getSettings();
  const local = settings.ollamaModel;
  const cloud = settings.brainProvider !== 'ollama';
  if (!answersLocally()) {
    // The fallback is only safe while nothing has reached the user: spoken
    // text or an executed tool call must not happen twice. Track both.
    let streamed = false;
    const watched: ModelStreamHandlers = {
      ...handlers,
      onTextDelta: (delta) => {
        streamed = true;
        handlers.onTextDelta(delta);
      },
      onToolUse: (id, name, input) => {
        streamed = true;
        handlers.onToolUse(id, name, input);
      },
    };
    try {
      return await streamCloud(messages, system, tools, watched, signal, overrides);
    } catch (error) {
      // Set this before bailing out, so a turn with no local model still
      // stops asking on the next step.
      if (isDeadKey(error)) demoted = true;
      // A spent allowance is an answer, not an outage: the user hears the
      // spent-credit line rather than the local model standing in.
      if (!local || streamed || signal.aborted || isBudgetExceeded(error)) throw error;
      log.warn(`${CLOUD} failed (${errorMessage(error)}); switching to local model ${local}`);
      broadcast(IpcChannels.sessionError, fallbackNotice(error));
    }
  } else if (signInRequired()) {
    throw new Error(SIGN_IN_MESSAGE);
  } else if (!local) {
    throw new Error(
      !cloud
        ? 'The local brain is selected, but no Ollama model is set. Pick one in Settings → Brain.'
        : settings.airplaneMode
          ? 'Airplane mode is on, but no local model is set. Pick one in Settings → Brain.'
          : 'OpenRouter API key missing — open Settings to add one, or set up a free local model under Brain.',
    );
  }
  return streamOllama(messages, system, tools, handlers, signal, local);
}

/** Whether a turn starting now goes to the local model rather than the cloud. */
export function answersLocally(): boolean {
  const settings = getSettings();
  return settings.brainProvider === 'ollama' || !providerReady(CLOUD) || demoted || settings.airplaneMode;
}

/** Cache this prompt and these tools in the local model, when the next turn goes to it. */
export async function warmBrain(system: string, tools: Tool[]): Promise<void> {
  const local = getSettings().ollamaModel;
  if (local && answersLocally()) await warmOllama(system, tools, local);
}

/**
 * The overrides for a short side-job — naming a conversation, distilling a
 * run. These ride the fast model when one is set, and must never tie up the
 * thinking model the answer itself needs.
 */
export function fastOverrides(): StreamOverrides {
  const settings = getSettings();
  return {
    model: settings.brainFastModel,
    fallbackModel: settings.brainModel,
    ...(settings.brainFastModel ? {} : { effort: resolveEffort(settings.brainEffort, 'answer') }),
  };
}

/** One toolless turn, collected into the text it streamed. */
export async function askBrain(
  prompt: string,
  system: string,
  signal: AbortSignal,
  overrides: StreamOverrides = {},
): Promise<string> {
  let text = '';
  await streamBrain(
    [{ role: 'user', content: prompt }],
    system,
    [],
    {
      onTextDelta: (delta) => {
        text += delta;
      },
      onToolUse: () => undefined,
    },
    signal,
    overrides,
  );
  return text.trim();
}

/** A 400 naming the effort or reasoning field: this model has no such parameter. */
function isEffortRejected(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  const detail = errorMessage(error);
  return status === 400 && /effort|reasoning/i.test(detail);
}

/** A 400/404 naming the model: the slug is wrong, or this account can't use it. */
function isUnknownModel(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  const detail = errorMessage(error);
  return (status === 404 || status === 400) && /model/i.test(detail);
}

/** Why Buddy is switching brains, in words the user can act on. */
function fallbackNotice(error: unknown): string {
  if (isDeadKey(error)) {
    return 'The OpenRouter key was refused or is out of credits — using the local model instead. Fix it in Settings → Providers.';
  }
  if (isNetworkError(error)) {
    return 'No internet connection. Answering with the local model until it is back.';
  }
  return "OpenRouter isn't answering right now. Using the local model for this one.";
}
