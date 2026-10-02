// The tool confirmation flow: show a card on the overlays and wait for the
// user's decision — Enter or a spoken "yes" approves, Escape or "no" denies.
// Plan approvals and editable confirmations (a message before it sends) carry
// a textarea; plain action/MCP cards do not.

import {
  type AgentTaskMode,
  type ConfirmCard,
  type ConfirmPlanDraft,
} from '../../shared/types';
import { createLogger } from '../log';
import { currentConfirmPolicy } from './confirm-policy';
import { descriptionToTask, taskToDescription, type PlanTask } from './plan-text';
import { broadcast, setOverlayConfirmInteractive } from '../windows';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('confirm');

type PendingKind = 'none' | 'confirm' | 'plan' | 'edit';
type FinishResult = { approved: boolean; plan?: PlanTask; mode?: AgentTaskMode; editedText?: string };

let pending: ((result: FinishResult) => void) | null = null;
let pendingKind: PendingKind = 'none';
let pendingStrict = false;
let planBaseline: ConfirmPlanDraft | null = null;
let planDraft: ConfirmPlanDraft | null = null;
let editDraft: string | null = null;
let sessionPlan: PlanTask | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function isConfirmationPending(): boolean {
  return pending !== null;
}

/** Strict confirmations (plan approvals): an unclear spoken answer denies. */
export function isConfirmationStrict(): boolean {
  return pending !== null && pendingStrict;
}

export function setSessionPlan(plan: PlanTask | null): void {
  sessionPlan = plan;
}

export function getSessionPlan(): PlanTask | null {
  return sessionPlan;
}

/** Overlay sync while the user edits the plan or text (debounced in the renderer). */
export function updatePlanDraft(draft: ConfirmPlanDraft): void {
  if (pendingKind === 'plan') planDraft = normalizePlanDraft(draft);
  if (pendingKind === 'edit') editDraft = draft.description;
}

export function requestConfirmation(
  card: ConfirmCard,
  signal: AbortSignal,
  strict = false,
): Promise<boolean> {
  // A background run has no one to show the card to; its policy answers.
  const policy = currentConfirmPolicy();
  if (policy) return Promise.resolve(policy(card));
  const request = queue.then(() => askOnce(card, signal, strict));
  queue = request.catch(() => ({ approved: false }));
  return request.then((result) => result.approved);
}

/**
 * A confirmation whose text the user may rewrite on the card before
 * approving. Resolves to the (possibly edited) text, or null when denied.
 */
export function requestEditableConfirmation(
  card: ConfirmCard & { edit: NonNullable<ConfirmCard['edit']> },
  signal: AbortSignal,
): Promise<string | null> {
  const policy = currentConfirmPolicy();
  if (policy) return Promise.resolve(policy(card)).then((approved) => (approved ? card.edit.text : null));
  const request = queue.then(() => askOnce(card, signal, false));
  queue = request.catch(() => ({ approved: false }));
  return request.then((result) =>
    result.approved ? (result.editedText ?? card.edit.text) : null,
  );
}

export interface PlanCardOptions {
  /** Show the Watch / Buddy's-browser choice. */
  offerBrowser?: boolean;
  /** What the mode choice starts on when offered. */
  defaultMode?: AgentTaskMode;
  /** No choice at all: the task runs this way, and the card says why. */
  locked?: { mode: AgentTaskMode; note: string };
}

/**
 * Returns the edited task (with the user's choice of how it runs) on
 * success, or null if denied. A mode the card did not offer is never
 * returned: the task runs in Watch mode whatever the draft says.
 */
