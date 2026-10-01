// One guide-mode turn: the user's ask (transcript, screenshots, marks) goes to
// the brain through the tool loop; the reply streams out as speech and
// captions; and the exchange lands in the conversation. A turn can also end
// in a handover — a proposed agent task or a walkthrough — which starts the
// moment Buddy finishes acknowledging it.

import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { screen } from 'electron';
import type { Attachment } from '../../shared/attachments';
import { attachmentsNote } from './attachments';
import { isBlandServer } from '../../shared/types';
import { useCaseNudgeBlock } from '../../shared/use-cases';
import { knownAccount } from '../account/api';
import { talkOnly } from '../account/plan-gate';
import { activityLabel, setActivity } from '../activity';
import { isAgentActive, runApprovedAgentTask, type AgentTask } from '../agent/agent';
import { createProposeTaskTool } from '../agent/control-tools';
import { frontmostAppSkillNote } from '../ai/app-notes';
import { answersLocally, streamBrain, warmBrain, type StreamOverrides } from '../ai/brain';
import { resolveEffort } from '../ai/effort';
import { lastReply, readIntent, toolHint } from '../ai/intent';
import { jev } from '../ai/jev';
import { runToolLoop, type ToolLoopResult } from '../ai/loop';
import {
  buildChatSystemPrompt,
  buildGuideSystemPrompt,
  buildWaitlistSystemPrompt,
  withUsage,
  type GuideContext,
} from '../ai/prompt';
import { pickModel } from '../ai/router';
import { toolDefinitions } from '../ai/tools';
import { assembleTools, type AssembledTools } from '../ai/turn-tools';
import type { ScreenshotMeta } from '../capture';
import { agentHandoverTurns } from '../chat/agent-context';
import {
  activeContext,
  correctActiveUserText,
  recordExchange,
  settleStrayAgentTrace,
} from '../chat/conversations';
import { appsReady, knownConnectedApps, listConnectedApps } from '../composio/apps';
import { hasDrawings, revealAllDrawings, revealDrawings } from '../drawing/tools';
import { productSearchAvailable } from '../exa/product-search';
import { runFollowAlong } from '../followalong/runner';
import { createWalkMeThroughTool, type Walkthrough } from '../followalong/tools';
import { createLogger } from '../log';
import type { MarksRequest } from '../marks/context';
import { listServers } from '../mcp/config';
import { getMcpServerViews, hasWebSearchServer } from '../mcp/manager';
import { allowedInAirplaneMode } from '../mcp/permissions';
import { takeStoryTurn } from '../onboarding';
import { hasPaymentCard } from '../payment/card';
import { canCheckout } from '../payment/checkout';
import {
  enabledSkills,
  getAppSecret,
  getSettings,
  loadableSkillNames,
  updateSettings,
} from '../settings';
import { resetTurnLinks, takeTurnLinks } from '../sources';
import { createCaptionPacer } from '../speech/captions';
import { biasTerms, mergeVocabulary, pairsFromCorrection } from '../speech/dictionary';
import { createMarkerStream, stripMarkers } from '../speech/markers';
import { cancelSpeech, drainSpeech, finishText, pushText, startSpeech } from '../speech/tts';
import { getState, setState } from '../state';
import { broadcast } from '../windows';
import { setActivePacer } from './lifecycle';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('session');

/**
 * Guide mode's step limit: at most this many model calls per request. Deep
 * enough for a shopping turn (search, a page check or two, a tab, the
 * sentence) — the cap is a runaway guard, not a feature budget.
 */
const GUIDE_MAX_MODEL_CALLS = 8;

/**
 * How long the agent waits for Buddy to finish acknowledging the task. Long
 * enough for a sentence or three; short enough that a wedged clip doesn't
 * look like the task never started.
 */
const ACK_DRAIN_MS = 6_000;

type Settings = ReturnType<typeof getSettings>;

/**
 * This turn's user marks: the images and per-mark context built for them,
 * or 'unseen' when the eyes are off — the ⟦mark N⟧ tokens are in the
 * transcript, but nothing on screen was captured or described.
 */
export type TurnMarks = MarksRequest | 'unseen';

