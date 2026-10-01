// The follow-along runner: a sibling of the agent task runner that never
// synthesizes input. Session stays idle; this owns its own abort flag.

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { isAgentActive, runApprovedAgentTask, type AgentTask } from '../agent/agent';
import { createProposeTaskTool } from '../agent/control-tools';
import { frontmostAppSkillNote } from '../ai/app-notes';
import { streamBrain } from '../ai/brain';
import { resolveEffort } from '../ai/effort';
import { friendlyApiError } from '../ai/api-errors';
import { addContextTools } from '../ai/context-tools';
import { runToolLoop } from '../ai/loop';
import { buildFollowAlongSystemPrompt } from '../ai/prompt';
import { withTurnScope } from '../ai/turn-scope';
import { createAnnotationTools, toolDefinitions, type ToolRegistry } from '../ai/tools';
import { captureAllDisplays } from '../capture';
import { revealDrawings } from '../drawing/tools';
import { createLogger } from '../log';
import { addMcpTools } from '../mcp/manager';
import { disabledBuiltinToolNames, enabledSkills, getSettings, loadableSkillNames } from '../settings';
import { createMarkerStream } from '../speech/markers';
import { drainSpeech, finishText, pushText, startSpeech } from '../speech/tts';
import { setState } from '../state';
import { broadcast } from '../windows';
import { createWaitForStepTool, setFollowAlongRunningCheck, type Walkthrough } from './tools';
import { IpcChannels } from '../../shared/ipc';

const ACK_DRAIN_MS = 6_000;

const log = createLogger('followalong');

let running = false;
let active: { stop(reason: string): void } | null = null;

export function isFollowAlongActive(): boolean {
  return running;
}

export function stopFollowAlong(reason = 'Walkthrough stopped.'): void {
  active?.stop(reason);
}

setFollowAlongRunningCheck(() => running);

/**
 * Walk the user through a sequence. Never drives the mouse.
 * Escape / stopFollowAlong aborts it.
 */
export function runFollowAlong(walk: Walkthrough): Promise<void> {
  // A walkthrough is talk that outlives the session that started it.
  return withTurnScope('talk', () => followAlong(walk));
}

async function followAlong(walk: Walkthrough): Promise<void> {
  if (running) {
    log.warn('walkthrough already running; ignoring');
    return;
  }
  running = true;
  // The session just went idle handing over to us; without this the dot
  // vanishes until the first drawing, which reads as a crash. Thinking is
  // honest: the first step is being prepared. wait_for_step sets it back to
  // idle while the user works, and to thinking again the moment they finish.
  setState('thinking');
  const abort = new AbortController();
  let stopNote: string | null = null;
  let handedOff: AgentTask | null = null;
  active = {
    stop: (reason) => {
      stopNote = reason;
      abort.abort();
    },
  };

  const settings = getSettings();
  const speechActive = startSpeech(
    abort.signal,
    () => undefined,
    // The trailing space joins sentence captions, same as the other speech
    // pipelines — without it the bubble reads "sentence.sentence".
    (caption) => broadcast(IpcChannels.sessionResponseDelta, `${caption} `),
  );

  try {
    const screenshots = settings.screenAwareness ? await captureAllDisplays() : [];
    const tools: ToolRegistry = settings.screenAwareness ? createAnnotationTools(screenshots) : new Map();
    addMcpTools(tools);
    addContextTools(tools, { canInsertDraft: false });
    tools.set('wait_for_step', createWaitForStepTool());
    if (settings.agentModeEnabled) {
      tools.set(
        'propose_task',
        createProposeTaskTool((task) => {
          handedOff = task;
        }, isAgentActive),
      );
    }
    const disabled = disabledBuiltinToolNames();
    for (const name of disabled) tools.delete(name);

    const planned = walk.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    const userContent: ContentBlockParam[] = [];
    for (const shot of screenshots) {
      userContent.push({
        type: 'text',
        text: `${shot.label}${shot.isCursorDisplay ? ' (cursor is here)' : ''}, ${shot.imageWidth}x${shot.imageHeight}, frame_id ${shot.frameId}`,
      });
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: shot.base64 },
      });
    }
    userContent.push({
      type: 'text',
      text: `Walk the user through this, one step at a time. They do the clicking.\nGoal: ${walk.goal}\nSteps:\n${planned}`,
    });

    const markers = createMarkerStream();
    const result = await runToolLoop({
      callModel: async (messages, handlers, signal) => {
        const system = buildFollowAlongSystemPrompt({
          goal: walk.goal,
          steps: walk.steps,
          skillNames: loadableSkillNames(),
          shoppers: settings.shoppers,
          appNote: await frontmostAppSkillNote(enabledSkills()),
          canProposeTasks: settings.agentModeEnabled,
          visionAssist: settings.visionAssist,
        });
        return streamBrain(messages, system, toolDefinitions(tools), handlers, signal, {
          fallbackModel: settings.brainModel,
          effort: resolveEffort(settings.brainEffort, 'task'),
        });
      },
      tools,
      history: [],
      userContent,
      // A step costs a few calls (find the target, then draw + wait), and
      // apps without an accessibility tree add OCR hunting on top; 20 cut
      // real walkthroughs off mid-task.
      maxModelCalls: 60,
      signal: abort.signal,
      onTextDelta: (delta) => {
        const cleaned = markers.clean(delta);
        if (speechActive) {
          pushText(delta);
          return;
        }
        if (cleaned.text) broadcast(IpcChannels.sessionResponseDelta, cleaned.text);
        revealDrawings(cleaned.markers);
      },
    });

    if (result.stopReason === 'aborted') report(stopNote ?? 'Walkthrough stopped.');
    else if (result.stopReason === 'limit') report('Stopped: the walkthrough ran too long.');
    log.info(`walkthrough finished (${result.stopReason})`);
  } catch (error) {
    if (!abort.signal.aborted) report(`Walkthrough failed: ${friendlyApiError(error)}`);
  } finally {
    // drainSpeech calls finishText itself — do not finish first or the
    // acknowledgement is cut off when we hand over to the agent.
    if (handedOff && !abort.signal.aborted) await drainSpeech(ACK_DRAIN_MS);
    else if (speechActive) finishText();
    broadcast(IpcChannels.sessionResponseDone);
    setState('idle');
    active = null;
    running = false;
  }
  if (handedOff && !abort.signal.aborted) void runApprovedAgentTask(handedOff);
}

function report(message: string): void {
  log.warn(message);
  broadcast(IpcChannels.sessionError, message);
}