export function requestPlanConfirmation(
  task: PlanTask,
  signal: AbortSignal,
  options: PlanCardOptions = {},
): Promise<(PlanTask & { mode: AgentTaskMode }) | null> {
  const plan: PlanTask = { goal: task.goal, steps: [...task.steps] };
  sessionPlan = plan;
  const mode = options.locked?.mode ?? options.defaultMode ?? 'watch';
  const card: ConfirmCard = {
    title: '',
    detail: '',
    plan: {
      description: taskToDescription(task),
      mode,
      offerBrowser: !options.locked && (options.offerBrowser ?? false),
      ...(options.locked ? { lockedNote: options.locked.note } : {}),
    },
  };
  // Nobody at the screen: the policy answers (a texted YES), and the plan
  // runs as drafted, the way the card would have started it.
  const policy = currentConfirmPolicy();
  if (policy) {
    return Promise.resolve(policy(card)).then((approved) => {
      if (approved) return { ...plan, mode };
      sessionPlan = null;
      return null;
    });
  }
  const request = queue.then(() => askOnce(card, signal, true));
  queue = request.catch(() => ({ approved: false }));
  return request.then((result) => {
    if (!result.approved || !result.plan) {
      sessionPlan = null;
      return null;
    }
    sessionPlan = result.plan;
    if (options.locked) return { ...result.plan, mode: options.locked.mode };
    return { ...result.plan, mode: result.mode === 'browser' && options.offerBrowser ? 'browser' : 'watch' };
  });
}

export function resolveConfirmation(approved: boolean): boolean {
  if (!pending) return false;
  if (approved && pendingKind === 'plan') {
    pending({ approved: true, plan: currentPlanTask(), mode: currentPlanMode() });
    return true;
  }
  if (approved && pendingKind === 'edit') {
    pending({ approved: true, ...(editDraft !== null ? { editedText: editDraft } : {}) });
    return true;
  }
  pending({ approved });
  return true;
}

export function resolveConfirmationEnter(): boolean {
  return resolveConfirmation(true);
}

export function submitPlanApproval(draft: ConfirmPlanDraft): boolean {
  if (!pending || (pendingKind !== 'plan' && pendingKind !== 'edit')) {
    log.warn('card submit ignored — no editable confirmation is waiting (stale card?)');
    return false;
  }
  updatePlanDraft(draft);
  return resolveConfirmation(true);
}

/** Dismiss any open confirmation card without approving (session reset). */
export function dismissPendingConfirmation(): void {
  if (pending) resolveConfirmation(false);
}

function currentPlanTask(): PlanTask {
  const text = (planDraft ?? planBaseline)?.description.trim();
  if (text) return descriptionToTask(text);
  return sessionPlan ?? { goal: '', steps: [] };
}

/** The run-style choice on the open plan card; Watch when unset. */
function currentPlanMode(): AgentTaskMode {
  return (planDraft ?? planBaseline)?.mode === 'browser' ? 'browser' : 'watch';
}

function askOnce(card: ConfirmCard, signal: AbortSignal, strict: boolean): Promise<FinishResult> {
  if (signal.aborted) return Promise.resolve({ approved: false });
  return new Promise<FinishResult>((resolve) => {
    const finish = (result: FinishResult): void => {
      signal.removeEventListener('abort', onAbort);
      pending = null;
      pendingKind = 'none';
      pendingStrict = false;
      planBaseline = null;
      planDraft = null;
      editDraft = null;
      if (result.approved && result.plan?.goal) sessionPlan = result.plan;
      setOverlayConfirmInteractive(false);
      broadcast(IpcChannels.mcpConfirm, null);
      resolve(result);
    };
    const onAbort = (): void => finish({ approved: false });
    pendingStrict = strict;
    pendingKind = card.plan ? 'plan' : card.edit ? 'edit' : 'confirm';
    if (card.plan) {
      planBaseline = normalizePlanDraft(card.plan);
      planDraft = { description: planBaseline.description };
    }
    if (card.edit) editDraft = card.edit.text;
    // Editable cards need keyboard focus for their textarea.
    if (card.plan || card.edit) setOverlayConfirmInteractive(true);
    pending = finish;
    signal.addEventListener('abort', onAbort);
    broadcast(IpcChannels.mcpConfirm, card);
  });
}

function normalizePlanDraft(draft: ConfirmPlanDraft): ConfirmPlanDraft {
  return {
    description: draft.description.trim(),
    ...(draft.mode === 'watch' || draft.mode === 'browser' ? { mode: draft.mode } : {}),
  };
}
