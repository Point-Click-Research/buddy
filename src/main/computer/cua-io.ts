// Everything the Cua actions share: how they reach the driver, and how one
// of its results becomes a Buddy outcome. Both dispatch modules (screen, and
// window/element) take this, and the tests fake it.

import { sleep } from './args';
import { computerError, type ComputerError, type ComputerErrorCode } from './errors';
import type { Jev } from '../ai/jev';
import type { DriverSafetyHooks } from './claim';
import type { DisplayFrames } from './display-capture';
import type { DriverToolResult } from './driver';
import type { ObservationRegistry } from './observations';
import type { ActionOutcome } from './provider';

export type { DriverToolResult };

export interface CuaIo {
  call(tool: string, args: Record<string, unknown>): Promise<DriverToolResult>;
  frames: DisplayFrames;
  /** Refs and their lifetime, shared by every element action in this session. */
  observations: ObservationRegistry;
  hooks: DriverSafetyHooks;
  /** How long to let the UI settle before the post-action observation. */
  settleMs: number;
  /**
   * Jev, for the loop's small decisions: an element named in plain words,
   * a stale ref re-bound, a wait_for condition judged. Absent when no key
   * is configured — callers then behave exactly as they always did.
   */
  jev?: Jev;
}

/** ActionEffect from the driver contract. */
const EFFECT_NOTES: Record<number, string> = {
  1: 'The driver only partly confirmed this action.',
  2: 'The driver could not verify this action took effect.',
  3: 'The driver suspects this action did nothing.',
};
const EFFECT_UNVERIFIABLE = 2;
const EFFECT_REFUSED = 4;

/** Map the driver's own failure into one of Buddy's typed errors. */
export function toError(result: DriverToolResult): ComputerError | null {
  const refusal = structuredRefusal(result);
  if (!result.isError && result.action?.effect !== EFFECT_REFUSED && !refusal) return null;
  const reason = refusal ?? `${result.errorCode ?? ''} ${result.text}`.trim();
  return computerError(classify(reason.toLowerCase()), reason || 'The driver refused the action.');
}

/**
 * The browser tools report a refusal inside structuredContent
 * (`{ status: "refused", refusal: { code, message } }`) while leaving
 * isError false. Without reading that, a refusal reads as success and Buddy
 * goes on to act as if it had a browser — so the envelope is checked here,
 * once, for every tool rather than at each call site.
 */
function structuredRefusal(result: DriverToolResult): string | null {
  if (!result.structuredJson || !result.structuredJson.includes('"refused"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.structuredJson);
  } catch {
    return null;
  }
  const body = parsed as { status?: unknown; refusal?: { code?: unknown; message?: unknown } } | null;
  if (!body || body.status !== 'refused') return null;
  const code = typeof body.refusal?.code === 'string' ? body.refusal.code : '';
  const message = typeof body.refusal?.message === 'string' ? body.refusal.message : '';
  return `${code} ${message}`.trim() || 'The driver refused the action.';
}

function classify(reason: string): ComputerErrorCode {
  if (reason.includes('permission') || reason.includes('tcc')) return 'PERMISSION_MISSING';
  if (reason.includes('stale')) return 'STALE_OBSERVATION';
  if (reason.includes('display') || reason.includes('screen_index')) return 'UNSUPPORTED_DISPLAY';
  if (reason.includes('key')) return 'UNSUPPORTED_KEY';
  if (reason.includes('unsupported') || reason.includes('not_supported')) return 'UNSUPPORTED_ACTION';
  if (reason.includes('invalid') || reason.includes('argument')) return 'INVALID_REQUEST';
  return 'REFUSED';
}

/**
 * An acknowledged action is not proof the app responded. When the driver
 * says so, pass that on so the model verifies instead of repeating.
 *
 * `readsBack` is whether this route can confirm anything at all. Desktop
 * input posts OS events and has nothing to read afterwards, so it comes back
 * "unverifiable" every single time; saying so on every click is noise that
 * teaches the model to distrust actions that were in fact fine. On the
 * accessibility routes, which do read the element back, it means something.
 */
export function effectNote(result: DriverToolResult, readsBack = true): string | undefined {
  const effect = result.action?.effect;
  if (effect === undefined) return undefined;
  if (effect === EFFECT_UNVERIFIABLE && !readsBack) return undefined;
  return EFFECT_NOTES[effect];
}

/**
 * The shape of every mutating action: report a failure, otherwise let the UI
 * settle and show what happened. The model never needs a separate look.
 */
export async function observeScreenAfter(
  io: CuaIo,
  result: DriverToolResult,
  readsBack = true,
): Promise<ActionOutcome> {
  const failure = toError(result);
  if (failure) return { error: failure };
  await sleep(io.settleMs);
  const note = effectNote(result, readsBack);
  return { ...(note ? { text: note } : {}), observation: await io.frames.screenshot() };
}
