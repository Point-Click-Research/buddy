// Distill a finished agent run into a reusable workflow recipe, then
// optionally offer to save it as a skill so the next similar task can load it.

import type { AgentLogEntry } from '../../shared/types';
import { askBrain, fastOverrides } from '../ai/brain';
import { createLogger } from '../log';
import { requestEditableConfirmation } from '../mcp/confirm';
import { getSettings, updateSettings } from '../settings';
import { parseRecipe, recipeToSkill, similarSkill } from './distill-recipe';

const log = createLogger('distill');

/** Anything shorter taught the run nothing worth reusing. */
const MIN_ACTIONS = 3;
/** Results carry element trees; a recipe needs the gist, not the tree. */
const MAX_RESULT_CHARS = 240;
const TIMEOUT_MS = 60_000;
const CARD_TIMEOUT_MS = 5 * 60_000;

const SYSTEM = `You are distilling one successful computer-driving session into a compact, reusable workflow recipe, so the same kind of task runs faster and straighter next time.

Write exactly these sections:
name: a short kebab-case name for the workflow.
task: the goal as a template, with this run's specifics replaced by {parameters}.
preconditions: what must already be true (apps present, an account signed in, something on screen).
steps: the shortest route that worked, in order, in semantic terms — the app's name, the menu path, an element's role and label. Never refs, coordinates, frame ids or observation ids: none survive to the next run. Fold retries and dead ends into the step that finally worked. Where a value changes per run, use the {parameters} from the task line.
checks: what to verify before calling it done (the message shows as sent, the file exists).

Be brief — the recipe is read by the model that will run it. If the log shows the task never actually completed, or the route was too erratic to trust, reply with exactly UNRELIABLE and nothing else.`;

/**
 * Distill one run into a recipe string. Never throws: a failed distillation
 * must cost the finished task nothing.
 */
async function distillWorkflow(goal: string, entries: AgentLogEntry[]): Promise<string | null> {
  if (entries.length < MIN_ACTIONS) return null;
  try {
    const lines = entries.map((entry) => {
      const result =
        entry.result.length > MAX_RESULT_CHARS ? `${entry.result.slice(0, MAX_RESULT_CHARS)}…` : entry.result;
      return `${entry.index}. ${entry.action} ${entry.args}\n   why: ${entry.reasoning || '(none)'}\n   result: ${result}`;
    });
    // streamBrain falls through to Ollama in airplane mode or when the cloud
    // is unavailable.
    const recipe = await askBrain(
      `The task: ${goal}\n\nThe actions, in order:\n${lines.join('\n')}`,
      SYSTEM,
      AbortSignal.timeout(TIMEOUT_MS),
      fastOverrides(),
    );
    if (recipe === 'UNRELIABLE' || !recipe) {
      log.info(`no reliable recipe in "${goal}" (${entries.length} actions)`);
      return null;
    }
    log.info(`workflow recipe distilled from "${goal}" (${entries.length} actions):\n${recipe}`);
    return recipe;
  } catch (error) {
    log.warn(`distillation failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Distill, then offer to save the recipe as a skill — unless the setting is
 * off, or a saved skill already covers this workflow. The card is editable,
 * so the wording (and the name) can be fixed before it is saved. Call after
 * the agent task has fully cleaned up so the card is not dismissed.
 */
export async function offerDistilledSkill(goal: string, entries: AgentLogEntry[]): Promise<void> {
  if (!getSettings().distillSaveCards) return;
  const recipe = await distillWorkflow(goal, entries);
  if (!recipe) return;
  const parsed = parseRecipe(recipe);
  if (!parsed) return;
  const covered = similarSkill(parsed, getSettings().skills);
  if (covered) {
    log.info(`not offering "${parsed.name}": "${covered.name}" already covers it`);
    return;
  }
  try {
    const edited = await requestEditableConfirmation(
      {
        title: `Save “${parsed.name}” as a skill?`,
        detail: '',
        note: 'Buddy can reuse this the next time you ask for the same kind of task.',
        edit: { text: recipe, action: 'Save' },
      },
      AbortSignal.timeout(CARD_TIMEOUT_MS),
    );
    // Null is a decline; blank is the card emptied then approved by voice.
    if (!edited?.trim()) return;
    // The user may have rewritten the name line, or removed it entirely.
    const final = parseRecipe(edited) ?? { ...parsed, text: edited.trim() };
    const skill = recipeToSkill(
      final,
      getSettings().skills.map((entry) => entry.name),
    );
    updateSettings({ skills: [...getSettings().skills, skill] });
    log.info(`saved distilled skill "${skill.name}"`);
  } catch (error) {
    log.warn(`save-skill card failed: ${error instanceof Error ? error.message : error}`);
  }
}
