// Which effort a cloud call actually sends. Auto-detect is decided here, once,
// from the kind of turn. The settings UI only stores the user's choice.

import type { BrainEffort, ModelEffort } from '../../shared/types';

/** A short answer, or a long tool loop. Auto-detect spends less on the first. */
export type EffortJob = 'answer' | 'task';

/** Auto-detect is low for a spoken answer or a distillation, medium for a walkthrough or an agent task. */
export function resolveEffort(setting: BrainEffort, job: EffortJob): ModelEffort {
  if (setting !== 'auto') return setting;
  return job === 'answer' ? 'low' : 'medium';
}

/** The levels OpenRouter's unified reasoning parameter takes. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * OpenRouter maps one `reasoning.effort` onto each vendor's own parameter.
 * Its scale tops out at xhigh, so Anthropic's max lands there. A model that
 * refuses the field is retried without it in brain.ts.
 */
export function reasoningEffort(effort: ModelEffort | undefined): ReasoningEffort | undefined {
  if (!effort) return undefined;
  return effort === 'max' ? 'xhigh' : effort;
}
