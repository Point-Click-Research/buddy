// Guide-mode tools that start a walkthrough and park until a step is done.

import { screen } from 'electron';
import { setActivity } from '../activity';
import type { RegisteredTool, ToolOutcome } from '../ai/tools';
import { resolveGuideRef, rereadWindow } from '../computer/observer';
import { dismissAll, retargetAnchors } from '../drawing/tools';
import { createLogger } from '../log';
import { flushSpeech } from '../speech/tts';
import { setState } from '../state';
import { jev } from '../ai/jev';
import {
  classifyWalkSpeech,
  identityOf,
  matchIdentityFuzzy,
  stepComplete,
  type DoneCondition,
} from './watcher';

const log = createLogger('followalong');

const POLL_MS = 1_000;
const DEFAULT_TIMEOUT_S = 90;
const CONDITIONS = new Set<DoneCondition>(['value_changed', 'selected', 'gone', 'clicked', 'any']);

export interface Walkthrough {
  goal: string;
  steps: string[];
}

type WaitResult =
  | { kind: 'done'; detail: string }
  | { kind: 'timeout'; detail: string }
  | { kind: 'skip' }
  | { kind: 'back' }
  | { kind: 'stop' };

/** The user's last act on the screen: a click, or a key press at the cursor. */
let lastAct: { x: number; y: number; at: number } | null = null;
/**
 * Acts at or before this moment belong to a previous step (or to before the
 * walkthrough). Acts after it count for the current step even when they land
 * during the model's round trips — the instruction is spoken before
 * wait_for_step registers, and a quick user acts in that gap.
 */
let stepFloor = 0;
/** Set while a step is parked: re-checks completion the instant an act lands. */
let nudge: (() => void) | null = null;
let waiting: ((result: WaitResult) => void) | null = null;
let runningCheck: () => boolean = () => false;

export function noteScreenClick(x: number, y: number): void {
  lastAct = { x, y, at: Date.now() };
  nudge?.();
}

/**
 * A key press counts as acting where the pointer is: keyboard-shortcut steps
 * ("press Shift+A") change nothing an accessibility reread can see in apps
 * like Blender, so the press itself is the completion signal.
 */
export function noteScreenKey(): void {
  const { x, y } = screen.getCursorScreenPoint();
  lastAct = { x, y, at: Date.now() };
  nudge?.();
}

export function setFollowAlongRunningCheck(check: () => boolean): void {
  runningCheck = check;
}

/**
 * Route always-on / hold speech during a walkthrough. Returns the command
 * so the session can abort on "stop" even while the model is thinking —
 * skip/back only apply while a step is parked.
 */
export function handleFollowAlongSpeech(text: string): 'skip' | 'back' | 'stop' | null {
  const kind = classifyWalkSpeech(text);
  if (!kind) return null;
  if (waiting) {
    const finish = waiting;
    waiting = null;
    finish({ kind });
  } else if (kind !== 'stop') {
    return null;
  }
  return kind;
}

export function createWalkMeThroughTool(onApproved: (walk: Walkthrough) => void): RegisteredTool {
  return {
    waitsForUser: true,
    spokenAlongside: true,
    definition: {
      name: 'walk_me_through',
      description:
        'Walk the user through a hands-on procedure they will perform themselves: you draw and explain, they click. ' +
        'Only when they asked to be taught the clicks and no connected app, MCP tool, or Mac tool can do the job. ' +
        'Not for an answer a tool can return, such as directions or a lookup: get that with the tool and present it. ' +
        'Not when they ask you to do it for them, and not to present links, products, or results you already found.',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'One short sentence: what they will have done at the end.' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'The steps they will perform, in order, in their words.',
          },
        },
        required: ['goal', 'steps'],
      },
    },
    async execute(input): Promise<ToolOutcome> {
      const walk = parseWalk(input);
      if (!walk) {
        return { content: 'Invalid arguments: goal (string) and steps (array of strings) are required.', isError: true };
      }
      if (runningCheck()) {
        return { content: 'A walkthrough is already running. Press Escape to stop it first.', isError: true };
      }
      stepFloor = Date.now(); // clicks from before the walkthrough are history
      onApproved(walk);
      return { content: 'Starting the walkthrough. Draw the first step and wait.', endLoop: true };
    },
  };
}

