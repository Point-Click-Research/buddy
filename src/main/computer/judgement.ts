// Jev inside computer use: the decisions a frontier-model turn is too slow
// for, shared by every provider that reads elements.
//
// - Which element a plain-language description names ("the Add to cart
//   button"), so the model acts in one call instead of reading the window
//   and then choosing a ref. The same question re-binds a stale ref: the
//   description is then the element as it was last shown.
// - Whether a plain-language condition holds of a window, so wait_for can
//   poll for "the order has been placed" without a model turn per poll.
//
// "None of these" is always an option and an unconfident answer is not
// acted on: a control that is not there must never be matched to its
// nearest lookalike. Pure: the Jev is passed in, and the tests fake it.

import { decide, JEV_CONFIDENT, JEV_MAX_OPTIONS, JEV_YES, type Jev, type JevOptions } from '../ai/jev';
import { computerError, type ComputerError } from './errors';
import { formatRows, type RefRow, type TreeElement } from './tree';

const NONE = 'none';

/** The refusal for a plain-language field sent without a key: it names the way that always works. */
export function needsJev(field: 'element' | 'condition'): ComputerError {
  const instead =
    field === 'element'
      ? 'Read the window with get_window_state and act by observation_id and ref.'
      : 'Use element_text and until instead.';
  return computerError('INVALID_REQUEST', `${field} is answered by Jev, which is included with Buddy. ${instead}`);
}

/** What the model is told when a description resolved: the ref it can reuse. */
export function pickNote(wanted: string, row: RefRow): string {
  return `"${wanted}" is ${row.ref} (${row.role} ${row.name}).`;
}

/** The element `wanted` names among `rows`, or null when no row confidently is. */
export async function pickElement(
  jev: Jev,
  rows: readonly RefRow[],
  window: string,
  wanted: string,
): Promise<RefRow | null> {
  const candidates = rows.filter((row) => row.token).slice(0, JEV_MAX_OPTIONS - 1);
  if (candidates.length === 0) return null;
  const options: JevOptions = Object.fromEntries(candidates.map((row) => [row.ref, formatRows([row])]));
  options[NONE] = 'No element listed is the one wanted';
  const choice = await decide(
    jev,
    { window, wanted },
    'Which element is the one `wanted` describes? Each option is one element of `window`: its ref, role, name, and value.',
    options,
  );
  if (!choice || choice.confidence < JEV_CONFIDENT || choice.choice === NONE) return null;
  return candidates.find((row) => row.ref === choice.choice) ?? null;
}

/** Whether `condition` is true of a window whose elements read like this right now. */
export async function conditionHolds(
  jev: Jev,
  elements: readonly TreeElement[],
  window: string,
  condition: string,
): Promise<boolean> {
  const rows = elements.map((element, i) => ({ ...element, ref: `e${i + 1}` }));
  const p = await jev.judge(
    { window, elements: formatRows(rows) },
    `Judging only from the listed elements, is this true of the window right now: ${condition}`,
  );
  return p !== null && p >= JEV_YES;
}
