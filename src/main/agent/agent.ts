// The agent task runner: given an approved task, drive the computer through
// the active ComputerProvider and the shared tool loop, inside the safety
// rails (kill switch, limits, takeover, excluded apps).

import type { ContentBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { screen } from 'electron';
import { setTimeout as sleep } from 'node:timers/promises';
import { activityLabel, setActivity } from '../activity';
import { streamCloud } from '../ai/brain';
import { resolveEffort } from '../ai/effort';
import { friendlyApiError } from '../ai/api-errors';
import { budgetSpentMessage } from '../ai/budget-message';
import { runToolLoop } from '../ai/loop';
import { withTurnScope } from '../ai/turn-scope';
import { knownAccount } from '../account/api';
import { talkOnly } from '../account/plan-gate';
import { frontmostAppSkillNote } from '../ai/app-notes';
import { buildAgentSystemPrompt } from '../ai/prompt';
import type { ToolOutcome } from '../ai/tools';
import { cleanArgs, mutates, targetingOf, type Targeting } from '../computer/actions';
import { createComputerProvider } from '../computer/select';
import type { ComputerAction, ComputerProvider, Observation, ScreenObservation } from '../computer/provider';
import { createLogger } from '../log';
import { hasMarks, hideMarks } from '../marks/marks';
import {
  dismissPendingConfirmation,
  getSessionPlan,
  requestConfirmation,
  setSessionPlan,
} from '../mcp/confirm';
import { knownConnectedApps } from '../composio/apps';
import { disarmRedaction, isRedactionArmed, redactToolOutcome } from '../payment/redact';
import { getPermissions, requestPermission } from '../permissions';
import { enabledSkills, getApiKey, getSettings, loadableSkillNames } from '../settings';
import { BRAIN_PROVIDERS, type AgentTaskMode } from '../../shared/types';
import { finishText, startSpeech } from '../speech/tts';
import { broadcast, flyBuddyTo } from '../windows';
import { toolResultText } from '../chat/agent-context';
import {
  claimAgentTrace,
  finishAgentTrace,
  noteAgentThought,
  settleStrayAgentTrace,
} from '../chat/conversations';
import { getActionLog, logAction, resetActionLog } from './action-log';
import { offerDistilledSkill } from './distill';
import { dismissPendingQuestion, type RemoteUser } from './control-tools';
import { fastStep, MAX_FAST_RUN } from './system-one';
import { jev } from '../ai/jev';
import { createPauseGate } from './pause-gate';
import { buildAgentRegistry } from './registry';
import {
  driverHooks,
  formatFrontmost,
  frontmostApp,
  noteActionEffect,
  noteFailure,
  noteRepeat,
  resumeDriving,
  startDriving,
  stopDriving,
  type DrivingEvent,
} from './safety';
import { browserStatus, setBrowserActive, setBrowserActivity } from '../browser/window';
import { lastNotedMerchantUrl } from '../payment/merchant';
import { toToolOutcome } from './tool-result';
import { IpcChannels } from '../../shared/ipc';

const log = createLogger('agent');

/** How the log names each way an action found its target. */
const AIM_LABEL: Record<Targeting, string> = {
  jev: 'plain words (Jev)',
  ref: 'ref',
  coordinate: 'coordinate',
  none: 'nothing',
};

const ANNOUNCE_PAUSE_MS = 350;
// A single type action can carry a whole document — a poem, an email, a
// message — and the turn that writes it also carries its reasoning. 4096 cut
// those turns off mid-word; only generated tokens are billed, so the headroom
// is free.
const AGENT_MAX_TOKENS = 8192;

type Settings = ReturnType<typeof getSettings>;

export interface AgentTask {
  goal: string;
  steps: string[];
  /** The user's choice from the plan card; Watch unless they picked otherwise. */
  mode: AgentTaskMode;
  /** The task spends money, so it runs in Buddy's browser whatever the card offers. */
  checkout?: boolean;
  /** Only the user's Mac can do it, so the card does not offer Buddy's browser. */
  mac?: boolean;
}

let running = false;
/** The live task, so a settings change can end it (see stopAgentTask). */
let active: { stop(reason: string): void } | null = null;

export function isAgentActive(): boolean {
  return running;
}

/** End the running task, if any. Used when the provider choice changes. */
export function stopAgentTask(reason: string): void {
  active?.stop(reason);
}

/**
 * Run one approved agent task. Coding rule: no code path may call this
 * without having shown the plan and recorded the user's approval. With
 * `remote`, the user is on their phone: nothing is spoken, and what the task
 * says or asks goes there.
 */
export function runApprovedAgentTask(task: AgentTask, remote?: RemoteUser): Promise<void> {
  return withTurnScope('task', () => runAgentTask(task, remote));
}

async function runAgentTask(task: AgentTask, remote?: RemoteUser): Promise<void> {
  if (running) {
    log.warn('agent task already running; ignoring');
    settleStrayAgentTrace('Still finishing the last agent task.');
    return;
  }
  // The chat line for this run. Early exits close it here; a run that starts
  // closes it in the cleanup below.
  let trace = '';
  let said = '';
  /** Tool results from the run, so a link the work log never repeated still lands in context. */
  let toolText = '';
  const tell = (message: string): void => {
    report(message);
    remote?.say(message);
    if (!said) said = message;
  };
  claimAgentTrace();

  const settings = getSettings();
  const blocked = blocker(task, settings);
  if (blocked) {
    tell(blocked);
    finishAgentTrace(trace, said);
    return;
  }

  running = true;
  // The plan they drew on is approved: the scribbles have served, and left up
  // they would sit over everything the task does. Only the ink goes — the
  // mark data stays for the prompt and for { mark: N } anchors.
  hideMarks();
  const abort = new AbortController();
  // The agent's own model when one is set, else the thinking model. With Ollama
  // as the brain the thinking model is local, so the cloud starter stands in.
  const model =
    settings.agentModel.trim() ||
    (settings.brainProvider === 'ollama' ? BRAIN_PROVIDERS.openrouter.model : settings.brainModel);
  const displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  // A live ref the provider and rails read per action.
  const mode = { current: task.mode };
  // The shimmer pill narrates a Watch-mode drive, where the user is following
  // along; Buddy's browser narrates on its own strip instead.
  const activity = (label: string | null): void => {
    if (mode.current === 'watch') setActivity(label);
    else setBrowserActivity(label);
  };
  let stopNote: string | null = null;
  let provider: ComputerProvider | null = null;
  let distillAfter: { goal: string; entries: ReturnType<typeof getActionLog> } | null = null;

  active = {
    stop: (reason) => {
      stopNote = reason;
      abort.abort();
    },
  };

  try {
    const choice = await createComputerProvider(displayId, driverHooks, mode);
    provider = choice.provider;
    const descriptor = provider.descriptor();

    if (mode.current === 'browser') {
      // The task starts on the page in front when the plan was approved
      // ("buy this"); the peek window comes up so the user can glance at it.
      setBrowserActive(true);
      const seed = lastNotedMerchantUrl();
      if (seed) await provider.act({ name: 'navigate', input: { url: seed } }, abort.signal);
    }

    // The first observation fixes the pixel space the whole task uses.
    const first = await provider.snapshot();

    resetActionLog();
    setSessionPlan(task);
    log.info(
      `task started: "${task.goal}" (model ${model}, provider ${descriptor.id}, ${mode.current} mode)\n` +
        task.steps.map((step, i) => `  ${i + 1}. ${step}`).join('\n'),
    );
    broadcast(IpcChannels.sessionTranscript, `Agent task: ${task.goal}`);
    if (choice.note) report(`Buddy is using the basic provider: ${choice.note}.`);
    // Arm speech for narrate / ask_user / task_complete. The model's streamed
    // reasoning text is deliberately NOT spoken: it lags actions by several
    // steps and reads like a work log, not conversation. Spoken lines reach
    // the caption bubble at the moment they are said, one message each — so
    // the user never reads "Done" before Buddy has said it. A remote user
    // hears nothing: the control tools text them instead.
    const speechActive =
      !remote &&
      startSpeech(abort.signal, () => undefined, (caption) => {
        broadcast(IpcChannels.sessionMessageStart, true);
        broadcast(IpcChannels.sessionResponseDelta, caption);
      });

    // Takeover / excluded-app pauses block actions until the user decides.
    const pause = createPauseGate(abort.signal);
    const onDrivingEvent = (event: DrivingEvent): void => {
      if (event.type === 'kill' || event.type === 'limit') {
        stopNote = event.message;
        abort.abort();
        return;
      }
      // takeover / excluded-app / stalled: pause and ask whether to continue or stop.
      pause.pause();
      void requestConfirmation(
        {
          title: event.type === 'stalled' ? 'Buddy seems stuck. Continue?' : 'Continue the task?',
          detail: event.message,
          note: 'Esc or "no" stops the task.',
        },
        abort.signal,
      ).then((resume) => {
        if (resume) {
          resumeDriving();
          pause.resume();
        } else {
          stopNote = `Stopped after a pause: ${event.message}`;
          abort.abort();
        }
      });
    };

    startDriving(displayId, mode.current, onDrivingEvent);
    // The first model call is a long silence before anything moves; the pill
    // says so from the moment the driving HUD appears.
    activity('Thinking…');

    // Model text streamed since the last action = its reasoning for the next.
    let reasoning = '';
    const aims: Record<Targeting, number> = { jev: 0, ref: 0, coordinate: 0, none: 0 };
    // System One takes the plain steps between frontier turns: with elements
    // to read and Jev to ask, a run of them goes out until one is not a sure
    // pick, an action fails or changes nothing, or the run is long enough
    // that the frontier model should look at the work. Never while card
    // details are on screen.
    const decider = descriptor.families.includes('element') ? await jev() : null;
    let fastRun = 0;
    let fastSteps = 0;
    let lastActionFailed = false;
    /** The window before System One's last step, for its postcondition check; cleared by a frontier turn. */
    let fastTree: string | undefined;
    /** The next action to run is System One's, so it is counted as its own and not as the model aiming by ref. */
    let fastActionPending = false;
    let fastActions = 0;
    /** System One read the window and passed; the read is going out for the model, whose turn is next. */
    let fastHandoff = false;
    /** System One said done or blocked: nothing it can do until a frontier action changes the window. */
    let fastPaused = false;

    const runAction = async (name: string, sent: Record<string, unknown>): Promise<ToolOutcome> => {
      const thought = reasoning.trim();
      reasoning = '';
      // Some models send every schema property, blank or defaulted; only the
      // fields the model chose are the call.
      const args = cleanArgs(name, sent);

      // While payment details are on screen, no pixels leave the machine:
      // deliberate captures are refused, and every result below is redacted.
      if (isRedactionArmed() && (name === 'screenshot' || name === 'zoom')) {
        return {
          content: 'Screen captures are off while payment details are on screen. Work from the element list.',
          isError: true,
        };
      }
      // Every action passes the rails and counts toward the task's limits;
      // observation-only ones synthesize no input, so they skip the
      // excluded-apps check and the announcement.
      const mutating = mutates(name);
      const check = await pause.gate(mutating ? provider!.targetApp({ name, input: args }) : null, mutating);
      if (!check.ok) return { content: `Action not performed: ${check.reason}`, isError: true };
      // Every action arrives under the one `computer` tool, so the loop can
      // only say "Working…"; the action's own name is what the pill wants.
      activity(activityLabel(name));
      if (mutating) await announce(provider!, { name, input: args });

      const aim = targetingOf(args);
      const bySystemOne = fastActionPending;
      fastActionPending = false;
      // A handoff read is bookkeeping for the model, not a step System One took.
      if (bySystemOne && !fastHandoff) fastActions += 1;
      else if (!bySystemOne) aims[aim] += 1;
      const outcome = await provider!.act({ name, input: args }, abort.signal);
      // One line per action with how it went: the failures that stall a task
      // (a refused ref, an off-view row, a stale observation) are otherwise
      // only in the model's context, where nobody reading the log can see them.
      log.info(
        `${name} by ${bySystemOne ? 'System One' : AIM_LABEL[aim]} → ${outcome.error ? `${outcome.error.code}: ${outcome.error.detail}` : outcome.text?.split('\n', 1)[0] || 'ok'}`,
      );
      // The screen label names where type/key would land: the frontmost app,
      // or the page when the task is in Buddy's browser.
      const where = mode.current === 'browser' ? "Buddy's browser" : formatFrontmost(await frontmostApp());
      const result = redactToolOutcome(toToolOutcome(outcome, where));
      const observation = outcome.observation;
      const stallNote = noteActionEffect(mutating, unchangedAfter(observation));
      const repeatNote = noteRepeat(name, mutating);
      const failureNote = noteFailure(name, Boolean(result.isError));
      const note = stallNote ?? repeatNote ?? failureNote;
      lastActionFailed = Boolean(result.isError) || note !== null;
      // A frontier action that changed the window is what a blocked or done
      // window was waiting for: System One may look again.
      if (mutating && !bySystemOne && !lastActionFailed) fastPaused = false;
      if (note) {
        if (typeof result.content === 'string') result.content += `\n${note}`;
        else result.content = [...result.content, { type: 'text', text: note }];
      }
      logAction({
        action: name,
        input: args,
        reasoning: thought,
        result: resultText(result),
        screenshotBase64:
          observation?.kind === 'screen' && !isRedactionArmed() ? (observation.base64 ?? null) : null,
      });
      return result;
    };

    const { registry, definitions, disabledTools } = await buildAgentRegistry({
      runAction,
      gate: pause.gate,
      provider,
      mode: () => mode.current,
      onComplete: (summary) => {
        said = summary;
      },
      ...(remote ? { remote } : {}),
    });

    const result = await runToolLoop({
      callModel: async (messages, handlers, signal) => {
        const live = getSessionPlan() ?? task;
        const handedOff = fastHandoff;
        fastHandoff = false;
        if (decider && !handedOff && !fastPaused && fastRun < MAX_FAST_RUN && !lastActionFailed && !isRedactionArmed()) {
          const step = await fastStep(
            {
              jev: decider,
              provider: provider!,
              plan: () => live,
              log: getActionLog,
              signal,
              ...(fastTree !== undefined ? { previousTree: fastTree } : {}),
            },
            ++fastSteps,
          );
          if ('content' in step) {
            fastRun += 1;
            fastTree = step.tree;
            fastActionPending = true;
            log.info(`System One: ${step.pick.id} (${fastRun}/${MAX_FAST_RUN} before the model looks)`);
            const use = step.content[0] as ToolUseBlockParam;
            handlers.onToolUse(use.id, use.name, use.input);
            return step.content;
          }
          fastRun = 0;
          fastTree = undefined;
          if (step.pause) fastPaused = true;
          log.info(`System One passes the turn: ${step.reason}${step.pause ? ' (out until the window changes)' : ''}`);
          // Its read replaced the model's observation. Rather than leave the
          // model to click stale refs, the fresh read goes to it now, as the
          // get_window_state it would otherwise spend a turn asking for.
          if (step.handoff) {
            fastHandoff = true;
            fastActionPending = true;
            const use = step.handoff[0] as ToolUseBlockParam;
            handlers.onToolUse(use.id, use.name, use.input);
            return step.handoff;
          }
        }
        fastRun = 0;
        fastTree = undefined;
        // The frontmost app changes as the task works (open_app, new windows),
        // so the matching teaching notes — layout, keyboard shortcuts, gotchas
        // — are re-looked-up for every model call. '' when nothing matches,
        // and never slower than the lookup's own timeout.
        const appNote = await frontmostAppSkillNote(enabledSkills());
        return streamCloud(
          messages,
          buildAgentSystemPrompt(
            live.goal,
            live.steps,
            mode.current,
            loadableSkillNames(),
            !disabledTools.has('run_command'),
            appNote,
            // Marks drawn in the turn that proposed this task are still in
            // the conversation and its screenshots; teach them when they exist.
            hasMarks(),
            registry.has('edit_file'),
            // Composio tools are only registered with a key outside airplane
            // mode, so the taught list matches what search_apps can reach.
            registry.has('use_app') ? (knownConnectedApps() ?? []) : [],
            registry.has('fill_payment'),
            descriptor.jev,
          ),
          definitions,
          handlers,
          signal,
          {
            model,
            maxTokens: AGENT_MAX_TOKENS,
            effort: resolveEffort(settings.agentEffort, 'task'),
          },
        );
      },
      tools: registry,
      history: [],
      userContent: await initialUserContent(task, mode.current, first),
      maxModelCalls: Math.max(20, settings.agentMaxActions * 2),
      keepRecentImages: 3,
      haltBatchOnError: true,
      signal: abort.signal,
      onTextDelta: (delta) => {
        // Each action clears `reasoning`, so an empty one means a new step is
        // starting to think. Marked unspoken: it lags the actions and reads
        // like a work log, so it is never voiced. The panel always shows it;
        // a Watch-mode drive also puts it by the cursor as a thought bubble.
        // The same text is kept on the chat handover, one paragraph per step.
        if (!reasoning) {
          broadcast(IpcChannels.sessionMessageStart, false);
          if (trace.trim()) trace += '\n\n';
        }
        reasoning += delta;
        trace += delta;
        const next = trace.trim();
        if (next) noteAgentThought(next);
        broadcast(IpcChannels.sessionResponseDelta, delta);
      },
      onToolActivity: (name) =>
        activity(
          name === null
            ? 'Thinking…'
            : registry.get(name)?.waitsForUser
              ? null // a card or question is up; it explains itself
              : activityLabel(name),
        ),
    });
    toolText = toolResultText(result.turns);

    if (result.stopReason === 'aborted') {
      tell(stopNote ?? 'Agent task stopped.');
    } else {
      if (result.stopReason === 'limit') tell('Stopped: the model-call limit was reached.');
      // Silence here would be the worst outcome: the task is half-done on the
      // user's screen and nothing said so.
      if (result.stopReason === 'truncated') {
        tell('Stopped mid-step: that step was too long to write in one go. Ask again in smaller pieces.');
      }
      log.info(`task finished (${result.stopReason}, ${getActionLog().length} logged actions)`);
      log.info(
        `System One: ${fastActions} of ${getActionLog().length} actions, from ${fastSteps} decisions. ` +
          `Model aimed ${aims.jev} by plain words (Jev), ${aims.ref} by ref, ${aims.coordinate} by coordinate, ${aims.none} with no target` +
          (descriptor.jev ? '.' : '. (Jev not available this task.)'),
      );
      if (result.stopReason === 'done') {
        distillAfter = { goal: (getSessionPlan() ?? task).goal, entries: getActionLog() };
      }
    }
    if (speechActive) finishText();
  } catch (err) {
    if (abort.signal.aborted) {
      tell(stopNote ?? 'Agent task stopped.');
    } else {
      tell(`Agent task failed: ${friendlyApiError(err)}`);
    }
  } finally {
    // Every exit closes the live turn the "Agent task:" transcript opened;
    // a failed run used to leave that line pinned to the chat's tail.
    broadcast(IpcChannels.sessionResponseDone);
    finishAgentTrace(trace, said, toolText);
    dismissPendingConfirmation();
    dismissPendingQuestion();
    disarmRedaction(); // card values are gone with the task that filled them
    setActivity(null); // the task is over, whatever it was last doing
    setSessionPlan(null);
    stopDriving();
    await provider?.close();
    if (mode.current === 'browser') setBrowserActive(false);
    active = null;
    running = false;
  }
  // After cleanup so the save-skill card is not dismissed with the task's. A
  // card nobody is at the screen to answer would hold up every card after it.
  if (distillAfter && !remote) void offerDistilledSkill(distillAfter.goal, distillAfter.entries);
}

/**
 * Why this task cannot start, or null when it can. Failing here beats
 * failing mid-task. A missing Accessibility permission also opens System
 * Settings at the pane, since pointing at it is the only fix.
 */
function blocker(task: AgentTask, settings: Settings): string | null {
  if (talkOnly()) {
    return "I'll be able to do that for you once you're off the waitlist. A code from a friend already on Buddy moves you up, under Settings → Account.";
  }
  if (!settings.agentModeEnabled) return 'Agent mode is turned off. Enable it in Settings first.';
  // Agent turns run on the cloud brain only.
  if (settings.airplaneMode) {
    return 'Airplane mode is on. Agent tasks need the cloud brain, so they sit this one out.';
  }
  // The day's tasks, from the last /v1/me: a task that would be refused on
  // its first call is refused here, before anything lights up. A pasted key
  // is not metered.
  const account = knownAccount();
  const tasks = account.meters?.tasks;
  if (tasks && tasks.limit !== null && tasks.used >= tasks.limit && !getApiKey('openrouter')) {
    return budgetSpentMessage({
      plan: account.plan,
      resetsAt: account.meters?.resetsAt ?? null,
      billing: account.billing,
      meter: 'tasks',
      limit: tasks.limit,
    });
  }
  // Without Accessibility neither desktop driver can act. Buddy's browser
  // drives its own page and needs nothing from the Mac.
  if (task.mode !== 'browser' && getPermissions().accessibility !== 'granted') {
    void requestPermission('accessibility');
    return (
      'Buddy needs Accessibility permission to use the mouse and keyboard. ' +
      'I opened System Settings. Grant it there, then ask again.'
    );
  }
  return null;
}

/** The first user turn: the goal, where input lands right now, and the opening screen. */
async function initialUserContent(
  task: AgentTask,
  mode: AgentTaskMode,
  first: ScreenObservation,
): Promise<ContentBlockParam[]> {
  const page = browserStatus();
  const front =
    mode === 'browser'
      ? `You are in Buddy's browser${page.hasPage ? `, at ${page.url}` : ', on a blank page: navigate to where the task starts'}. type/key go to the page.`
      : `Frontmost app right now: ${formatFrontmost(await frontmostApp())}. type/key would go here.`;
  return [
    {
      type: 'text',
      text:
        `The approved task: ${task.goal}\n` +
        `${front}\n` +
        `Here is the current ${mode === 'browser' ? 'page' : 'screen'}, frame_id ${first.frameId} (${first.width}x${first.height}).`,
    },
    ...(first.base64
      ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: first.base64 } } as const]
      : []),
  ];
}