export interface GuideTurnInput {
  transcript: string;
  screenshots: ScreenshotMeta[];
  signal: AbortSignal;
  /** Text the user highlighted before asking; it rides along as its own block. */
  highlight?: string;
  marks?: TurnMarks;
  /** Photos and PDFs sent with the ask: the model's blocks, and the chips the transcript keeps. */
  attachments?: { blocks: ContentBlockParam[]; chips: Attachment[] };
}

/** Latest transcript correction, applied to history after the turn lands. */
let pendingTranscriptFix: string | null = null;

export function learnFromTranscriptEdit(original: string, corrected: string): string[] {
  pendingTranscriptFix = corrected;
  correctActiveUserText(original, corrected);
  // An edit that swaps words teaches the whole mishearing pair — next time
  // "Sweetler" comes back from the engine, the transcript says Sweedler.
  const learned = pairsFromCorrection(original, corrected);
  if (learned.length > 0) {
    updateSettings({ vocabulary: mergeVocabulary(getSettings().vocabulary, learned) });
  }
  return biasTerms(getSettings().vocabulary);
}

export async function runGuideTurn({ transcript, screenshots, signal, highlight, marks, attachments }: GuideTurnInput): Promise<void> {
  pendingTranscriptFix = null;
  setActivity('Thinking…');
  resetTurnLinks();

  // Speech starts as soon as the first sentence completes, mid-stream. The
  // caption follows the voice: each sentence reaches the bubble at the moment
  // it is spoken, not when the model streamed it — reading "Done" before
  // Buddy has said (or done) it is worse than waiting a beat. Within the
  // sentence, the pacer types the words out at roughly the voice's pace.
  const pacer = createCaptionPacer((text) => {
    setActivity(null); // Buddy is talking; his words are the status now
    broadcast(IpcChannels.sessionResponseDelta, text);
  });
  setActivePacer(pacer);
  const speechActive = startSpeech(
    signal,
    () => {
      // The voice has finished: whatever the pace estimate still holds is
      // said, and nothing is still waiting for its marker.
      pacer.flush();
      setActivity(null);
      revealAllDrawings();
      if (getState() === 'speaking') setState('idle');
    },
    (caption) => pacer.push(`${caption} `),
  );
  // Reveal markers are stage direction: spoken text drives the reveals (see
  // tts), and the caption must never show the [[name]] itself.
  const markers = createMarkerStream();

  const settings = getSettings();
  const waitlisted = talkOnly();
  // propose_task / walk_me_through: on approval, the guide turn is over —
  // abort the loop and hand over right after it returns.
  let approvedTask: AgentTask | null = null;
  let approvedWalk: Walkthrough | null = null;
  const { tools, disabledTools } = await guideTools(settings, screenshots, {
    walk: (next) => {
      approvedWalk = next;
    },
    task: (task) => {
      approvedTask = task;
    },
  });

  // With every tool this turn can call in hand, Jev reads the ask once: the
  // brain it needs, and the tool it most likely ends in. Sub-second, and
  // without a key it is the regex router as before.
  const intent = await readIntent(await jev(), transcript, tools, lastReply(activeContext()));
  const brain = chooseBrain(settings, transcript, intent.deep);

  // The walk's story step, even a bare "hi": it answers once and sends them to Next.
  const storyTurn = takeStoryTurn();
  // Small talk goes out light: no tool schemas, no screenshots, a short
  // prompt. "Hey buddy" otherwise costs the same as a shopping turn. The
  // waitlist always does: words in, words out, and the one memory tool. A
  // local model keeps one cached prompt, though: a light one would push out
  // the full prompt every other turn reuses, so locally nothing goes light.
  const light =
    waitlisted ||
    (!storyTurn && !answersLocally() && intent.chat && marks === undefined && !highlight?.trim() && !attachments);
  const definitions = light && !waitlisted ? [] : toolDefinitions(tools);
  const system = withUsage(waitlisted
    ? buildWaitlistSystemPrompt(settings.shoppers[0]?.name, storyTurn)
    : light ? buildChatSystemPrompt(settings.shoppers[0]?.name) : buildGuideSystemPrompt(guideContext(settings, disabledTools, {
    appNote: await frontmostAppSkillNote(enabledSkills()),
    hasMarks: marks !== undefined,
    useCaseNudge: guideUseCaseNudge(settings),
    firstRun: storyTurn,
  })), knownAccount());
  let said = false;
  const result = await runToolLoop({
    // The brain is the cloud provider when its key works, else the local
    // Ollama model.
    callModel: (messages, handlers, loopSignal) =>
      streamBrain(messages, system, definitions, handlers, loopSignal, brain),
    tools,
    history: activeContext(),
    userContent: light
      ? [{ type: 'text', text: transcript }]
      : buildUserContent(
          screenshots,
          transcript,
          [highlightBlock(highlight), filesNote(attachments?.chips), toolHint(intent)],
          marks,
          attachments?.blocks,
        ),
    maxModelCalls: GUIDE_MAX_MODEL_CALLS,
    signal,
    // A reply that already spoke and only drew is the whole answer. Another
    // model call is how the same mark gets labelled twice before anyone hears it.
    stopAfterSpokenDraw: true,
    // "Let me check…" before a lookup is never heard; see speechGate in loop.ts.
    speakOnlyAnswers: true,
    onTextDelta: (delta) => {
      if (/\S/.test(delta)) said = true;
      // The home window streams the reply as the model writes it, always.
      const cleaned = markers.clean(delta);
      if (cleaned.text) broadcast(IpcChannels.sessionStreamDelta, cleaned.text);
      // With speech, the caption and the reveals both follow the voice: a
      // sentence reaches the bubble and fires its markers when it is spoken.
      // Without, the streamed text is the moment for both.
      if (speechActive) {
        pushText(delta);
        return;
      }
      if (cleaned.text) {
        setActivity(null);
        broadcast(IpcChannels.sessionResponseDelta, cleaned.text);
      }
      revealDrawings(cleaned.markers);
    },
    onToolActivity: (name) =>
      setActivity(
        name === null
          ? 'Thinking…'
          : tools.get(name)?.waitsForUser
            ? null // a card or question is up; it explains itself
            : activityLabel(name),
      ),
  });
  // Cast: TS cannot see the callback assignment, so it narrows the original
  // to null here (and to never inside the if).
  const sent = attachments ? { attachments: attachments.chips } : {};
  const handedWalk = approvedWalk as Walkthrough | null;
  if (handedWalk) {
    recordExchange(transcript, `Started a walkthrough: ${handedWalk.goal}`, [], [], sent);
    await drainSpeech(ACK_DRAIN_MS);
    cancelSpeech();
    broadcast(IpcChannels.sessionResponseDone);
    if (!signal.aborted) {
      setState('idle');
      void runFollowAlong(handedWalk);
    }
    return;
  }
  const handedOff = approvedTask as AgentTask | null;
  if (handedOff) {
    // Buddy just said "sure, I'll do that". Let it finish: being cut off
    // mid-word to start work reads as a crash rather than a handover.
    setActivity(null);
    // The handover line stays in the conversation. The run fills it in: inner
    // reasoning as the task goes, then what Buddy says when it ends.
    recordExchange(
      transcript,
      `Started an agent task: ${handedOff.goal}`,
      agentHandoverTurns(transcript, handedOff.goal, handedOff.steps),
      [],
      { agent: true, ...sent },
    );
    await drainSpeech(ACK_DRAIN_MS);
    startAgentTask(handedOff, signal);
    return;
  }
  if (signal.aborted || result.stopReason === 'aborted') return;

  // A turn that spent every word on tool calls has nothing to say, and
  // silence reads as Buddy never hearing the question at all.
  const excuse = said ? '' : giveUp(result.stopReason, result.turns);
  recordExchange(transcript, assistantText(result.turns) || excuse, result.turns, takeTurnLinks(), sent);
  if (pendingTranscriptFix) {
    correctActiveUserText(transcript, pendingTranscriptFix);
    pendingTranscriptFix = null;
  }
  if (excuse) {
    // Spoken, the excuse reaches the caption when it is said; otherwise now.
    if (speechActive) pushText(excuse);
    else broadcast(IpcChannels.sessionResponseDelta, excuse);
  }
  const tail = markers.flush();
  if (tail) {
    broadcast(IpcChannels.sessionStreamDelta, tail);
    if (!speechActive) broadcast(IpcChannels.sessionResponseDelta, tail);
  }
  broadcast(IpcChannels.sessionResponseDone);

  // Stay in `speaking` until the sentence queue drains (the startSpeech
  // callback flips us back to idle). Short responses may already be done.
  if (speechActive && finishText()) {
    setState('speaking');
  } else {
    // No voice to wait for: whatever never got its marker appears now.
    setActivity(null);
    revealAllDrawings();
    setState('idle');
  }
}

