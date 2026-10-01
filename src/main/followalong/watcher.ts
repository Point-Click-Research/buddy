// Detect when the user finished a follow-along step by re-reading the
// accessibility tree and matching the target by identity, not by ref
// (refs die every time the window is re-observed).

import { decide, JEV_CONFIDENT, JEV_MAX_OPTIONS, type Jev, type JevOptions } from '../ai/jev';

export type DoneCondition = 'value_changed' | 'selected' | 'gone' | 'clicked' | 'any';

export interface ElementIdentity {
  role: string;
  name: string;
  value: string;
  selected: boolean;
}

export interface Matchable {
  role: string;
  name: string;
  value: string;
  selected: boolean;
  bounds: { x: number; y: number; w: number; h: number } | null;
  ref?: string;
}

export interface ClickPoint {
  x: number;
  y: number;
  at: number;
}

/** Snapshot of the target as it was when the step started. */
export function identityOf(row: Matchable): ElementIdentity {
  return { role: row.role, name: row.name, value: row.value, selected: row.selected };
}

/**
 * Find the same control after a re-observe. Prefer exact role+name
 * (AX prefixes ignored). Name-only is last resort, and only when unique —
 * "Save" must not steal "Save as".
 */
function normRole(role: string): string {
  return role.trim().toLowerCase().replace(/^ax/, '');
}

export function matchIdentity<T extends Matchable>(rows: readonly T[], identity: ElementIdentity): T | null {
  const name = identity.name.trim().toLowerCase();
  const role = normRole(identity.role);
  const exact = rows.find(
    (row) => normRole(row.role) === role && row.name.trim().toLowerCase() === name,
  );
  if (exact) return exact;
  if (name) {
    const named = rows.filter((row) => row.name.trim().toLowerCase() === name);
    if (named.length === 1) return named[0]!;
    const sameRole = named.filter((row) => normRole(row.role) === role);
    if (sameRole.length === 1) return sameRole[0]!;
  }
  return null;
}

const NONE = 'none';

/**
 * matchIdentity, with a Jev fallback for the fuzzy cases the exact rules
 * refuse: a button whose label gained a count, a field renamed by the app.
 * "None of these" is always an option, and an answer below JEV_CONFIDENT is
 * not acted on — a control that genuinely went away must stay gone. Without
 * Jev this is exactly matchIdentity.
 */
export async function matchIdentityFuzzy<T extends Matchable>(
  rows: readonly T[],
  identity: ElementIdentity,
  jev?: Jev,
): Promise<T | null> {
  const exact = matchIdentity(rows, identity);
  if (exact || !jev || rows.length === 0) return exact;
  const candidates = rows.slice(0, JEV_MAX_OPTIONS - 1);
  const label = (row: T, i: number): string => row.ref ?? `c${i + 1}`;
  const options: JevOptions = Object.fromEntries(candidates.map((row, i) => [label(row, i), describeElement(row)]));
  options[NONE] = 'No element listed is that control';
  const choice = await decide(
    jev,
    { target: describeElement(identity) },
    'The window was re-read. Which element is the same control as `target`? Each option is one current element: role | name | value.',
    options,
  );
  if (!choice || choice.confidence < JEV_CONFIDENT || choice.choice === NONE) return null;
  return candidates.find((row, i) => label(row, i) === choice.choice) ?? null;
}

function describeElement(el: { role: string; name: string; value: string; selected: boolean }): string {
  return [normRole(el.role), el.name, el.value ? `=${el.value}` : '', el.selected ? 'selected' : '']
    .filter(Boolean)
    .join(' | ');
}

export function clickHitsBox(
  click: ClickPoint,
  box: { x: number; y: number; w: number; h: number } | null,
  pad = 16,
): boolean {
  if (!box) return false;
  return (
    click.x >= box.x - pad &&
    click.y >= box.y - pad &&
    click.x <= box.x + box.w + pad &&
    click.y <= box.y + box.h + pad
  );
}

export function stepComplete(args: {
  condition: DoneCondition;
  before: ElementIdentity;
  after: Matchable | null;
  /** False when the re-read itself failed — that is not "the element is gone". */
  observed?: boolean;
  click?: ClickPoint | null;
  /** Last known box, used when the live match has no bounds yet. */
  lastBounds?: Matchable['bounds'];
  clickMaxAgeMs?: number;
}): boolean {
  const { condition, before, after, click, lastBounds, clickMaxAgeMs = 4_000 } = args;
  const observed = args.observed ?? true;
  const clicked =
    Boolean(click) &&
    Date.now() - click!.at <= clickMaxAgeMs &&
    clickHitsBox(click!, after?.bounds ?? lastBounds ?? null);

  const valueChanged = Boolean(after && after.value !== before.value);
  const nowSelected = Boolean(after && after.selected && !before.selected);
  const gone = observed && after === null;

  switch (condition) {
    case 'value_changed':
      return valueChanged;
    case 'selected':
      return nowSelected;
    case 'gone':
      return gone;
    case 'clicked':
      return clicked;
    case 'any':
      return valueChanged || nowSelected || gone || clicked;
  }
}

/** Spoken skip / back / stop while a step is waiting. */
export function classifyWalkSpeech(text: string): 'skip' | 'back' | 'stop' | null {
  const t = text.trim().toLowerCase().replace(/[!.?]+$/g, '');
  if (!t) return null;
  if (/^(stop|cancel|quit|enough|never mind)$/.test(t) || t === 'escape') return 'stop';
  if (/^(skip|next|go on|continue|done|i did it|that's done|thats done)$/.test(t)) return 'skip';
  if (/^(back|go back|previous|undo)$/.test(t)) return 'back';
  return null;
}