export function createWaitForStepTool(): RegisteredTool {
  return {
    waitsForUser: true,
    definition: {
      name: 'wait_for_step',
      description:
        'Wait until the user finishes the current step. Pass the target from the latest read_window. ' +
        'Returns when the done condition matches, they say skip/back/stop, or time runs out.',
      input_schema: {
        type: 'object',
        properties: {
          observation_id: { type: 'string' },
          ref: { type: 'string', description: 'The element they should act on, from the latest read_window.' },
          done: {
            type: 'string',
            enum: [...CONDITIONS],
            description:
              'value_changed: a field they typed in. selected: a toggle or tab. gone: a dialog they dismissed. clicked: they clicked the target, or pressed a key with the pointer on it. any: whichever happens first.',
          },
          timeout_seconds: { type: 'number', description: 'Give up and ask what to do next. Default 90.' },
        },
        required: ['observation_id', 'ref', 'done'],
      },
    },
    async execute(input, signal): Promise<ToolOutcome> {
      // The step's instruction was written before this call; the sentence
      // splitter may still be holding its tail. Say it now — held speech
      // would only play when the next step's text releases it.
      flushSpeech();
      const args = parseWait(input);
      if (!args) {
        return { content: 'wait_for_step needs observation_id, ref, and done.', isError: true };
      }
      const start = resolveGuideRef(args.observationId, args.ref);
      if (!start) {
        return { content: 'Could not find that element. Call read_window again and retry wait_for_step.', isError: true };
      }
      // A click can only be detected against a box; waiting would never end.
      if (args.done === 'clicked' && !start.element.bounds) {
        return {
          content:
            'That element has no on-screen box, so a click on it cannot be detected. Pick a ref with a box (the row or button itself) or a different done condition.',
          isError: true,
        };
      }
      const displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
      const decider = (await jev()) ?? undefined;
      const before = identityOf(start.element);
      let observationId = start.observation.observationId;
      let ref = start.element.ref;
      let lastBounds = start.element.bounds;
      const { pid, windowId } = start.observation;
      // Only acts from before this step are stale. One that landed during
      // the round trips since the instruction was spoken (a failed wait, a
      // re-read) is the user being quick — discarding it would park this
      // step on a click that already happened.
      if (lastAct && lastAct.at <= stepFloor) lastAct = null;
      // Parked: Buddy is honestly idle while the user works. The flip back
      // to thinking when the step lands is the dot's instant "saw it" cue,
      // and the pill says the quiet is deliberate, not a crash.
      setState('idle');
      setActivity('Waiting for you…');

      const result = await parkUntil((resolve) => {
        // The instant path: a click or key press is judged against the
        // target's last known box right away, not at the next poll.
        nudge = () => {
          if (
            stepComplete({
              condition: args.done,
              before,
              after: null,
              observed: false,
              lastBounds,
              click: lastAct,
              clickMaxAgeMs: Date.now() - stepFloor,
            })
          ) {
            lastAct = null;
            resolve({
              kind: 'done',
              detail: `Step done: they acted on the target. Use observation ${observationId} ref ${ref}.`,
            });
          } else if (lastAct) {
            // The user acted and it did not count — say why in the log, so
            // a wrong or missing box is a bug report instead of a mystery.
            log.info(
              `act at (${lastAct.x},${lastAct.y}) did not complete done=${args.done}; target box ${
                lastBounds ? JSON.stringify(lastBounds) : 'missing'
              }`,
            );
          }
        };
        let busy = false;
        const check = async (): Promise<void> => {
          if (busy) return;
          busy = true;
          try {
            const fresh = await rereadWindow(pid, windowId, displayId);
            const observed = fresh !== null;
            // Exact identity first; when that fails, one Jev call may still
            // recognise a renamed control instead of losing the step's target.
            const matched = fresh ? await matchIdentityFuzzy(fresh.rows, before, decider) : null;
            if (fresh && matched) {
              if (matched.ref !== ref || fresh.observationId !== observationId) {
                retargetAnchors({ observationId, ref }, { observationId: fresh.observationId, ref: matched.ref });
                observationId = fresh.observationId;
                ref = matched.ref;
              }
              lastBounds = matched.bounds ?? lastBounds;
            }
            if (
              stepComplete({
                condition: args.done,
                before,
                after: matched,
                observed,
                lastBounds,
                click: lastAct,
                clickMaxAgeMs: Date.now() - stepFloor,
              })
            ) {
              lastAct = null;
              resolve({
                kind: 'done',
                detail: matched
                  ? `Step done. The control is now value="${matched.value}" selected=${matched.selected}. Use observation ${observationId} ref ${ref}.`
                  : 'Step done: the target is gone.',
              });
            }
          } catch {
            // A failed reread is not "the element is gone".
          } finally {
            busy = false;
          }
        };
        void check();
        const timer = setInterval(() => {
          void check();
        }, POLL_MS);
        const timeout = setTimeout(
          () =>
            resolve({
              kind: 'timeout',
              detail: `The user has not finished this step after ${args.timeoutS}s. Re-explain, skip, or offer to take over with propose_task.`,
            }),
          args.timeoutS * 1000,
        );
        const onAbort = (): void => resolve({ kind: 'stop' });
        signal.addEventListener('abort', onAbort);
        return () => {
          nudge = null;
          clearInterval(timer);
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
        };
      });

      setActivity(null);
      // However this park ended, acts before this moment are spent.
      stepFloor = Date.now();
      // The finished (or abandoned) step's ring is history: clear it so the
      // next step's drawing stands alone instead of piling up. A timeout
      // keeps it — the step is still the current one.
      if (result.kind !== 'timeout') dismissAll();
      // The next model call starts right now; showing it right now is the
      // user's immediate confirmation that their action registered.
      if (result.kind !== 'stop') setState('thinking');
      if (result.kind === 'done' || result.kind === 'timeout') return { content: result.detail };
      if (result.kind === 'skip') return { content: 'The user said to skip this step. Go to the next one.' };
      if (result.kind === 'back') return { content: 'The user asked to go back a step. Repeat the previous step.' };
      return { content: 'The user stopped the walkthrough. Say a brief goodbye and stop.', endLoop: true };
    },
  };
}

