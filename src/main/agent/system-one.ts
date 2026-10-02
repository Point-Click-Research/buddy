// System One driving the steps. Most steps of an approved task are "click
// the thing the plan names next" or "type the words the plan carries": a
// frontier turn with a screenshot for each of those is seconds and cents
// spent on a classification. So before every model call the agent reads the
// window (a DOM walk in Buddy's browser, the accessibility tree on the
// desktop) and asks Jev two things in one request, the way jev-ultrafast
// does: which operation is the whole next step (click, type, scroll, or one
// of the answers that hand the turn back: done, blocked, something else),
// and, speculatively, which element each operation would land on. Only the
// target that matches the chosen operation executes, as a `computer` tool
// call the loop runs exactly as it would the frontier model's, rails and
// log included. An operation is offered only when the window has a target
// for it: no scroll on a page that fits, no typing without a field.
//
// Two answers end System One's run rather than its turn. `done` is the
// frontier model's to verify, and `blocked` (a login, an error, a dialog)
// will not change until the frontier model acts, so asking again next turn
// would only cost the same second for the same answer.
//
// Pure where it can be: the action space and the decision are functions of
// the plan, the recent actions, and the rows, with the Jev passed in, so the
// tests fake it.

import type { ContentBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { JEV_CONFIDENT, type Jev, type JevAsk, type JevChoice, type JevOptions } from '../ai/jev';
import type { ComputerProvider } from '../computer/provider';
import { formatRows, inView, PRESS_ACTION, windowBounds, type RefRow } from '../computer/tree';
import { createLogger } from '../log';
import type { PlanTask } from '../mcp/plan-text';
import type { AgentLogEntry } from '../../shared/types';

const log = createLogger('system-one');

/** Fewer actions than this is a canvas or an unpublished page: a screenshot turn. */
const MIN_CANDIDATES = 2;
/**
 * How many click targets Jev chooses among. The rows that share words with
 * the plan rank first, so the cap only trims the tail that shares none; a
 * whole window's worth spreads the pick thin (0.4 on a Spotify tree).
 */
const MAX_CLICK_TARGETS = 32;
/** How many System One steps run back to back before the frontier model looks at the work. */
export const MAX_FAST_RUN = 6;
/** The recent actions Jev reads the task's progress from. */
const RECENT_ACTIONS = 6;
/** One System One scroll: about a screenful. */
const SCROLL_AMOUNT = 10;

const NONE = 'none';

/** Roles a click does something to, as the providers name them. */
const CLICKABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radiobutton',
  'radio',
  'tab',
  'popupbutton',
  'menubutton',
  'menuitem',
  'disclosuretriangle',
  'combobox',
  'cell',
  'row',
  'image',
]);

/** Roles that take typed text. */
const EDITABLE_ROLES = new Set(['textfield', 'searchfield', 'textarea', 'combobox']);

/**
 * Clicks that spend, send, or destroy stay with the frontier model, whose
 * prompt has it ask the user first. System One never presses these.
 */
const CONSEQUENTIAL = /\b(pay|place order|buy|purchase|order now|check ?out|submit|send|confirm|delete|remove|unsubscribe|sign out|log out)\b/i;

/** What System One may do in one step. */
type Operation = 'click' | 'type' | 'scroll_down' | 'scroll_up' | 'done' | 'blocked' | 'other';

/** How each operation reads as an option. The three at the end hand the turn back. */
const OPERATIONS: Record<Operation, string> = {
  click: 'Click one control of `window`: the one chosen in click_target',
  type: "Type the plan's quoted text into one field of `window`: the one chosen in type_target",
  scroll_down: 'Scroll down: the control the next step needs is below the visible part of the window',
  scroll_up: 'Scroll up: the control the next step needs is above the visible part of the window',
  done: 'Every step is finished: what the goal asked for is visibly accomplished in the window',
  blocked:
    'The window is not what the steps expect (a login, an error, a dialog, a different page) and no click, typing, or scroll here gets past it',
  other: 'Something else: choose a value, open a menu, a keyboard shortcut, wait, read the picture, ask the user',
};

