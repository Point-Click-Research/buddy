// The Milestone 5–6 control-flow tools around agent tasks. Guide mode gets
// propose_task (plan card -> user approval -> agent mode); agent mode gets
// ask_user, request_confirmation, narrate, task_complete, get_about_me,
// read_clipboard, and open_app.

import { clipboard } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RegisteredTool, ToolOutcome, ToolRegistry } from '../ai/tools';
import { createLogger } from '../log';
import { requestConfirmation, requestPlanConfirmation } from '../mcp/confirm';
import { isBrowserApp, noteFrontBrowserTabs } from '../payment/merchant';
import { browserStatus, showBrowser } from '../browser/window';
import { CHECKOUT_MODE_NOTE, looksLikeCheckout, looksLikeMacOnly } from './checkout-intent';
import { aboutMeText, getSettings } from '../settings';
import { type AgentTaskMode, type QuestionCard } from '../../shared/types';
import { isSpeechActive, pushText } from '../speech/tts';
import { broadcast, setOverlayConfirmInteractive } from '../windows';
import type { AgentTask } from './agent';
import { logAction } from './action-log';
import type { ScreenObservation } from '../computer/provider';
import { isExcludedAppName, launchApp, resolveAppName } from './open-app';
import { formatFrontmost, frontmostApp, type ActionGate } from './safety';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('control-tools');

/**
 * The user away from the Mac, on their phone: what a task says goes out as
 * texts, and a question waits for the whole next message (null when none came).
 */
export interface RemoteUser {
  say(text: string): void;
  ask(question: string, options: string[]): Promise<string | null>;
}

/** narrate calls closer together than this are dropped. */
const NARRATE_INTERVAL_MS = 8_000;
/** Clipboard text passed to the model is capped so a huge paste can't blow the context. */
const CLIPBOARD_LIMIT = 8_000;

/**
 * Say something to the user, in voice and caption together. With speech
 * armed, the text is queued as complete sentences (the trailing punctuation
 * and spaces make the splitter flush it immediately) and the caption follows
 * the voice — each sentence reaches the bubble as it is spoken, via the
 * startSpeech listener. With speech off, the caption is all there is, now.
 */
function say(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (isSpeechActive()) {
    pushText(/[.!?]$/.test(trimmed) ? ` ${trimmed} ` : ` ${trimmed}. `);
    return;
  }
  // Spoken lines are the only agent text the caption bubble shows.
  broadcast(IpcChannels.sessionMessageStart, true);
  broadcast(IpcChannels.sessionResponseDelta, trimmed);
}

// --- Plan approval -----------------------------------------------------------

/**
 * Show the plan card and wait for the user's decision — or auto-approve when
 * that prompt is turned off in settings. Strict when shown: Enter or a
 * spoken "yes" / "go" approves; anything else cancels. Coding rule: no code
 * path may start agent mode without this recorded approval (the setting counts).
 */
export async function approvePlan(task: AgentTask, signal: AbortSignal): Promise<AgentTask | null> {
  // A purchase has one way to run. Watch acts on the page from outside the
  // browser, where card fields reset and clicks miss; offering it for a
  // checkout was inviting the failure.
  const checkout = task.checkout || looksLikeCheckout(task.goal, task.steps);
  // A Mac app or the computer itself: Buddy's browser is a page, and the
  // task cannot happen there, so the card does not offer it. A purchase
  // still wins, since that is the one Mac-looking task a page must do.
  const mac = !checkout && (task.mac || looksLikeMacOnly(task.goal, task.steps));
  const defaultMode = checkout ? 'browser' : mac ? 'watch' : await defaultTaskMode();
  let approved: AgentTask | null;
  if (!getSettings().agentConfirmPlans) {
    log.info(`plan auto-approved: "${task.goal}" (${defaultMode} mode)`);
    approved = { goal: task.goal, steps: [...task.steps], mode: defaultMode };
  } else {
    approved = await requestPlanConfirmation(task, signal, {
      offerBrowser: !mac,
      defaultMode,
      ...(checkout ? { locked: { mode: 'browser', note: CHECKOUT_MODE_NOTE } } : {}),
    });
    log.info(
      approved
        ? `plan approved: "${approved.goal}" (${approved.mode} mode)`
        : `plan declined: "${task.goal}"`,
    );
  }
  // The page in front as the plan is approved is a merchant the user chose
  // ("Buy this" with the product page open) — captured now, before the agent
  // model has read anything a page could have planted.
  if (approved) await noteFrontBrowserTabs().catch(() => undefined);
  return approved;
}

