// Which cloud models a plan can run. The API sends prefixes (anthropic/claude-haiku
// covers every Haiku id). The picker and the stored model both use this.

/** True when the plan's prefixes cover this model id. A leading ~ is an alias. */
export function modelOnPlan(model: string, allowed: readonly string[]): boolean {
  const id = model.replace(/^~/, '');
  return allowed.some((prefix) => prefix.length > 0 && id.startsWith(prefix));
}

/**
 * The model to store: the one they picked when the plan includes it, otherwise
 * the fast model every plan has.
 */
export function modelForPlan(model: string, allowed: readonly string[], fast: string): string {
  if (modelOnPlan(model, allowed)) return model;
  if (modelOnPlan(fast, allowed)) return fast;
  return allowed.find((prefix) => prefix.length > 0) ?? fast;
}

/**
 * Cloud starters after a provider switch. An empty allow-list means any model
 * (their own key, or the plan has not loaded). Otherwise a starter the
 * plan excludes becomes the fast model.
 */
export function cloudModelsForPlan(
  model: string,
  fast: string,
  allowed: readonly string[],
): { brainModel: string; brainFastModel: string } {
  if (allowed.length === 0) return { brainModel: model, brainFastModel: fast };
  return {
    brainModel: modelForPlan(model, allowed, fast),
    brainFastModel: modelForPlan(fast, allowed, fast),
  };
}

interface BrainModels {
  brainModel: string;
  brainFastModel: string;
}

/**
 * The stored cloud models fitted to a plan. A model the plan excludes
 * becomes the fast one. When the plan just grew to include the think-hard
 * starter (`previous` did not have it) and the brain sits on the fast model,
 * the starter comes back: that is where the narrower plan had pushed it.
 */
export function brainForPlan(
  stored: BrainModels,
  starter: { model: string; fastModel: string },
  allowed: readonly string[],
  previous: readonly string[] | null,
): BrainModels {
  const fast = starter.fastModel;
  const regained =
    previous !== null && !modelOnPlan(starter.model, previous) && modelOnPlan(starter.model, allowed);
  const brainModel =
    regained && stored.brainModel === fast ? starter.model : modelForPlan(stored.brainModel, allowed, fast);
  return { brainModel, brainFastModel: modelForPlan(stored.brainFastModel, allowed, fast) };
}

/**
 * Prefixes the model menu must honor. Empty when any model is fine: signed out,
 * the plan hasn't loaded, or they are on their own OpenRouter key.
 */
export function modelsForPicker(
  account: { signedIn: boolean; models: readonly string[] } | null,
  ownOpenRouterKey: boolean,
): readonly string[] {
  if (!account?.signedIn || ownOpenRouterKey) return [];
  return account.models;
}