/**
 * Whether the action's observation says nothing changed, for the stall
 * detector; null when it cannot say. A capture always has a verdict (a fresh
 * image is a change). A window read has one only when the provider compared
 * it to the last read, which Buddy's browser does and the desktop drivers don't.
 */
function unchangedAfter(observation: Observation | undefined): boolean | null {
  if (!observation) return null;
  if (observation.kind === 'screen') return Boolean(observation.unchanged);
  return observation.unchanged ?? null;
}

/** The words the model got back, without the image blocks, for the log. */
function resultText(outcome: ToolOutcome): string {
  if (typeof outcome.content === 'string') return outcome.content;
  return outcome.content
    .map((block) => ('text' in block ? block.text : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Show the user where the action is about to happen: the buddy dot flying
 * there is enough to follow, so nothing is drawn on top of their work. A
 * task in Buddy's browser has no place on their screen, and skips this.
 */
async function announce(provider: ComputerProvider, action: ComputerAction): Promise<void> {
  const target = provider.locate(action);
  if (!target) return;
  flyBuddyTo(target.x + target.width / 2, target.y + target.height / 2);
  await sleep(ANNOUNCE_PAUSE_MS);
}

function report(message: string): void {
  log.warn(message);
  broadcast(IpcChannels.sessionError, message);
}