/**
 * How a task runs when nothing says otherwise: decisive when the card is
 * skipped, the preselected option when it is shown. Web work (a browser in
 * front when the plan is proposed) goes to Buddy's browser, where the user
 * keeps working; anything else is on their screen, watched.
 */
async function defaultTaskMode(): Promise<AgentTaskMode> {
  const front = await frontmostApp();
  return front && isBrowserApp(front.name) ? 'browser' : 'watch';
}

// --- propose_task (guide mode only) -----------------------------------------

/**
 * The guide-mode tool that starts the agent flow: show the plan, speak a
 * one-sentence summary, and wait. Only an approval calls onApproved — the
 * caller then switches to agent mode.
 */
export function createProposeTaskTool(
  onApproved: (task: AgentTask) => void,
  isAgentRunning: () => boolean,
  /** The user is on their phone: the plan reaches them as a text, so nothing is said on screen. */
  remote = false,
): RegisteredTool {
  return {
    waitsForUser: true,
    spokenAlongside: true,
    definition: {
      name: 'propose_task',
      description:
        'Propose taking control of the computer to do something the user asked, only when no connected app, MCP tool, or Mac tool can do it. ' +
        'Shows the plan for approval; the task only starts if the user approves.',
      input_schema: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description:
              'The decision, as one short question the user answers yes to, with the number that decides it: "Book Bobo Friday at 7 for two?", "Order the coat at $89?". It is spoken to them.',
          },
          steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'A few plain-language steps.',
          },
          checkout: {
            type: 'boolean',
            description:
              'True when the task buys something: add to cart, checkout, place an order. Purchases run in Buddy\'s own browser.',
          },
          mac: {
            type: 'boolean',
            description:
              "True when only the user's Mac can do it: a Mac app, their files, or their desktop. A website is never mac, even one open in their browser. Buddy's browser is not offered.",
          },
        },
        required: ['goal', 'steps'],
      },
    },
    async execute(input, signal): Promise<ToolOutcome> {
      const task = parseTask(input);
      if (!task) {
        return {
          content: 'Invalid arguments: goal (string) and steps (array of strings) are required.',
          isError: true,
        };
      }
      if (!getSettings().agentModeEnabled) {
        return {
          content:
            'Agent mode is disabled in settings, so the task cannot start. ' +
            'Guide the user through it instead, or tell them to enable agent mode in Settings.',
          isError: true,
        };
      }
      if (isAgentRunning()) {
        return {
          content:
            'An agent task is still running. Wait for it to finish (or press Escape to stop it), then try again.',
          isError: true,
        };
      }
      // The goal is the question; the card shows the steps. A yes starts it.
      if (getSettings().agentConfirmPlans && !remote) say(task.goal);
      const approved = await approvePlan(task, signal);
      if (!approved) {
        return { content: 'The user declined the plan. Do not start the task; keep guiding instead.' };
      }
      onApproved(approved);
      // endLoop rather than aborting the session: an abort would also kill
      // the speech Buddy is part-way through, and the acknowledgement it
      // just gave should finish before the agent takes the voice over.
      return { content: 'Approved — agent mode is starting.', endLoop: true };
    },
  };
}

function parseTask(input: unknown): AgentTask | null {
  const { goal, steps, checkout, mac } = (input ?? {}) as {
    goal?: unknown;
    steps?: unknown;
    checkout?: unknown;
    mac?: unknown;
  };
  if (typeof goal !== 'string' || !goal.trim() || !Array.isArray(steps)) return null;
  if (!steps.every((step): step is string => typeof step === 'string')) return null;
  // Watch until the user picks another way on the plan card; the model never
  // chooses the mode. It only says whether money is involved, and whether
  // the task can only happen on their Mac.
  return {
    goal: goal.trim(),
    steps,
    mode: 'watch',
    ...(checkout === true ? { checkout: true } : {}),
    ...(mac === true ? { mac: true } : {}),
  };
}

// --- ask_user's pending question ---------------------------------------------
// ask_user parks the agent here until session/answers.ts delivers a transcript
// (hold-to-talk or always-on speech both route to resolveQuestion).

let pendingAnswer: ((answer: string | null) => void) | null = null;

export function isQuestionPending(): boolean {
  return pendingAnswer !== null;
}

/** Deliver the user's spoken answer to a waiting ask_user call. */
export function resolveQuestion(answer: string): boolean {
  if (!pendingAnswer) return false;
  pendingAnswer(answer);
  return true;
}

/** Drop a waiting ask_user without an answer (agent/session reset). */
export function dismissPendingQuestion(): void {
  if (pendingAnswer) pendingAnswer(null);
}

function waitForAnswer(signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (answer: string | null): void => {
      signal.removeEventListener('abort', onAbort);
      pendingAnswer = null;
      resolve(answer);
    };
    const onAbort = (): void => finish(null);
    pendingAnswer = finish;
    signal.addEventListener('abort', onAbort);
  });
}