/** Operations that end System One's run until the frontier model has changed the window. */
const PAUSING: ReadonlySet<Operation> = new Set<Operation>(['done', 'blocked']);

/** One action Jev may pick: the tool call it becomes, and how it reads as an option. */
export interface Candidate {
  id: string;
  action: 'click_element' | 'type_into' | 'scroll';
  /** The element, for a click or a type. */
  ref?: string;
  /** The text a type_into carries: the plan's own words, never Jev's. */
  text?: string;
  /** Which way a scroll goes. */
  direction?: 'up' | 'down';
  description: string;
}

/** The bounded set for one window: each operation's targets, empty when the window has none. */
export interface ActionSpace {
  clicks: Candidate[];
  types: Candidate[];
  scrolls: Candidate[];
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'of', 'for', 'it', 'then', 'open', 'click', 'press', 'go', 'into', 'with', 'by', 'at', 'from']);

/**
 * The words of a plan that could name a control, lowercased. Three letters
 * and up, or anything with a digit in it: "5:00", "7pm", and "2" are what a
 * time slot and a party size are named by.
 */
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9:']+/)
      .filter((word) => (word.length >= 3 && !STOP.has(word)) || /\d/.test(word)),
  );
}

/** Text the plan puts in quotes: a song title, a search, a name to type. */
export function quotedText(plan: PlanTask): string[] {
  const text = `${plan.goal}\n${plan.steps.join('\n')}`;
  const found = [...text.matchAll(/["“”']([^"“”']{2,120})["“”']/g)].map((match) => match[1]!.trim());
  return [...new Set(found)];
}

/** How many of the plan's words a row carries; the rows that share none rank last. */
function relevance(row: RefRow, planWords: Set<string>): number {
  let score = 0;
  for (const word of words(`${row.name} ${row.value}`)) if (planWords.has(word)) score += 1;
  return score;
}

/**
 * The action space of one window: the visible clickable rows that best
 * match the plan's words, the plan's quoted text typed into each visible
 * field, and a scroll toward whichever side has controls out of view.
 * Nothing consequential, nothing without a handle.
 */
