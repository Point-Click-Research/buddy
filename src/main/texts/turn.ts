// A text from the phone runs a full turn at the Mac: the tools a spoken ask
// gets, minus the screen (nothing to draw on, no field to type beside), plus
// propose_task when Computer Use is on. Every card a tool would show is
// texted instead and waits for the reply. An approved plan lights the display
// and runs the agent, whose words and questions go out as texts too.

import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { powerSaveBlocker } from 'electron';
import { isAgentActive, runApprovedAgentTask, type AgentTask } from '../agent/agent';
import { createProposeTaskTool, type RemoteUser } from '../agent/control-tools';
import { lastReply, readIntent, toolHint } from '../ai/intent';
import { jev } from '../ai/jev';
import { knownAccount } from '../account/api';
import { talkOnly } from '../account/plan-gate';
import { buildGuideSystemPrompt, buildWaitlistSystemPrompt, withUsage } from '../ai/prompt';
import { withTurnScope } from '../ai/turn-scope';
import { assembleTools } from '../ai/turn-tools';
import { agentHandoverTurns } from '../chat/agent-context';
import { conversationContext, recordExchangeIn } from '../chat/conversations';
import { runHeadlessTurn } from '../jobs/headless';
import { toolContext } from '../jobs/run';
import { runWithConfirmPolicy, type ConfirmPolicy } from '../mcp/confirm-policy';
import { hasPaymentCard } from '../payment/card';
import { getSettings } from '../settings';
import type { AttachmentDraft } from '../../shared/attachments';
import type { ConfirmCard } from '../../shared/types';
import { attachmentBlocks, attachmentChips, attachmentsNote } from '../session/attachments';
import { stageTurnFiles } from '../session/turn-files';
import { approvalReply } from './parse';

/** Deeper than a spoken turn: a text may search, compare, and then propose. */
const MAX_MODEL_CALLS = 24;
/** The model turn's wall clock; a wait for the user's reply counts against it. */
const TURN_TIMEOUT_MS = 15 * 60_000;
/** The display takes a beat to light before the first screenshot. */
const WAKE_MS = 600;

export interface TextTurn {
  prompt: string;
  /** Files texted with (or just before) the message. */
  files?: AttachmentDraft[];
  conversationId: string;
  user: RemoteUser;
  /** A tool or agent task is actually running. A chat reply never calls it. */
  onWork?: () => void;
}

/**
 * Answer one text. The reply is what closes the turn; everything said on the
 * way has already gone out through `user`. A turn that hands off to an agent
 * task returns '' once the task has ended and texted its own outcome.
 */
export function runTextTurn(run: TextTurn): Promise<string> {
  return withTurnScope('talk', () => textTurn(run));
}

async function textTurn(run: TextTurn): Promise<string> {
  const settings = getSettings();
  const confirms = settings.textBridgeConfirm;
  const { tools, disabledTools } = await assembleTools({ remote: true });
  const waitlisted = talkOnly();
  const canDrive = settings.agentModeEnabled && !settings.airplaneMode && !waitlisted;
  let approvedTask: AgentTask | null = null;
  if (canDrive) {
    const propose = createProposeTaskTool(
      (task) => {
        approvedTask = task;
      },
      isAgentActive,
      true,
    );
    tools.set(propose.definition.name, propose);
  }
  const policy: ConfirmPolicy = confirms ? textedPolicy(run.user) : () => true;
  const history = conversationContext(run.conversationId);
  const intent = await readIntent(await jev(), run.prompt, tools, lastReply(history));
  const system = withUsage(
    waitlisted
      ? buildWaitlistSystemPrompt(settings.shoppers[0]?.name)
      : buildGuideSystemPrompt({
          ...(await toolContext(disabledTools)),
          texting: { confirms },
          canProposeTasks: canDrive,
          confirmsPlans: confirms && settings.agentConfirmPlans,
          confirmsActions: confirms && settings.agentConfirmActions,
          hasSavedCard: hasPaymentCard(),
        }),
    knownAccount(),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
  // Texted files: seen by the model this turn, and on disk to forward by name.
  const files = run.files ?? [];
  stageTurnFiles(files);
  const attachments = files.length
    ? [...attachmentBlocks(files), { type: 'text' as const, text: attachmentsNote(files.map((file) => file.name)) }]
    : undefined;
  const sent = files.length ? { attachments: attachmentChips(files) } : {};
  try {
    const hint = toolHint(intent);
    const { text, reply, turns } = await runWithConfirmPolicy(policy, () =>
      runHeadlessTurn({
        system,
        prompt: run.prompt,
        ...(attachments ? { attachments } : {}),
        ...(hint ? { hint } : {}),
        tools,
        signal: controller.signal,
        maxModelCalls: MAX_MODEL_CALLS,
        history,
        onProgress: run.user.say,
        onWork: run.onWork,
      }),
    );
    // TS cannot see the callback assignment, so it narrows the original to null here.
    const task = approvedTask as AgentTask | null;
    if (task) {
      run.onWork?.();
      // The handover line the run fills in as it works, in this thread.
      recordExchangeIn(
        run.conversationId,
        run.prompt,
        `Started an agent task: ${task.goal}`,
        agentHandoverTurns(run.prompt, task.goal, task.steps),
        { agent: true, ...sent },
      );
      await withDisplayLit(() => runWithConfirmPolicy(policy, () => runApprovedAgentTask(task, run.user)));
      return '';
    }
    if (!text.trim()) throw new Error('The run ended without a reply.');
    recordExchangeIn(run.conversationId, run.prompt, text, turns, sent);
    return reply;
  } finally {
    clearTimeout(timer);
  }
}

/** Every card a tool would show becomes a text, and the whole next message is the answer. */
function textedPolicy(user: RemoteUser): ConfirmPolicy {
  return async (card) => {
    const reply = await user.ask(cardText(card), []);
    const decision = reply === null ? null : approvalReply(reply);
    return decision === 'once' || decision === 'always';
  };
}

/** The card as a text: a plan reads as the plan, anything else as its title and detail. */
function cardText(card: ConfirmCard): string {
  const body = card.plan
    ? `Before I do this:\n${card.plan.description}`
    : [card.title, card.detail, card.edit?.text].filter(Boolean).join('\n');
  return `${body}\nYES to go ahead, NO to skip.`;
}

/**
 * The agent drives the screen, so the display has to be on: wake it, and keep
 * it from sleeping until the task ends. A closed lid never gets here, since a
 * sleeping Mac reads no texts.
 */
async function withDisplayLit<T>(work: () => Promise<T>): Promise<T> {
  // -u asserts user activity, which is what turns a dark display back on.
  execFile('caffeinate', ['-u', '-t', '2'], () => undefined);
  await sleep(WAKE_MS);
  const blocker = powerSaveBlocker.start('prevent-display-sleep');
  try {
    return await work();
  } finally {
    powerSaveBlocker.stop(blocker);
  }
}