/**
 * Every tool a full guide turn offers: the shared registry, plus
 * walkthroughs and agent tasks, which hand the turn over on approval. With
 * the eyes off there is nothing to point at or draw on, so the annotation
 * tools stay out. A waitlist account gets only memory.
 */
async function guideTools(
  settings: Settings,
  screenshots: ScreenshotMeta[],
  handover: { walk: (walk: Walkthrough) => void; task: (task: AgentTask) => void },
): Promise<AssembledTools> {
  const assembled = await assembleTools({ screenshots: settings.screenAwareness ? screenshots : undefined });
  if (talkOnly()) return assembled;
  if (settings.screenAwareness) {
    const walk = createWalkMeThroughTool(handover.walk);
    assembled.tools.set(walk.definition.name, walk);
  }
  if (settings.agentModeEnabled) {
    const propose = createProposeTaskTool(handover.task, isAgentActive);
    assembled.tools.set(propose.definition.name, propose);
  }
  return assembled;
}

/** What the guide prompt is built from; `turn` holds the parts that land after its live break. */
function guideContext(
  settings: Settings,
  disabledTools: Set<string>,
  turn: Pick<GuideContext, 'appNote' | 'hasMarks' | 'useCaseNudge' | 'firstRun'> = { appNote: '' },
): GuideContext {
  return {
    ...turn,
    hasExternalTools: hasWebSearchServer(),
    hasConnectedApps: appsReady(),
    connectedApps: knownConnectedApps(),
    seesScreen: settings.screenAwareness,
    canProposeTasks: settings.agentModeEnabled && !talkOnly(),
    confirmsPlans: settings.agentConfirmPlans,
    confirmsActions: settings.agentConfirmActions,
    skillNames: loadableSkillNames(),
    disabledTools: [...disabledTools],
    canWalkThrough: settings.screenAwareness,
    visionAssist: settings.visionAssist,
    productBrowse: settings.productBrowse,
    canOrder: canCheckout(),
    hasSavedCard: hasPaymentCard(),
    ...(hasBlandPhone() ? { callStyle: settings.callStyle, blandVoice: settings.blandVoice } : {}),
    shoppers: settings.shoppers,
    hasCatalog: Boolean(getAppSecret('shopify')) && !settings.airplaneMode,
    hasProductSearch: productSearchAvailable(),
    local: answersLocally(),
  };
}

