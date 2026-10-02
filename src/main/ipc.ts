// All ipcMain handlers live here, using channel names from shared/ipc.

import { app, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { UPGRADE_PLANS } from '../shared/contracts';
import {
  BRAIN_PROVIDERS,
  SIGN_IN_SITES,
  type BrowserCommand,
  type ConfirmPlanDraft,
  type HomeShowTarget,
  type KeyProvider,
  type MarkStrokePayload,
  type McpServerDraft,
  type OverlayMouseMode,
  type PaymentCardDraft,
  type PermissionPane,
  type RecordingResult,
  type Settings,
  type ToolPermission,
} from '../shared/types';
import type { JobDraft } from '../shared/jobs';
import { accountView, billingLink, forgetMe, redeemReferral, setOnDemand } from './account/api';
import { bindLocalAccount, noteFinishedOnboarding, noteWalkStep, reopenWalk } from './account/local';
import {
  beginStoryTurn,
  cancelStoryTurn,
  dragAppBundle,
  grantPermission,
  startPermissionsWalk,
  stopPermissionsWalk,
} from './onboarding';
import {
  currentSession,
  onSessionChanged,
  setAccountName,
  signInWithGoogle,
  signOut,
} from './account/session';
import { getActionLog, saveActionLog } from './agent/action-log';
import { stopAgentTask } from './agent/agent';
import { reviveBrain } from './ai/brain';
import { dismissAll } from './drawing/tools';
import { onWalkStep } from './session/asks';
import { greetForWalk, replayTour, sayWalkStep, startTour } from './tour';
import { installOllama, ollamaStatus, pullOllamaModel } from './ai/ollama';
import { resolveQuestion } from './agent/control-tools';
import { getFavicon, getProductPhoto } from './favicon';
import { getAppIcon } from './app-icon';
import { testApiKey } from './key-test';
import { listProviderModels } from './models';
import { checkForUpdates, installUpdate, updateStatus } from './updates';
import { isAllowedMailto, isOpenableUrl } from './links';
import { createLogger } from './log';
import { resolveConfirmation, submitPlanApproval, updatePlanDraft } from './mcp/confirm';
import { importServers, removeServer, saveServer, setPermissionOverride } from './mcp/config';
import { getMcpServerViews, onMcpServersChanged, refreshManagedServers, syncMcpServers } from './mcp/manager';
import { scheduleLocalWarmup } from './session/guide-turn';
import { getPermissions, openLockScreenSettings } from './permissions';
import { voicePreviewUrls } from './speech/previews';
import { openMessagesSettings } from './apple/messages';
import { jxaErrorMessage } from './apple/jxa';
import { testTextBridge } from './texts/bridge';
import { canReadMessages } from './texts/inbox';
import {
  deleteConversation,
  getChatIndex,
  onConversationsChanged,
  readConversation,
  setActiveConversation,
  startNewConversation,
} from './chat/conversations';
import {
  learnFromTranscriptEdit,
  onAudioCaptured,
  onRecorderError,
  onVadAudio,
  onVadMisfire,
  onVadSpeechStart,
  onTalkDown,
  onTalkUp,
  sendChatMessage,
  endDictation,
  setDictationField,
  startDictation,
} from './session';
import {
  getLastTurnDebug,
  onStroke as onMarkStroke,
  onStrokeBegin as onMarkStrokeBegin,
} from './marks/marks';
import { cancelQuickAsk, openQuickAskFromSelection, submitQuickAsk } from './quick-ask';
import { bringLogins, forgetLogins, listLoginSources, signedInHosts } from './browser/logins';
import { browserStatus, handleBrowserCommand, openBrowserPage } from './browser/window';
import { attachmentDrafts } from './session/attachments';
import { resolveApproval, type ApprovalDecision } from './jobs/approvals';
import { refreshIdeas } from './jobs/ideas';
import { answerIdea } from './jobs/moments';
import { runJobNow } from './jobs/scheduler';
import {
  deleteJob,
  getIdeasView,
  getJobsView,
  onIdeasChanged,
  onJobsChanged,
  removeIdea,
  saveJob,
  setJobPaused,
} from './jobs/store';
import { onPlaybackEnded, reviveSpeaker } from './speech/tts';
import { downloadLocalWhisper, isLocalWhisperReady } from './speech/whisper-local';
import { connectApp, disconnectApp, listAppConnections } from './composio/apps';
import { savePaymentCard } from './payment/card';
import { clearApiKey, clearKeyWarning, getSettings, setApiKey, setAppSecret, updateSettings } from './settings';
import { broadcastSettings, settingsView } from './settings-view';
import { getAlwaysOn, getState, onAlwaysOnChange, onStateChange } from './state';
import {
  applyAppearance,
  broadcast,
  closeSettingsWindow,
  markHomePainted,
  openHomeWindow,
  openHomeWindowAt,
  openSettingsWindow,
  sendFieldDictation,
  setOverlayMouse,
} from './windows';
import { IpcChannels } from '../shared/ipc';
import { errorMessage } from '../shared/errors';

const log = createLogger('ipc');

/** Every ipcMain handler, grouped by the window or feature that calls it. */
export function registerIpc(): void {
  registerStateIpc();
  registerAccountIpc();
  registerSettingsIpc();
  registerShellIpc();
  registerRecorderIpc();
  registerMcpIpc();
  registerOverlayIpc();
  registerChatIpc();
  registerJobsIpc();
  registerBrowserIpc();
}

/** The Buddy account: sign in, sign out, plan and usage. */
function registerAccountIpc(): void {
  const attempt = async (run: () => Promise<void>): Promise<{ ok: boolean; message: string }> => {
    try {
      await run();
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  };
  // Undefined until the stored session has loaded.
  let shownFor: string | null | undefined;
  onSessionChanged(() => {
    const session = currentSession();
    const createdAt = Date.parse(session?.user.created_at ?? '');
    bindLocalAccount(session ? { id: session.user.id, createdAt } : null);
    // Launch decides on a keychain peek, which can name a stale account.
    // Signed out or mid-walk once the real session is known: the window is the product.
    const userId = session?.user.id ?? null;
    if (userId !== shownFor && (!session || !getSettings().onboardingDone)) openHomeWindow();
    shownFor = userId;
    forgetMe();
    void accountView().then((view) => {
      refreshManagedServers();
      broadcast(IpcChannels.accountChanged, view);
      if (session) greetForWalk(session.user.id);
    });
  });
  ipcMain.handle(IpcChannels.accountGet, () => accountView());
  ipcMain.handle(IpcChannels.accountSignInGoogle, () => attempt(signInWithGoogle));
  ipcMain.handle(IpcChannels.accountSetName, async (_event, firstName: string, lastName: string) => {
    const result = await attempt(() => setAccountName(String(firstName ?? ''), String(lastName ?? '')));
    broadcast(IpcChannels.accountChanged, await accountView());
    return result;
  });
  ipcMain.handle(IpcChannels.accountSignOut, async (_event, opts?: { showSignIn?: boolean }) => {
    await signOut();
    if (opts?.showSignIn) {
      closeSettingsWindow();
      openHomeWindow();
    }
    return accountView();
  });
  ipcMain.handle(IpcChannels.accountReferral, (_event, code: string) =>
    redeemReferral(String(code ?? '')).catch((error: unknown) => ({ ok: false, message: errorMessage(error) })),
  );
  ipcMain.handle(IpcChannels.accountOnDemand, (_event, on: unknown) => attempt(() => setOnDemand(on === true)));
  ipcMain.on(IpcChannels.onboardingStory, (_event, pending: unknown) =>
    pending === true ? beginStoryTurn() : cancelStoryTurn(),
  );
  ipcMain.on(IpcChannels.onboardingPermissions, (_event, walking: unknown) =>
    walking === true ? startPermissionsWalk() : stopPermissionsWalk(),
  );
  ipcMain.on(IpcChannels.tourReplay, () => replayTour());
  // The OS drag is over the moment this handler yields: startDrag runs before anything is awaited.
  ipcMain.on(IpcChannels.onboardingDragApp, (event) => dragAppBundle(event.sender));
  ipcMain.handle(IpcChannels.voicePreviews, (_event, ids: unknown) =>
    voicePreviewUrls(Array.isArray(ids) ? ids.map((id) => String(id ?? '')) : []),
  );
  ipcMain.handle(IpcChannels.updatesStatus, () => updateStatus());
  ipcMain.handle(IpcChannels.updatesCheck, () => checkForUpdates());
  ipcMain.handle(IpcChannels.updatesInstall, () => installUpdate());
  ipcMain.handle(IpcChannels.accountBilling, (_event, kind: 'checkout' | 'portal', plan: unknown) =>
    attempt(async () => {
      const wanted = UPGRADE_PLANS.find((id) => id === plan) ?? 'pro';
      await shell.openExternal(await billingLink(kind === 'portal' ? 'portal' : 'checkout', wanted));
      forgetMe();
    }),
  );
}

/** App state and always-on, mirrored to every window. */
function registerStateIpc(): void {
  ipcMain.handle(IpcChannels.stateGet, () => getState());

  // Push every state change to all windows so overlays and the panel stay in sync.
  onStateChange((state) => broadcast(IpcChannels.stateChanged, state));

  ipcMain.handle(IpcChannels.alwaysOnGet, () => getAlwaysOn());
  onAlwaysOnChange((on) => broadcast(IpcChannels.alwaysOnChanged, on));
}

/** The settings window: settings, keys, models, local brain and ear. */
function registerSettingsIpc(): void {
  ipcMain.handle(IpcChannels.settingsGet, () => settingsView());

  ipcMain.handle(IpcChannels.settingsUpdate, (_event, patch: Partial<Settings>) => {
    const before = getSettings().computerProvider;
    const wasDrawingStep = onWalkStep('drawing');
    updateSettings(patch);
    // Leaving the drawing step takes its drawing down: the step kept it up through clicks.
    if (wasDrawingStep && !onWalkStep('drawing')) dismissAll();
    if (patch.onboardingDone === true) {
      noteFinishedOnboarding();
      startTour();
    } else {
      // Unfinishing the walk clears it for this account, or the next launch
      // would treat it as done.
      if (patch.onboardingDone === false) reopenWalk();
      if (typeof patch.onboardingStep === 'string') {
        noteWalkStep(patch.onboardingStep);
        sayWalkStep(patch.onboardingStep);
      }
    }
    // Switching the provider ends any running task: a task never changes the
    // thing driving it halfway through.
    if (getSettings().computerProvider !== before) {
      stopAgentTask('Stopped: the computer provider changed while the task was running.');
    }
    // Picking a voice again (after a quota failure switched us off it) is
    // permission to retry that key on the next turn.
    if (typeof patch.ttsProvider === 'string') reviveSpeaker(patch.ttsProvider);
    if (patch.appearance) applyAppearance(getSettings().appearance);
    // A new local model, or a setting the prompt teaches, needs a fresh cache.
    scheduleLocalWarmup();
    return broadcastSettings();
  });

  ipcMain.handle(IpcChannels.settingsSetKey, (_event, provider: KeyProvider, value: string) => {
    setApiKey(provider, value);
    reviveSpeaker(provider);
    if (provider in BRAIN_PROVIDERS) reviveBrain();
    return broadcastSettings();
  });

  ipcMain.handle(IpcChannels.settingsClearKey, (_event, provider: KeyProvider) => {
    clearApiKey(provider);
    return broadcastSettings();
  });

  ipcMain.handle(IpcChannels.appSecretSet, (_event, name: 'composio' | 'shopify', value: string) => {
    setAppSecret(name, value);
    return broadcastSettings();
  });

  // Returns a form-ready error message, or null on success (settings rebroadcast).
  ipcMain.handle(IpcChannels.paymentCardSet, (_event, draft: PaymentCardDraft | null) => {
    try {
      savePaymentCard(draft);
    } catch (error) {
      return errorMessage(error);
    }
    broadcastSettings();
    return null;
  });

  ipcMain.handle(IpcChannels.appsList, () => listAppConnections());
  ipcMain.handle(IpcChannels.appsConnect, (_event, slug: string) => connectApp(slug));
  ipcMain.handle(IpcChannels.appsDisconnect, (_event, slug: string) => disconnectApp(slug));

  ipcMain.handle(IpcChannels.modelsList, (_event, provider: unknown) => listProviderModels(String(provider ?? '')),
  );

  ipcMain.handle(IpcChannels.settingsTestKey, async (_event, provider: KeyProvider) => {
    const result = await testApiKey(provider);
    if (result.ok) {
      clearKeyWarning(provider);
      reviveSpeaker(provider);
      if (provider in BRAIN_PROVIDERS) reviveBrain();
      broadcastSettings();
    }
    return result;
  });

  // The coding-workspace picker (settings window): a native folder dialog.
  ipcMain.handle(IpcChannels.settingsChooseFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  // The local brain (settings window): Ollama status and model downloads.
  ipcMain.handle(IpcChannels.ollamaStatus, () => ollamaStatus());
  ipcMain.handle(IpcChannels.ollamaPull, (_event, model: string) =>
    pullOllamaModel(String(model ?? '').trim()),
  );
  ipcMain.handle(IpcChannels.ollamaInstall, () => installOllama());

  // The local ear (settings window): status and the one-click download.
  ipcMain.handle(IpcChannels.sttLocalStatus, () => isLocalWhisperReady());
  ipcMain.handle(IpcChannels.sttLocalDownload, () => downloadLocalWhisper());

  ipcMain.on(IpcChannels.settingsOpenWindow, (_event, page?: unknown) =>
    openSettingsWindow(typeof page === 'string' ? page : undefined),
  );
}

/** Links, icons, and permissions. */
function registerShellIpc(): void {
  // Links come from tool results, which are untrusted: only http(s) is opened.
  ipcMain.handle(IpcChannels.openExternal, async (_event, url: string) => {
    if (!isOpenableUrl(url)) {
      log.warn(`refused to open a non-http(s) link: ${url}`);
      return false;
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(IpcChannels.openMailto, async (_event, url: string) => {
    if (!isAllowedMailto(url)) {
      log.warn(`refused to open mailto: ${url}`);
      return false;
    }
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle(IpcChannels.faviconGet, (_event, host: string) => getFavicon(host));
  ipcMain.handle(IpcChannels.appIconGet, (_event, name: string) => getAppIcon(String(name ?? '')));
  ipcMain.handle(IpcChannels.productPhotoGet, (_event, image: string, page: string) =>
    getProductPhoto(String(image ?? ''), String(page ?? '')),
  );

  ipcMain.handle(IpcChannels.permissionsGet, () => getPermissions());

  ipcMain.handle(IpcChannels.permissionsRequest, (_event, name: PermissionPane) => grantPermission(name));

  ipcMain.handle(IpcChannels.textBridgeTest, () => testTextBridge());
  ipcMain.handle(IpcChannels.textsReadable, () => canReadMessages());
  ipcMain.handle(IpcChannels.textsOpenMessagesSettings, () =>
    openMessagesSettings().then(
      () => ({ ok: true, message: '' }),
      (error: unknown) => ({ ok: false, message: jxaErrorMessage(error, 'Messages') }),
    ),
  );
  // exit, not quit: a permission granted mid-run can leave the hotkey's event tap stuck (see hotkey.ts).
  ipcMain.on(IpcChannels.appRelaunch, () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle(IpcChannels.powerOnBattery, () => powerMonitor.isOnBatteryPower());
  ipcMain.handle(IpcChannels.lockScreenOpen, () => openLockScreenSettings());
}

/** The recorder window: microphone audio, playback, and voice activity. */
function registerRecorderIpc(): void {
  // Recorder window -> session.
  ipcMain.on(IpcChannels.recorderResult, (_event, result: RecordingResult) => {
    void onAudioCaptured(result);
  });
  ipcMain.on(IpcChannels.recorderError, (_event, message: string) => onRecorderError(message));
  ipcMain.on(IpcChannels.ttsEnded, () => onPlaybackEnded());

  // Always-on voice activity detection events from the recorder.
  ipcMain.on(IpcChannels.vadSpeechStart, () => onVadSpeechStart());
  ipcMain.on(IpcChannels.vadMisfire, () => onVadMisfire());
  ipcMain.on(IpcChannels.vadResult, (_event, result: RecordingResult) => {
    void onVadAudio(result);
  });

  // Fan the mic level out to every window (panel meter, buddy dot).
  ipcMain.on(IpcChannels.micLevelReport, (_event, level: number) =>
    broadcast(IpcChannels.micLevel, level),
  );
}

/** MCP servers (settings window). */
function registerMcpIpc(): void {
  // MCP servers: config edits reconnect immediately; statuses push to settings.
  onMcpServersChanged(() => {
    broadcast(IpcChannels.mcpServersChanged, getMcpServerViews());
    scheduleLocalWarmup();
  });

  ipcMain.handle(IpcChannels.mcpGetServers, () => getMcpServerViews());

  ipcMain.handle(IpcChannels.mcpSaveServer, (_event, draft: McpServerDraft) => {
    saveServer(draft);
    syncMcpServers();
    return getMcpServerViews();
  });

  ipcMain.handle(IpcChannels.mcpRemoveServer, (_event, id: string) => {
    removeServer(id);
    syncMcpServers();
    return getMcpServerViews();
  });

  ipcMain.handle(IpcChannels.mcpImport, (_event, json: string) => {
    const result = importServers(json);
    syncMcpServers();
    return result;
  });

  ipcMain.handle(
    IpcChannels.mcpSetToolPermission,
    (_event, serverId: string, toolName: string, permission: ToolPermission) => {
      setPermissionOverride(serverId, toolName, permission);
      return getMcpServerViews();
    },
  );
}

/** The overlays: confirmation and question cards, mouse mode, the Ask Buddy button. */
function registerOverlayIpc(): void {
  ipcMain.on(IpcChannels.confirmPlanDraft, (_event, draft: ConfirmPlanDraft) => {
    updatePlanDraft(draft);
  });
  ipcMain.on(IpcChannels.confirmPlanSubmit, (_event, draft: ConfirmPlanDraft) => {
    submitPlanApproval(draft);
  });
  ipcMain.on(IpcChannels.confirmCancel, () => {
    resolveConfirmation(false);
  });
  ipcMain.on(IpcChannels.askAnswer, (_event, answer: string) => {
    const text = typeof answer === 'string' ? answer.trim() : '';
    if (text) resolveQuestion(text);
  });
  ipcMain.on(IpcChannels.overlayMouse, (event, mode: OverlayMouseMode) => {
    setOverlayMouse(event.sender, mode);
  });

  // Agent action log (panel).
  ipcMain.handle(IpcChannels.agentLogGet, () => getActionLog());
  ipcMain.handle(IpcChannels.agentLogSave, () => saveActionLog());

  // Ask Buddy: the highlight becomes the box's chip; the user types the intent.
  ipcMain.on(IpcChannels.selectionAsk, () => {
    void openQuickAskFromSelection();
  });

  ipcMain.handle(IpcChannels.dictionaryLearn, (_event, original: string, corrected: string) => {
    const dictionary = learnFromTranscriptEdit(String(original ?? ''), String(corrected ?? ''));
    broadcastSettings();
    return dictionary;
  });
}

/** The home window: conversations, typed asks, hold-to-talk; and the Type to Buddy box. */
function registerChatIpc(): void {
  // Conversations: the home window's list, transcripts, and typed asks.
  onConversationsChanged((index) => broadcast(IpcChannels.chatChanged, index));
  ipcMain.handle(IpcChannels.chatIndex, () => getChatIndex());
  ipcMain.handle(IpcChannels.chatGet, (_event, id: string) => readConversation(String(id ?? '')));
  ipcMain.handle(IpcChannels.chatDelete, (_event, id: string) =>
    deleteConversation(String(id ?? '')),
  );
  ipcMain.handle(IpcChannels.chatSetActive, (_event, id: string | null) => {
    if (id) setActiveConversation(String(id));
    else startNewConversation();
    return getChatIndex();
  });
  ipcMain.on(IpcChannels.chatSend, (_event, text: string, conversationId: string | null, attachments: unknown) => {
    void sendChatMessage(String(text ?? ''), conversationId ?? null, attachmentDrafts(attachments));
  });
  ipcMain.on(IpcChannels.chatTalkDown, () => onTalkDown());
  ipcMain.on(IpcChannels.chatTalkUp, () => onTalkUp());
  // A field that takes dictation (a job's instructions): the chord while it
  // has focus, or its own hold-to-talk button.
  ipcMain.on(IpcChannels.dictationField, (event, focused: boolean) =>
    setDictationField(focused === true, event.sender),
  );
  ipcMain.on(IpcChannels.dictationHold, (_event, down: boolean) => {
    if (down === true) startDictation(sendFieldDictation);
    else endDictation();
  });

  // The Type to Buddy box: Enter sends (marks ride along), Escape dismisses.
  ipcMain.on(IpcChannels.quickAskSubmit, (_event, text: string) => submitQuickAsk(String(text ?? '')));
  ipcMain.on(IpcChannels.quickAskCancel, () => cancelQuickAsk());

  // User marks: strokes from the overlays, and the dev Marks view's payload.
  ipcMain.on(IpcChannels.markStrokeBegin, (event) => onMarkStrokeBegin(event.sender));
  ipcMain.on(IpcChannels.markStroke, (event, payload: MarkStrokePayload) =>
    onMarkStroke(event.sender, payload),
  );
  ipcMain.handle(IpcChannels.marksLastTurn, () => getLastTurnDebug());
}

/** Jobs, their parked approvals, and suggestions. */
function registerJobsIpc(): void {
  // Settings → Jobs lists and edits them; approvals are answered in the job's conversation.
  onJobsChanged((view) => broadcast(IpcChannels.jobsChanged, view));
  ipcMain.on(IpcChannels.homeReady, () => markHomePainted());
  ipcMain.on(IpcChannels.homeOpen, (_event, target: HomeShowTarget) => {
    const conversationId = typeof target?.conversationId === 'string' ? target.conversationId : undefined;
    openHomeWindowAt(conversationId ? { conversationId } : {});
  });
  onIdeasChanged((view) => broadcast(IpcChannels.ideasChanged, view));
  ipcMain.handle(IpcChannels.jobsList, () => getJobsView());
  ipcMain.handle(IpcChannels.jobsSave, (_event, draft: JobDraft) => {
    saveJob(draft);
    return getJobsView();
  });
  ipcMain.handle(IpcChannels.jobsDelete, (_event, id: string) => {
    deleteJob(String(id ?? ''));
    return getJobsView();
  });
  ipcMain.handle(IpcChannels.jobsRunNow, (_event, id: string) => {
    runJobNow(String(id ?? ''));
    return getJobsView();
  });
  ipcMain.handle(IpcChannels.jobsSetPaused, (_event, id: string, paused: boolean) => {
    setJobPaused(String(id ?? ''), paused === true);
    return getJobsView();
  });
  ipcMain.handle(
    IpcChannels.approvalsResolve,
    async (_event, id: string, decision: ApprovalDecision) => {
      await resolveApproval(String(id ?? ''), decision);
      return getJobsView();
    },
  );
  ipcMain.handle(IpcChannels.ideasList, () => getIdeasView());
  ipcMain.handle(IpcChannels.ideasDismiss, (_event, id: string, answer: unknown) => {
    answerIdea(String(id ?? ''), answer === 'yes' ? 'yes' : 'no');
    return getIdeasView();
  });
  // A recurring idea becomes a job; the renderer runs one-shot ideas itself.
  ipcMain.handle(IpcChannels.ideasInstall, (_event, id: string) => {
    const idea = removeIdea(String(id ?? ''));
    if (idea?.schedule) {
      saveJob({ name: idea.title, prompt: idea.prompt, schedule: idea.schedule });
    }
    return getIdeasView();
  });
  ipcMain.handle(IpcChannels.ideasRefresh, async () => {
    await refreshIdeas();
    return getIdeasView();
  });
}

/** Buddy's browser: its chrome strip, the chat window, and its sign-ins. */
function registerBrowserIpc(): void {
  // Buddy's browser: its strip and the chat window read the same status.
  ipcMain.handle(IpcChannels.browserStatusGet, () => browserStatus());
  ipcMain.on(IpcChannels.browserCommand, (_event, command: unknown) => {
    // Stop belongs to the task, not the window: window.ts cannot import it without a cycle.
    if (command === 'stop') stopAgentTask("Stopped from Buddy's browser.");
    else if (isWindowCommand(command)) handleBrowserCommand(command);
  });

  // Its sign-ins (Settings → Buddy's Browser, and the walk). None of it runs while a
  // task is driving the page: that would pull the rug out from under it.
  const whenIdle = async (run: () => Promise<string>): Promise<{ ok: boolean; message: string }> => {
    if (browserStatus().active) {
      return { ok: false, message: "Buddy is using its browser right now. Try again when that's done." };
    }
    try {
      return { ok: true, message: await run() };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  };
  ipcMain.handle(IpcChannels.browserLoginSources, () => listLoginSources());
  ipcMain.handle(IpcChannels.browserSignedIn, () => signedInHosts(SIGN_IN_SITES));
  ipcMain.handle(IpcChannels.browserBringLogins, (_event, id: unknown) =>
    whenIdle(async () => {
      const { label, sites } = await bringLogins(String(id ?? ''));
      updateSettings({ browserLoginsFrom: label });
      broadcastSettings();
      return `Brought sign-ins for ${sites} sites from ${label}.`;
    }),
  );
  ipcMain.handle(IpcChannels.browserForgetLogins, () =>
    whenIdle(async () => {
      await forgetLogins();
      updateSettings({ browserLoginsFrom: '' });
      broadcastSettings();
      return "Buddy's browser is signed out of everything.";
    }),
  );
  ipcMain.handle(IpcChannels.browserOpen, (_event, url: unknown) =>
    whenIdle(async () => {
      const target = String(url ?? '');
      if (!isOpenableUrl(target)) throw new Error("That isn't a web address.");
      openBrowserPage(target);
      return '';
    }),
  );
}

type WindowCommand = Exclude<BrowserCommand, 'stop'>;
const WINDOW_COMMANDS: ReadonlySet<WindowCommand> = new Set(['expand', 'peek', 'hide']);

function isWindowCommand(value: unknown): value is WindowCommand {
  return WINDOW_COMMANDS.has(value as WindowCommand);
}
