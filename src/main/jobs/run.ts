// One background job run: assemble the headless tools, wrap them so an "ask"
// parks a Needs-your-OK row instead of waiting on a card nobody sees, run
// the turn, keep the job's REMEMBER note, and when there is something to say,
// say it: a text (with the bridge on) and a line from the dot. The run's
// exchange lands in Buddy's work thread. A text from the phone is its own
// turn (texts/turn.ts), sharing the tool context built here.

import {
  JOB_MEMORY_PREFIX,
  JOB_NOTHING,
  buildGuideSystemPrompt,
  type GuideContext,
} from '../ai/prompt';
import { talkOnly } from '../account/plan-gate';
import type { ToolOutcome, ToolRegistry } from '../ai/tools';
import { withTurnScope } from '../ai/turn-scope';
import { assembleTools } from '../ai/turn-tools';
import { ownThread, recordExchangeIn } from '../chat/conversations';
import type { MessageSource } from '../../shared/types';
import { appsReady, COMPOSIO_SERVER_ID, knownConnectedApps, listConnectedApps } from '../composio/apps';
import { createLogger } from '../log';
import { runWithConfirmPolicy } from '../mcp/confirm-policy';
import { hasWebSearchServer, resolveExposedTool } from '../mcp/manager';
import { getAppSecret, getSettings } from '../settings';
import { productSearchAvailable } from '../exa/product-search';
import { instructionsForModel } from '../../shared/instructions';
import type { Job, JobApproval } from '../../shared/jobs';
import { beginScript } from '../session/lifecycle';
import { sayLine } from '../session/say';
import { getState } from '../state';
import { bridgeOn, textMe } from '../texts/send';
import { runHeadlessTurn } from './headless';
import { addApproval, patchJob } from './store';
import { errorMessage } from '../../shared/errors';

const log = createLogger('jobs');

/**
 * A runaway guard, not a feature budget — deeper than a spoken turn. An
 * inbox run reads, drafts a reply per message, and archives, one call each.
 */
const MAX_MODEL_CALLS = 24;
/** Wall-clock cap per run; the next scheduled slot is a fresh start. */
const RUN_TIMEOUT_MS = 6 * 60_000;

/** One run of a job. False when it failed, so the scheduler can try again soon. */
export async function runJob(job: Job): Promise<boolean> {
  // A waitlist account can only talk; its jobs wait for it to move up.
  if (talkOnly()) return true;
  const conversationId = ownThread('background');
  if (conversationId !== job.conversationId) patchJob(job.id, { conversationId });
  try {
    const { report, memory } = await runBackgroundTurn({
      source: { kind: 'job', name: job.name },
      memory: job.memory,
      prompt: instructionsForModel(job.prompt),
      conversationId,
    });
    patchJob(job.id, {
      lastReport: firstLine(report),
      ...(memory ? { memory } : {}),
    });
    // One line reaches them; the whole report waits in the thread.
    if (report) reachOut(firstLine(report));
    return true;
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`job "${job.name}" failed: ${detail}`);
    patchJob(job.id, { lastReport: `Failed: ${firstLine(detail)}` });
    return false;
  }
}

/**
 * Reach the user with one line from background work: a text to the phone
 * (with the bridge on), and the same line said from the dot, in the caption
 * bubble by the cursor, when the dot is free. A real turn cuts it off.
 */
export function reachOut(line: string): void {
  if (bridgeOn()) void textMe(line);
  const signal = beginScript();
  if (getState() !== 'idle') return;
  void sayLine(line, signal);
}

export interface BackgroundRun {
  /** The job or suggestion this is: named in the prompt, on anything it parks, and on its line in the thread. */
  source: MessageSource;
  /** The REMEMBER note from the last run; '' for a one-off. */
  memory: string;
  prompt: string;
  conversationId: string;
}

/**
 * One headless turn with nobody at the screen: writes park as Needs-your-OK
 * rows, the report lands in the background thread tagged with its source.
 * Throws when the turn fails.
 */
export function runBackgroundTurn(run: BackgroundRun): Promise<{ report: string; memory: string }> {
  return withTurnScope('job', () => backgroundTurn(run));
}