const NO_HANDOVER = { walk: () => undefined, task: () => undefined };

/** The drawing tools read differently with no screen to describe, so warm with one, as a turn has. */
function standInShot(): ScreenshotMeta {
  const display = screen.getPrimaryDisplay();
  return {
    displayId: display.id,
    label: 'Screen 1',
    imageWidth: 0,
    imageHeight: 0,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    isCursorDisplay: true,
    base64: '',
  };
}
/** Long enough for MCP servers reconnecting and a burst of settings changes to settle. */
const WARM_DEBOUNCE_MS = 5_000;
let warmTimer: NodeJS.Timeout | null = null;

/**
 * Read the full guide prompt and tools into the local model's cache before
 * the next ask. What changes per turn rides on the ask itself (see
 * toOllamaChat), so this is the start of every local turn's request, and
 * the first one no longer waits a minute for it. Debounced: settings and
 * MCP servers change in bursts.
 */
export function scheduleLocalWarmup(): void {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    warmTimer = null;
    // Once a turn is asking, a warm-up would queue behind it and cut its history out of the
    // cache. While the user is still talking, it's a head start.
    const state = getState();
    if (state === 'thinking' || state === 'speaking') return scheduleLocalWarmup();
    void warmLocalBrain().catch((error) => log.info(`local warm-up skipped: ${errorMessage(error)}`));
  }, WARM_DEBOUNCE_MS);
}