export function actionSpace(plan: PlanTask, rows: readonly RefRow[]): ActionSpace {
  const planWords = words(`${plan.goal} ${plan.steps.join(' ')}`);
  const view = windowBounds(rows);
  const usable = rows.filter((row) => row.token && row.enabled && !CONSEQUENTIAL.test(`${row.name} ${row.value}`));
  const clickable = usable.filter((row) => CLICKABLE_ROLES.has(row.role) || row.actions.includes(PRESS_ACTION));
  // A click on a row past the window's edge lands on whatever is really
  // there. Those rows are what a scroll is for, not a target.
  const visible = clickable.filter((row) => inView(row.bounds, view));
  const clicks = visible
    .map((row) => ({ row, score: relevance(row, planWords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CLICK_TARGETS)
    .map(({ row }): Candidate => ({
      id: `click:${row.ref}`,
      ref: row.ref,
      action: 'click_element',
      description: `Click ${formatRows([row])}`,
    }));
  const texts = quotedText(plan);
  const types = usable
    .filter((row) => EDITABLE_ROLES.has(row.role) && inView(row.bounds, view))
    .flatMap((row) =>
      texts.map(
        (text, i): Candidate => ({
          id: `type:${row.ref}:${i}`,
          ref: row.ref,
          action: 'type_into',
          text,
          description: `Type "${text}" into ${formatRows([row])}`,
        }),
      ),
    );
  const scrolls: Candidate[] = [];
  if (view) {
    const hidden = clickable.filter((row) => row.bounds && !inView(row.bounds, view));
    if (hidden.some((row) => row.bounds!.y >= view.y + view.h)) scrolls.push(scroll('down'));
    if (hidden.some((row) => row.bounds!.y + row.bounds!.h <= view.y)) scrolls.push(scroll('up'));
  }
  return { clicks, types, scrolls };
}

function scroll(direction: 'up' | 'down'): Candidate {
  return { id: `scroll_${direction}`, action: 'scroll', direction, description: `Scroll ${direction} one screen` };
}

export interface FastDecision {
  /** The action to take, when System One is sure it is the whole next step. */
  pick: Candidate | null;
  /** Why the frontier model gets this turn instead, for the log. */
  reason: string;
  /** The answer will not change until the frontier model acts: stay out until it has. */
  pause: boolean;
}

/** Recent actions as Jev reads them: what was done and how it went. */
export function recentActions(entries: readonly AgentLogEntry[]): string {
  return entries
    .slice(-RECENT_ACTIONS)
    .map((entry) => `${entry.action} ${entry.args} -> ${entry.result.split('\n', 1)[0]?.slice(0, 120) ?? ''}`)
    .join('\n');
}

/**
 * Which operation is the next step, and which element it lands on: one
 * request, the target heads answered speculatively alongside the
 * operation, and only the matching one used. Abstaining is always an
 * option, and an unsure answer abstains too.
 */
export async function decideFastStep(
  jev: Jev,
  plan: PlanTask,
  recent: string,
  rows: readonly RefRow[],
  window: string,
): Promise<FastDecision> {
  const space = actionSpace(plan, rows);
  const offered = [...space.types, ...space.clicks, ...space.scrolls];
  // The menu Jev chose from, so a pass or a wrong pick can be read against it.
  log.info(`${rows.length} rows in "${window}" → ${offered.length} actions: ${offered.map((c) => c.id).join(' ')}`);
  if (offered.length < MIN_CANDIDATES) return { pick: null, reason: `${offered.length} candidate actions`, pause: false };

  const operations = Object.fromEntries(
    (Object.keys(OPERATIONS) as Operation[])
      .filter((op) => (op === 'click' ? space.clicks.length > 0 : op === 'type' ? space.types.length > 0 : true))
      .filter((op) => !op.startsWith('scroll') || space.scrolls.some((s) => s.id === op))
      .map((op) => [op, OPERATIONS[op]]),
  ) as JevOptions;
  const targets = (list: Candidate[]): JevOptions => ({
    ...Object.fromEntries(list.map((candidate) => [candidate.id, candidate.description])),
    [NONE]: 'None of these',
  });
  const state = {
    goal: plan.goal,
    steps: plan.steps.map((step, i) => `${i + 1}. ${step}`).join('\n'),
    recent_actions: recent || '(nothing yet)',
    window: `${window}\n${formatRows(rows)}`,
  };
  // The target heads are speculative: asked alongside the operation, and only
  // the one the operation names is read.
  const asks: Record<'operation' | 'click_target' | 'type_target', JevAsk> = {
    operation: {
      question: 'Given `goal`, `steps`, and `recent_actions`, which operation is the whole next step in `window`?',
      options: operations,
    },
    click_target: { question: 'If the next step is a click, which one control of `window` is it?', options: targets(space.clicks) },
    type_target: { question: 'If the next step is typing, which field of `window` takes which text?', options: targets(space.types) },
  };
  if (space.clicks.length === 0) delete (asks as Partial<typeof asks>).click_target;
  if (space.types.length === 0) delete (asks as Partial<typeof asks>).type_target;
  const answers = await jev.choices(state, asks);
  const operation = answers.operation;
  if (!operation || operation.confidence < JEV_CONFIDENT) {
    return { pick: null, reason: `operation ${describe(operation)}`, pause: false };
  }
  const op = operation.choice as Operation;
  if (op === 'other' || PAUSING.has(op)) return { pick: null, reason: `operation ${describe(operation)}`, pause: PAUSING.has(op) };
  if (op === 'scroll_down' || op === 'scroll_up') {
    return { pick: space.scrolls.find((s) => s.id === op) ?? null, reason: '', pause: false };
  }
  const target = op === 'click' ? answers.click_target : answers.type_target;
  if (!target || target.confidence < JEV_CONFIDENT || target.choice === NONE) {
    return { pick: null, reason: `${op} target ${describe(target ?? null)}`, pause: false };
  }
  const list = op === 'click' ? space.clicks : space.types;
  return { pick: list.find((candidate) => candidate.id === target.choice) ?? null, reason: '', pause: false };
}

function describe(choice: JevChoice | null | undefined): string {
  return choice ? `${choice.choice} ${choice.confidence.toFixed(2)}` : 'unanswered';
}

/** The tool call the loop executes, shaped exactly as the frontier model would have written it. */
export function actionBlock(observationId: string, pick: Candidate, index: number): ToolUseBlockParam {
  const input =
    pick.action === 'scroll'
      ? { action: 'scroll', scroll_direction: pick.direction, scroll_amount: SCROLL_AMOUNT }
      : {
          action: pick.action,
          observation_id: observationId,
          ref: pick.ref,
          ...(pick.action === 'type_into' ? { text: pick.text } : {}),
        };
  return { type: 'tool_use', id: `systemone_${index}`, name: 'computer', input };
}

/**
 * A read of the window for the frontier model, as the tool call it would
 * have made itself. System One's own read replaced whatever observation the
 * model was holding, so a turn handed back without this leaves the model
 * clicking refs that are already stale.
 */
export function handoffBlock(index: number): ToolUseBlockParam {
  return { type: 'tool_use', id: `systemone_${index}_handoff`, name: 'computer', input: { action: 'get_window_state' } };
}

export interface FastStepDeps {
  jev: Jev;
  provider: ComputerProvider;
  plan: () => PlanTask;
  log: () => readonly AgentLogEntry[];
  signal: AbortSignal;
  /**
   * The window as it read before System One's last action. A window that
   * reads the same afterwards means the step did not take, and the frontier
   * model gets the turn (the postcondition check of the recipe).
   */
  previousTree?: string;
}

export type FastStepResult =
  | { content: ContentBlockParam[]; pick: Candidate; tree: string }
  | {
      reason: string;
      /** The window was read on the way to passing: the frontier model needs a fresh read before it acts. */
      handoff?: ContentBlockParam[];
      /** Stay out until the frontier model has changed the window. */
      pause?: boolean;
    };

/**
 * One System One step: read the window, check the last step took, decide,
 * and return the action as the assistant's content, or the reason the
 * frontier model takes the turn.
 */
export async function fastStep(deps: FastStepDeps, index: number): Promise<FastStepResult> {
  const read = await deps.provider.act({ name: 'get_window_state', input: {} }, deps.signal);
  if (read.error || read.observation?.kind !== 'window') return { reason: read.error?.detail ?? 'no window to read' };
  const handoff = [handoffBlock(index)];
  if (read.observation.degradedReason) return { reason: read.observation.degradedReason, handoff };
  if (deps.previousTree !== undefined && read.observation.tree === deps.previousTree) {
    return { reason: 'the window reads the same after the last step', handoff };
  }
  const resolved = deps.provider.resolveElements(read.observation.observationId);
  if (!resolved) return { reason: 'window rows unavailable', handoff };
  const decision = await decideFastStep(
    deps.jev,
    deps.plan(),
    recentActions(deps.log()),
    resolved.rows,
    [resolved.app, resolved.title, resolved.url].filter(Boolean).join(' · '),
  );
  if (!decision.pick) return { reason: decision.reason, handoff, pause: decision.pause };
  return {
    content: [actionBlock(resolved.observationId, decision.pick, index)],
    pick: decision.pick,
    tree: read.observation.tree,
  };
}