function parkUntil(run: (resolve: (result: WaitResult) => void) => () => void): Promise<WaitResult> {
  return new Promise((resolve) => {
    let settled = false;
    let cleanup = (): void => undefined;
    const finish = (result: WaitResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      waiting = null;
      resolve(result);
    };
    cleanup = run(finish);
    waiting = finish;
  });
}

function parseWalk(input: unknown): Walkthrough | null {
  const { goal, steps } = (input ?? {}) as { goal?: unknown; steps?: unknown };
  if (typeof goal !== 'string' || !goal.trim() || !Array.isArray(steps)) return null;
  if (!steps.every((step): step is string => typeof step === 'string' && step.trim().length > 0)) return null;
  return { goal: goal.trim(), steps: steps.map((step) => step.trim()) };
}

function parseWait(
  input: unknown,
): { observationId: string; ref: string; done: DoneCondition; timeoutS: number } | null {
  const raw = (input ?? {}) as {
    observation_id?: unknown;
    ref?: unknown;
    done?: unknown;
    timeout_seconds?: unknown;
  };
  if (typeof raw.observation_id !== 'string' || typeof raw.ref !== 'string') return null;
  if (typeof raw.done !== 'string' || !CONDITIONS.has(raw.done as DoneCondition)) return null;
  const timeoutS =
    typeof raw.timeout_seconds === 'number' && raw.timeout_seconds > 0 ? raw.timeout_seconds : DEFAULT_TIMEOUT_S;
  return { observationId: raw.observation_id, ref: raw.ref, done: raw.done as DoneCondition, timeoutS };
}