async function warmLocalBrain(): Promise<void> {
  if (!answersLocally() || talkOnly()) return;
  // The connected apps are part of the prompt; a list still loading would warm the wrong one.
  if (appsReady() && knownConnectedApps() === null) await listConnectedApps().catch(() => undefined);
  const settings = getSettings();
  const { tools, disabledTools } = await guideTools(settings, [standInShot()], NO_HANDOVER);
  await warmBrain(buildGuideSystemPrompt(guideContext(settings, disabledTools)), toolDefinitions(tools));
}

/**
 * Which cloud model answers, and what streamBrain retries with. Quick
 * questions go to the fast model and answer in a fraction of the time; the
 * ones that need working out — and, in agent mode, the ones that end in a
 * propose_task call — pay for the bigger one. Whichever brain actually
 * answers logs itself.
 */
function chooseBrain(settings: Settings, transcript: string, verdict: boolean | null): StreamOverrides {
  const model = pickModel(
    transcript,
    { fast: settings.brainFastModel, deep: settings.brainModel, canAct: settings.agentModeEnabled },
    verdict,
  );
  const usingFast = Boolean(settings.brainFastModel) && model === settings.brainFastModel;
  return {
    model,
    // The fast model has no effort setting.
    ...(usingFast ? {} : { effort: resolveEffort(settings.brainEffort, 'answer') }),
    fallbackModel: settings.brainModel,
  };
}

/**
 * Hand an approved plan to the agent runner and reset the guide session.
 * Callers that have something worth hearing first drain the voice before
 * calling; whatever is left over belongs to a turn that is now over.
 */
export function startAgentTask(task: AgentTask, signal: AbortSignal): void {
  cancelSpeech(); // the agent arms the same pipeline for its own narration
  broadcast(IpcChannels.sessionResponseDone);
  if (signal.aborted) {
    // Escape while Buddy was finishing its sentence: the handover line is
    // already in the chat, and the run that would have filled it in never starts.
    settleStrayAgentTrace('Agent task stopped.');
    return;
  }
  setState('idle');
  void runApprovedAgentTask(task);
}

/** How the files sent this turn can be passed on, by name; nothing when none were. */
function filesNote(chips?: Attachment[]): string | undefined {
  return chips?.length ? attachmentsNote(chips.map((chip) => chip.name)) : undefined;
}

/** The extra user block carrying highlighted text, or nothing to carry. */
function highlightBlock(selection = ''): string | undefined {
  const text = selection.trim();
  return text ? `The user highlighted this text:\n\n${text}` : undefined;
}

/** One text+image pair per screen, the files sent, any extra text blocks, then the user's transcript. */
function buildUserContent(
  screenshots: ScreenshotMeta[],
  transcript: string,
  extraTexts: (string | undefined)[],
  marks?: TurnMarks,
  attachments: ContentBlockParam[] = [],
): ContentBlockParam[] {
  // A marked turn's images were assembled by the marks module: annotated
  // screenshots (plus release shots where the screen changed), close-up
  // crops, and the per-mark context block.
  const blocks: ContentBlockParam[] =
    marks && marks !== 'unseen' ? [...marks.imageBlocks, marks.contextBlock] : screenshotBlocks(screenshots);
  blocks.push(...attachments);
  for (const text of extraTexts) if (text) blocks.push({ type: 'text', text });
  blocks.push({ type: 'text', text: transcript });
  return blocks;
}

function screenshotBlocks(screenshots: ScreenshotMeta[]): ContentBlockParam[] {
  return screenshots.flatMap((shot): ContentBlockParam[] => [
    {
      type: 'text',
      // The frame_id is what a drawing anchors to. Without it the model has
      // to invent one, and an invented id cannot resolve to anything.
      text:
        `${shot.label}${shot.isCursorDisplay ? ' (cursor is here)' : ''}, ` +
        `${shot.imageWidth}x${shot.imageHeight}, frame_id ${shot.frameId}`,
    },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.base64 } },
  ]);
}