// --- The agent-mode tools ----------------------------------------------------

/** Register ask_user, request_confirmation, narrate, task_complete, form tools, and open_app. */
export function addAgentControlTools(
  registry: ToolRegistry,
  computer?: {
    gate: ActionGate;
    screenshot(): Promise<ScreenObservation>;
    /** What Buddy says when the task ends, kept on the chat handover line. */
    onComplete?: (summary: string) => void;
    /** The task's current mode; in Buddy's browser, ask_user opens the window and open_app is barred. */
    mode?: () => AgentTaskMode;
    /** The user is on their phone: narration and questions go there instead of the voice and cards. */
    remote?: RemoteUser;
  },
): void {
  let lastNarrateAt = 0;
  const remote = computer?.remote;
  const speak = remote ? (text: string): void => remote.say(text) : say;

  registry.set('ask_user', {
    waitsForUser: true,
    definition: {
      name: 'ask_user',
      description:
        'Ask the user a question and wait for the answer. It is spoken out loud and shown on a ' +
        'card they can click or type into. Use it when the task needs information or a decision ' +
        'that was not in the plan, or when the user must do a step themselves (passwords, ' +
        'payments, codes). When the answer is one of a few, pass options so they can click it.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Two to five short choices, shown as buttons on the card.',
          },
        },
        required: ['question'],
      },
    },
    async execute(input, signal): Promise<ToolOutcome> {
      const question = stringField(input, 'question');
      if (!question) return { content: 'Invalid arguments: question (string) is required.', isError: true };
      if (remote) {
        const reply = await remote.ask(question, optionList(input));
        return reply === null ? { content: 'No answer: the user did not reply.', isError: true } : { content: reply };
      }
      // In Buddy's browser the question is often "do this part yourself" (a
      // login, a CAPTCHA). A hidden page comes up as a peek so they know where
      // to act; a peek or expanded one stays as they left it. The card itself
      // is on the overlay, so the question is never missed either way.
      if (computer?.mode?.() === 'browser' && browserStatus().state === 'hidden') showBrowser('peek');
      say(question);
      // The card carries the question and its options; the overlay needs the
      // mouse and keyboard while it is up, like the plan card does.
      broadcast(IpcChannels.askQuestion, { question, options: optionList(input) } satisfies QuestionCard);
      setOverlayConfirmInteractive(true);
      try {
        const answer = await waitForAnswer(signal);
        if (answer === null) return { content: 'No answer: the task was stopped.', isError: true };
        return { content: answer };
      } finally {
        setOverlayConfirmInteractive(false);
        broadcast(IpcChannels.askQuestion, null);
      }
    },
  });

  registry.set('request_confirmation', {
    waitsForUser: true,
    definition: {
      name: 'request_confirmation',
      description:
        'Ask the user to approve a consequential action before you do it. ' +
        'Returns "approved" or "declined".',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'What is about to happen, in one sentence.' },
        },
        required: ['action'],
      },
    },
    async execute(input, signal): Promise<ToolOutcome> {
      const action = stringField(input, 'action');
      if (!action) return { content: 'Invalid arguments: action (string) is required.', isError: true };
      if (!getSettings().agentConfirmActions) return { content: 'approved' };
      const approved = await requestConfirmation({ title: 'Allow this action?', detail: action }, signal);
      return { content: approved ? 'approved' : 'declined' };
    },
  });

  registry.set('narrate', {
    definition: {
      name: 'narrate',
      description:
        'Say something to the user out loud. One short casual sentence (under ~12 words), ' +
        'only new information — never repeat or describe the obvious. ' +
        'At most one every 8 seconds; extras are dropped.',
      input_schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
    // Immediate: speaks while the response is still streaming, so the voice
    // stays in step with the actions instead of trailing them.
    immediate: true,
    execute(input): ToolOutcome {
      const text = stringField(input, 'text');
      if (!text) return { content: 'Invalid arguments: text (string) is required.', isError: true };
      const now = Date.now();
      if (now - lastNarrateAt < NARRATE_INTERVAL_MS) {
        return { content: 'dropped (rate limit: at most one narration every 8 seconds)' };
      }
      lastNarrateAt = now;
      speak(text);
      return { content: 'ok' };
    },
  });

  registry.set('task_complete', {
    definition: {
      name: 'task_complete',
      description:
        'End the task. Call it when the task is done, or when you cannot continue. ' +
        'success must honestly reflect whether the goal was achieved.',
      input_schema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'Spoken aloud: one or two short, conversational sentences. Honest, and only ' +
              'what the user does not already know — never recap every step.',
          },
          success: { type: 'boolean' },
        },
        required: ['summary', 'success'],
      },
    },
    execute(input): ToolOutcome {
      const { summary, success } = (input ?? {}) as { summary?: unknown; success?: unknown };
      if (typeof summary !== 'string' || !summary.trim() || typeof success !== 'boolean') {
        return {
          content: 'Invalid arguments: summary (string) and success (boolean) are required.',
          isError: true,
        };
      }
      log.info(`task_complete (success=${success}): ${summary}`);
      speak(summary);
      computer?.onComplete?.(summary.trim());
      return { content: 'ok', endLoop: true };
    },
  });

  registry.set('get_about_me', {
    definition: {
      name: 'get_about_me',
      description:
        "Return the user's saved About me facts (name, email, phone, address, company, and similar) " +
        'for filling forms. Empty if nothing is saved. Passwords, payment cards, and government IDs are never stored here.',
      input_schema: { type: 'object', properties: {} },
    },
    execute(): ToolOutcome {
      return {
        content:
          aboutMeText() ||
          "No About me facts are saved. Use ask_user if you need the user's name, email, or similar.",
      };
    },
  });

  registry.set('read_clipboard', {
    waitsForUser: true,
    definition: {
      name: 'read_clipboard',
      description:
        'Read the current clipboard text. Always asks the user first. Use only when they said the information is copied.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute(_input, signal): Promise<ToolOutcome> {
      const approved = await requestConfirmation(
        {
          title: 'Allow reading the clipboard?',
          detail: 'Buddy wants to read whatever text is currently copied.',
        },
        signal,
      );
      if (!approved) return { content: 'The user declined this tool call.', isError: true };
      const text = await clipboard.readText();
      if (!text) return { content: '(clipboard is empty)' };
      if (text.length <= CLIPBOARD_LIMIT) return { content: text };
      return {
        content:
          text.slice(0, CLIPBOARD_LIMIT) +
          `\n[Clipboard truncated: showing ${CLIPBOARD_LIMIT} of ${text.length} characters.]`,
      };
    },
  });

  if (!computer) return;

  registry.set('open_app', {
    definition: {
      name: 'open_app',
      description:
        'Open a macOS application by name and bring it to the front (Messages, Notes, Safari, …). ' +
        'Reliable when you know the app name. After it returns, look at the screenshot before typing or clicking.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Application name, e.g. Messages or Notes.' } },
        required: ['name'],
      },
    },
    async execute(input): Promise<ToolOutcome> {
      const requested = stringField(input, 'name');
      if (!requested) return { content: 'Invalid arguments: name (string) is required.', isError: true };
      const name = resolveAppName(requested);
      if (computer.mode?.() === 'browser') {
        return {
          content:
            "open_app is unavailable in Buddy's browser — the task lives in the page, and " +
            'launching an app would take focus from the user. Work in the page, or ask_user.',
          isError: true,
        };
      }
      if (isExcludedAppName(name, getSettings().agentExcludedApps)) {
        return { content: `"${name}" is on the excluded apps list — not opened.`, isError: true };
      }
      const check = await computer.gate(name);
      if (!check.ok) return { content: `App not opened: ${check.reason}`, isError: true };
      try {
        await launchApp(name);
      } catch (error) {
        const detail = errorMessage(error);
        return { content: `Couldn't open "${name}": ${detail}`, isError: true };
      }
      await sleep(900);
      const shot = await computer.screenshot();
      const front = formatFrontmost(await frontmostApp());
      // An unchanged screen carries no image, which after launching an app
      // means nothing visibly happened — worth saying rather than hiding.
      const text = shot.base64
        ? `Opened ${name}. Frontmost app: ${front}. frame_id: ${shot.frameId}. ` +
          `type and key go here — do not type if this isn't ${name}.`
        : `Opened ${name}, but the screen is unchanged since frame ${shot.frameId}. ` +
          `Frontmost app: ${front}. Check whether it actually came to the front.`;
      logAction({
        action: 'open_app',
        input: { name },
        reasoning: '',
        result: text,
        screenshotBase64: shot.base64 ?? null,
      });
      return {
        content: [
          { type: 'text', text },
          ...(shot.base64
            ? [
                {
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: shot.base64 },
                },
              ]
            : []),
        ],
      };
    },
  });
}

function stringField(input: unknown, field: string): string {
  const value = (input as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' ? value.trim() : '';
}

/** ask_user's options: up to five non-empty strings; anything else is dropped. */
function optionList(input: unknown): string[] {
  const raw = (input as { options?: unknown } | null)?.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
    .map((option) => option.trim())
    .slice(0, 5);
}
