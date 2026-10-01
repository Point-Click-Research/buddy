// Pure parsing of a distilled workflow recipe. Kept off distill.ts so tests
// do not load electron-store.

import type { WritingSkill } from '../../shared/types';

export interface DistilledRecipe {
  name: string;
  task: string;
  text: string;
}

/** Pull the name/task lines out of a distilled recipe. Null if unusable. */
export function parseRecipe(text: string): DistilledRecipe | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'UNRELIABLE') return null;
  const name = /^name:\s*(.+)$/im.exec(trimmed)?.[1]?.trim();
  if (!name) return null;
  const task = /^task:\s*(.+)$/im.exec(trimmed)?.[1]?.trim() ?? '';
  return { name: sanitizeName(name), task, text: trimmed };
}

function sanitizeName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'workflow';
}

/** Two token sets this alike describe the same workflow. */
const SAME_WORKFLOW = 0.6;

/** Words every recipe shares, so they say nothing about which workflow it is. */
const NOISE = new Set(
  'and the then for with this that its user skill workflow reusable named'.split(' '),
);

function tokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((word) => word.length > 2 && !NOISE.has(word)));
}

/** How much of the smaller set the two share, 0–1. */
function overlap(a: Set<string>, b: Set<string>): number {
  const smaller = Math.min(a.size, b.size);
  if (smaller === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / smaller;
}

/**
 * The saved skill this recipe is really a re-run of, if there is one. A task
 * done by following a skill distills back into a near-copy of it — the same
 * app, the same route, one parameter changed — and saving that would leave
 * the user with synonyms of a skill they already have. Both sides are
 * compared on name plus opening line, which by convention (and by
 * recipeToSkill) is where a skill says what it is for.
 */
export function similarSkill(
  recipe: DistilledRecipe,
  skills: readonly WritingSkill[],
): WritingSkill | null {
  const mine = tokens(`${recipe.name} ${recipe.task}`);
  return (
    skills.find(
      (skill) =>
        overlap(mine, tokens(`${skill.name} ${firstLine(skill.instructions)}`)) >= SAME_WORKFLOW,
    ) ?? null
  );
}

function firstLine(instructions: string): string {
  return instructions.trim().split('\n', 1)[0] ?? '';
}

/** A skill whose first sentence is the task template, so prompt matching works. */
export function recipeToSkill(recipe: DistilledRecipe, taken: readonly string[]): WritingSkill {
  const name = uniqueName(recipe.name, taken);
  const first = recipe.task
    ? recipe.task.endsWith('.')
      ? recipe.task
      : `${recipe.task}.`
    : `A reusable workflow named ${name}.`;
  const body = recipe.text.startsWith(first) ? recipe.text : `${first}\n\n${recipe.text}`;
  return { name, instructions: body };
}

function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const next = `${base}-${i}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return `${base}-${Date.now()}`;
}