/**
 * What Buddy said this exchange: the turns' assistant text, markers stripped.
 * Paragraph breaks stay — the chat window renders this text, and collapsing
 * newlines turns a reply with paragraphs into one wall of text. Narration
 * the speech gate dropped is already gone from the turns (see loop.ts), so
 * the window matches what was heard.
 */
function assistantText(turns: MessageParam[]): string {
  const parts: string[] = [];
  for (const turn of turns) {
    if (turn.role !== 'assistant' || !Array.isArray(turn.content)) continue;
    for (const block of turn.content) {
      if (block.type === 'text' && block.text.trim()) parts.push(stripMarkers(block.text).trim());
    }
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Guide tools whose success the user can see or hear for themselves — a tab
 * opening, music pausing, a draft appearing. A silent turn that pulled one
 * of these off did its job; only silence with nothing to show is a failure.
 */
const VISIBLE_ACTION_TOOLS = new Set([
  'browser_tabs',
  'media_control',
  'insert_draft',
  'send_message',
  'mail',
  'notes',
  'run_shortcut',
  'run_command',
  'reveal_file',
]);

/** Did a user-visible tool call in these turns come back without an error? */
function visibleActionSucceeded(turns: MessageParam[]): boolean {
  const failed = new Set<string>();
  for (const turn of turns) {
    if (turn.role !== 'user' || !Array.isArray(turn.content)) continue;
    for (const block of turn.content) {
      if (block.type === 'tool_result' && block.is_error) failed.add(block.tool_use_id);
    }
  }
  return turns.some(
    (turn) =>
      turn.role === 'assistant' &&
      Array.isArray(turn.content) &&
      turn.content.some(
        (block) =>
          block.type === 'tool_use' && VISIBLE_ACTION_TOOLS.has(block.name) && !failed.has(block.id),
      ),
  );
}

/** What Buddy says when a turn spent every word on tool calls and none on the user. */
function giveUp(stopReason: ToolLoopResult['stopReason'], turns: MessageParam[]): string {
  log.warn(`nothing said (${stopReason})`);
  if (stopReason === 'limit' || stopReason === 'truncated') {
    // Everything gathered so far is already in the conversation, so the next
    // ask resumes with a fresh step budget. Mid-flow — a shopping
    // presentation, a lookup chain — an offer to continue keeps the rhythm;
    // pushing a mode switch ("ask me as a task") read as a breakdown.
    return 'That took more steps than one turn gives me. Say "keep going" and I\'ll pick up right where I left off.';
  }
  if (hasDrawings()) return "I've marked that up on your screen. Ask me about any part of it.";
  // The work happened and the user can see it — the model just had nothing
  // to add (often rightly: repeating an already-discussed product to open
  // its tab would break the never-repeat rule). Apologizing here reads as a
  // failure the user can see didn't happen.
  if (visibleActionSucceeded(turns)) return 'Done. Take a look.';
  return "Sorry, I couldn't put that one together. Try asking me for a smaller piece of it.";
}

/** Missing use-case setup for this turn. A cold Composio list fills in the background. */
function guideUseCaseNudge(settings: Settings): string {
  const known = knownConnectedApps();
  if (appsReady() && known === null) {
    void listConnectedApps().catch(() => undefined);
  }
  return useCaseNudgeBlock(
    {
      disabledBuiltinTools: settings.disabledBuiltinTools,
      screenAwareness: settings.screenAwareness,
      marksEnabled: settings.marksEnabled,
      agentModeEnabled: settings.agentModeEnabled,
      servers: getMcpServerViews().map((server) => ({
        name: server.name,
        url: server.url,
        enabled: server.enabled,
        status:
          settings.airplaneMode && !allowedInAirplaneMode(server.transport, server.url)
            ? 'disconnected'
            : server.status,
      })),
      hasCard: hasPaymentCard(),
      shopifyKey: Boolean(getAppSecret('shopify')),
      shipping: settings.buddyShipping,
      connectedApps: known ?? [],
    },
    // A key with no list yet would nag about Gmail or Notion before we know.
    { skipApps: known === null && appsReady() },
  );
}

/** Whether phone calls work: a Bland MCP server is connected and enabled. */
function hasBlandPhone(): boolean {
  return listServers().some(isBlandServer);
}