async function backgroundTurn(run: BackgroundRun): Promise<{ report: string; memory: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  try {
    const { tools, disabledTools } = await assembleTools({ headless: true });
    const { text, reply, turns } = await runHeadlessTurn({
      system: buildGuideSystemPrompt({
        ...(await toolContext(disabledTools)),
        background: { name: run.source.name, memory: run.memory },
      }),
      prompt: run.prompt,
      tools: parkWrites(tools, run.source.name, run.conversationId),
      signal: controller.signal,
      maxModelCalls: MAX_MODEL_CALLS,
      history: [],
    });
    // Only the NOTHING reply means nothing to report; silence means the run broke.
    if (!text.trim()) throw new Error('The run ended without a reply.');
    // The thread gets what a person reads: the report, never the NOTHING and
    // REMEMBER protocol or the narration on the way; a quiet run leaves nothing.
    const parsed = parseReport(reply || text);
    // The tag over the line says what ran and when, so there is no user side.
    if (parsed.report) recordExchangeIn(run.conversationId, '', parsed.report, turns, { source: run.source });
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a turn with nobody at the screen can reach: the searches, connections,
 * and Mac tools in force right now. A job and a text both build their prompt
 * on this; each adds its own footing.
 */
export async function toolContext(disabledTools: Set<string>): Promise<GuideContext> {
  const settings = getSettings();
  const appsConnected = appsReady();
  // The prompt names what each connection covers; a cold cache is worth one wait.
  if (appsConnected && knownConnectedApps() === null) {
    await listConnectedApps().catch(() => undefined);
  }
  return {
    hasExternalTools: hasWebSearchServer(),
    hasConnectedApps: appsConnected,
    connectedApps: knownConnectedApps(),
    hasCatalog: Boolean(getAppSecret('shopify')) && !settings.airplaneMode,
    hasProductSearch: productSearchAvailable(),
    disabledTools: [...disabledTools],
    shoppers: settings.shoppers,
    seesScreen: false,
    canProposeTasks: false,
    confirmsPlans: false,
    confirmsActions: false,
    skillNames: [],
    appNote: '',
  };
}

/** What a parked call reports to the model instead of a decline. */
const PARKED: ToolOutcome = {
  content:
    "This action needs the user's approval and nobody is here — it is parked in the job's " +
    'conversation for them to allow or deny. Do not retry it or work around it; say that it is waiting.',
};

/**
 * Wrap every tool so a confirmation inside it parks a Needs-your-OK row
 * (with the exact call, for replay on approval) and the run moves on.
 */
function parkWrites(tools: ToolRegistry, source: string, conversationId: string): ToolRegistry {
  const wrapped: ToolRegistry = new Map();
  for (const [name, tool] of tools) {
    wrapped.set(name, {
      ...tool,
      execute: (input, signal) => {
        let parked = false;
        return runWithConfirmPolicy(
          (card) => {
            parked = true;
            const always = alwaysTarget(name, input);
            addApproval({
              source,
              conversationId,
              toolName: name,
              input,
              title: card.title || `Allow ${name}?`,
              detail: [card.detail, card.note].filter(Boolean).join('\n'),
              ...(always ? { always } : {}),
            });
            return false;
          },
          async () => {
            const outcome = await tool.execute(input, signal);
            return parked ? PARKED : outcome;
          },
        );
      },
    });
  }
  return wrapped;
}

/** Where "Always allow" writes, when the parked tool has a permission row. */
function alwaysTarget(name: string, input: unknown): JobApproval['always'] {
  if (name === 'use_app') {
    const record = typeof input === 'object' && input ? (input as Record<string, unknown>) : {};
    const slug = typeof record.tool === 'string' ? record.tool.trim() : '';
    return slug ? { serverId: COMPOSIO_SERVER_ID, toolName: slug } : undefined;
  }
  return resolveExposedTool(name) ?? undefined;
}

/** Split the model's reply into the report and the note for the next run. */
function parseReport(text: string): { report: string; memory: string } {
  const lines = text.trim().split('\n');
  // Models sometimes explain the quiet run before the word; it's still quiet.
  if (lines.at(-1)?.trim().toUpperCase() === JOB_NOTHING) return { report: '', memory: '' };
  const notes = lines.filter((line) => line.trim().startsWith(JOB_MEMORY_PREFIX));
  const memory = notes[notes.length - 1]?.trim().slice(JOB_MEMORY_PREFIX.length).trim() ?? '';
  const report = lines
    .filter((line) => !line.trim().startsWith(JOB_MEMORY_PREFIX))
    .join('\n')
    .trim();
  return { report, memory };
}

export function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.trim().slice(0, 200) ?? '';
}
