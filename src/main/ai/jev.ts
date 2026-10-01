// Jev, TypeSafe's System One model: typed decisions with calibrated
// confidence at sub-second latency, and no text generation at all. Buddy
// uses it for the small structured choices a frontier-model turn is too slow
// for — which element a description names, whether a condition holds of a
// window, which tool a spoken ask ends in — never for planning. Every call
// site keeps its pre-Jev behaviour as the fallback: no key, a failed call,
// or low confidence means acting exactly as before.
//
// One request carries one `state` and any number of typed questions,
// answered in parallel (POST /v1/systemone). A Choice returns the chosen
// label with a confidence derived from how the probability spread; a Noul
// returns the probability that a yes/no question is true.
//
// Electron-free at the top level on purpose: account credentials are
// imported lazily, so pure modules and their tests can take the types and
// thresholds from here without loading Electron.

import { choice, noul, TypeSafeClient, type EntryType, type Questions } from '@typesafe-ai/sdk';
import { errorMessage } from '../../shared/errors';
import { createLogger } from '../log';

const log = createLogger('jev');

/** What Jev evaluates: a string, or an object whose field names it can be pointed at. */
export type JevState = EntryType;

/** Option label -> what it means, or null when the label says it all. */
export type JevOptions = Record<string, string | null>;

export interface JevAsk {
  question: string;
  options: JevOptions;
}

export interface JevChoice {
  /** The chosen option's label. */
  choice: string;
  /** 0..1, from how the probability spread across the options: 1 is one clear peak. */
  confidence: number;
}

export interface Jev {
  /** Several one-of-many questions about one state, in one round trip. Null per question Jev could not answer. */
  choices<K extends string>(state: JevState, asks: Record<K, JevAsk>): Promise<Record<K, JevChoice | null>>;
  /** The probability a yes/no question is true of the state, or null. */
  judge(state: JevState, question: string): Promise<number | null>;
}

/** A Choice answers one of up to this many options. */
export const JEV_MAX_OPTIONS = 255;
/** Below this confidence Buddy falls back instead of acting on a choice. */
export const JEV_CONFIDENT = 0.8;
/** A yes/no probability at or above this reads as yes. */
export const JEV_YES = 0.8;
/** A decision that takes longer than this is slower than the model turn it saves. */
const TIMEOUT_MS = 5_000;

/** One one-of-many question. */
export async function decide(
  jev: Jev,
  state: JevState,
  question: string,
  options: JevOptions,
): Promise<JevChoice | null> {
  return (await jev.choices(state, { pick: { question, options } })).pick;
}

/** Jev for this user: their own key, or Buddy's through the API. Null when neither can serve it, or in airplane mode. */
export async function jev(): Promise<Jev | null> {
  const { getSettings } = await import('../settings');
  if (getSettings().airplaneMode) return null;
  const { credentials } = await import('../account/credentials');
  const auth = await credentials('jev');
  return auth ? fromClient(jevClient(auth.apiKey, auth.baseURL)) : null;
}

export function jevClient(apiKey: string, baseURL?: string): TypeSafeClient {
  // One quick retry covers a 429/529 blip; more would outlast the turn.
  return new TypeSafeClient({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    timeout: TIMEOUT_MS,
    retry: { maxRetries: 1 },
    logLevel: 'off',
  });
}

/** The SDK call Buddy makes, narrowed so tests can hand in a fake. */
export type SystemOne = (request: { state: JevState; questions: Questions }) => Promise<{
  answers: Record<string, unknown>;
}>;

export function fromClient(client: Pick<TypeSafeClient, 'systemOne'>): Jev {
  return fromSystemOne((request) => client.systemOne(request));
}

export function fromSystemOne(systemOne: SystemOne): Jev {
  const ask = async (
    state: JevState,
    questions: Questions,
  ): Promise<{ answers: Record<string, unknown>; ms: number }> => {
    const started = Date.now();
    try {
      return { answers: (await systemOne({ state, questions })).answers, ms: Date.now() - started };
    } catch (error) {
      log.warn(`failed after ${Date.now() - started} ms: ${errorMessage(error)}`);
      return { answers: {}, ms: Date.now() - started };
    }
  };
  return {
    async choices(state, asks) {
      const entries = Object.entries(asks) as [string, JevAsk][];
      const questions: Questions = {};
      for (const [name, { question, options }] of entries) {
        const count = Object.keys(options).length;
        if (count >= 2 && count <= JEV_MAX_OPTIONS) questions[name] = choice(question, options);
      }
      if (Object.keys(questions).length === 0) {
        return Object.fromEntries(entries.map(([name]) => [name, null])) as Record<keyof typeof asks, JevChoice | null>;
      }
      const { answers, ms } = await ask(state, questions);
      const read = entries.map(([name, { options }]) => [name, readChoice(answers[name], Object.keys(options))] as const);
      log.info(`${read.map(([name, answer]) => `${name}=${answer ? `${answer.choice} ${answer.confidence.toFixed(2)}` : 'none'}`).join(' · ')} (${ms} ms)`);
      return Object.fromEntries(read) as Record<keyof typeof asks, JevChoice | null>;
    },
    async judge(state, question) {
      const { answers, ms } = await ask(state, { yes: noul(question) });
      const p = readNoul(answers.yes);
      log.info(`"${question.slice(0, 60)}" yes=${p === null ? 'none' : p.toFixed(2)} (${ms} ms)`);
      return p;
    },
  };
}

/**
 * Read one Choice answer defensively: the label must be one that was
 * offered and the confidence a real number. Anything else is "no answer",
 * never a confident one.
 */
export function readChoice(answer: unknown, labels: readonly string[]): JevChoice | null {
  if (!answer || typeof answer !== 'object') return null;
  const { choice: label, confidence } = answer as { choice?: unknown; confidence?: unknown };
  if (typeof label !== 'string' || !labels.includes(label)) return null;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  return { choice: label, confidence };
}

export function readNoul(answer: unknown): number | null {
  if (!answer || typeof answer !== 'object') return null;
  const { noul: p } = answer as { noul?: unknown };
  return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
}
