// The single preload for all Buddy windows. Exposes a typed, mostly
// receive-only bridge; renderers never get direct Electron/Node access.
// Kept as one file because sandboxed preloads cannot require() other files.

import { contextBridge, ipcRenderer } from 'electron';
import type { Attachment } from '../shared/attachments';
import type { DrawingReveal, DrawingsPayload } from '../shared/drawing';
import {
  type AccountView,
  type AgentDrivingHud,
  type AgentLogEntry,
  type Annotation,
  type AppState,
  type BrowserStatus,
  type CallStatus,
  type ChatIndex,
  type CleanMark,
  type CommandOutputEvent,
  type ConfirmCard,
  type ConfirmPlanDraft,
  type CursorMove,
  type HomeShowTarget,
  type MarkStrokePayload,
  type MarksMode,
  type McpServerView,
  type OllamaPullProgress,
  type OverlayMouseMode,
  type QuestionCard,
  type DictationTranscript,
  type RecordingResult,
  type SelectionShow,
  type SettingsView,
  type UpdateStatus,
} from '../shared/types';
import type { IdeasView, JobsView } from '../shared/jobs';
import type { TourStopId } from '../shared/tour';
import { IpcChannels, type BuddyApi } from '../shared/ipc';

const api: BuddyApi = {
  getState: () => ipcRenderer.invoke(IpcChannels.stateGet) as Promise<AppState>,
  onStateChanged: (cb) =>
    ipcRenderer.on(IpcChannels.stateChanged, (_event, state: AppState) => cb(state)),
  onCursorMoved: (cb) =>
    ipcRenderer.on(IpcChannels.cursorMoved, (_event, pos: CursorMove) => cb(pos)),
  onCursorHidden: (cb) => ipcRenderer.on(IpcChannels.cursorHidden, () => cb()),
  onAnnotationsDraw: (cb) =>
    ipcRenderer.on(IpcChannels.annotationsDraw, (_event, annotations: Annotation[]) => cb(annotations)),
  onAnnotationsClear: (cb) => ipcRenderer.on(IpcChannels.annotationsClear, () => cb()),
  onDrawings: (cb) =>
    ipcRenderer.on(IpcChannels.drawingsSet, (_event, payload: DrawingsPayload) => cb(payload)),
  onDrawingsReveal: (cb) =>
    ipcRenderer.on(IpcChannels.drawingsReveal, (_event, reveal: DrawingReveal) => cb(reveal)),
  getAccount: () => ipcRenderer.invoke(IpcChannels.accountGet),
  onAccountChanged: (cb) =>
    ipcRenderer.on(IpcChannels.accountChanged, (_event, view: AccountView) => cb(view)),
  signInWithGoogle: () => ipcRenderer.invoke(IpcChannels.accountSignInGoogle),
  signOut: (opts?: { showSignIn?: boolean }) => ipcRenderer.invoke(IpcChannels.accountSignOut, opts),
  setAccountName: (firstName, lastName) => ipcRenderer.invoke(IpcChannels.accountSetName, firstName, lastName),
  openBilling: (kind, plan) => ipcRenderer.invoke(IpcChannels.accountBilling, kind, plan),
  redeemReferral: (code) => ipcRenderer.invoke(IpcChannels.accountReferral, code),
  setOnDemand: (on) => ipcRenderer.invoke(IpcChannels.accountOnDemand, on),
  setOnboardingStory: (pending) => ipcRenderer.send(IpcChannels.onboardingStory, pending),
  setPermissionsWalk: (walking) => ipcRenderer.send(IpcChannels.onboardingPermissions, walking),
  replayTour: () => ipcRenderer.send(IpcChannels.tourReplay),
  dragAppBundle: () => ipcRenderer.send(IpcChannels.onboardingDragApp),
  voicePreviews: (ids) => ipcRenderer.invoke(IpcChannels.voicePreviews, ids),
  getUpdateStatus: () => ipcRenderer.invoke(IpcChannels.updatesStatus),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannels.updatesCheck),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.updatesInstall),
  onUpdateStatus: (cb) => ipcRenderer.on(IpcChannels.updatesChanged, (_event, status: UpdateStatus) => cb(status)),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsUpdate, patch),
  setApiKey: (provider, value) => ipcRenderer.invoke(IpcChannels.settingsSetKey, provider, value),
  clearApiKey: (provider) => ipcRenderer.invoke(IpcChannels.settingsClearKey, provider),
  testApiKey: (provider) => ipcRenderer.invoke(IpcChannels.settingsTestKey, provider),
  listModels: (provider) => ipcRenderer.invoke(IpcChannels.modelsList, provider),
  chooseFolder: () => ipcRenderer.invoke(IpcChannels.settingsChooseFolder),
  onSettingsChanged: (cb) =>
    ipcRenderer.on(IpcChannels.settingsChanged, (_event, view: SettingsView) => cb(view)),
  openSettingsWindow: (page) => ipcRenderer.send(IpcChannels.settingsOpenWindow, page),
  onSettingsShowPage: (cb) =>
    ipcRenderer.on(IpcChannels.settingsShowPage, (_event, page: string) => cb(page)),
  getPermissions: () => ipcRenderer.invoke(IpcChannels.permissionsGet),
  requestPermission: (name) => ipcRenderer.invoke(IpcChannels.permissionsRequest, name),
  testTextBridge: () => ipcRenderer.invoke(IpcChannels.textBridgeTest),
  canReadMessages: () => ipcRenderer.invoke(IpcChannels.textsReadable),
  openMessagesSettings: () => ipcRenderer.invoke(IpcChannels.textsOpenMessagesSettings),
  relaunch: () => ipcRenderer.send(IpcChannels.appRelaunch),
  isOnBattery: () => ipcRenderer.invoke(IpcChannels.powerOnBattery),
  openLockScreenSettings: () => ipcRenderer.invoke(IpcChannels.lockScreenOpen),
  onRecorderStart: (cb) => ipcRenderer.on(IpcChannels.recorderStart, () => cb()),
  onRecorderStop: (cb) =>
    ipcRenderer.on(IpcChannels.recorderStop, (_event, discard: boolean) => cb(discard)),
  sendRecorderResult: (result: RecordingResult) =>
    ipcRenderer.send(IpcChannels.recorderResult, result),
  sendRecorderError: (message) => ipcRenderer.send(IpcChannels.recorderError, message),
  sendMicLevel: (level) => ipcRenderer.send(IpcChannels.micLevelReport, level),
  onTtsPlay: (cb) =>
    ipcRenderer.on(IpcChannels.ttsPlay, (_event, bytes: Uint8Array, mime: string) => cb(bytes, mime)),
  onTtsStop: (cb) => ipcRenderer.on(IpcChannels.ttsStop, () => cb()),
  sendTtsEnded: () => ipcRenderer.send(IpcChannels.ttsEnded),
  onVadStart: (cb) => ipcRenderer.on(IpcChannels.vadStart, () => cb()),
  onVadStop: (cb) => ipcRenderer.on(IpcChannels.vadStop, () => cb()),
  sendVadSpeechStart: () => ipcRenderer.send(IpcChannels.vadSpeechStart),
  sendVadMisfire: () => ipcRenderer.send(IpcChannels.vadMisfire),
  sendVadResult: (result: RecordingResult) => ipcRenderer.send(IpcChannels.vadResult, result),
  onMicLevel: (cb) => ipcRenderer.on(IpcChannels.micLevel, (_event, level: number) => cb(level)),
  getAlwaysOn: () => ipcRenderer.invoke(IpcChannels.alwaysOnGet),
  onAlwaysOnChanged: (cb) =>
    ipcRenderer.on(IpcChannels.alwaysOnChanged, (_event, on: boolean) => cb(on)),
  onTranscript: (cb) =>
    ipcRenderer.on(IpcChannels.sessionTranscript, (_event, text: string, attachments?: Attachment[]) =>
      cb(text, attachments),
    ),
  onMessageStart: (cb) =>
    ipcRenderer.on(IpcChannels.sessionMessageStart, (_event, spoken: boolean) => cb(spoken)),
  onResponseDelta: (cb) =>
    ipcRenderer.on(IpcChannels.sessionResponseDelta, (_event, delta: string) => cb(delta)),
  onStreamDelta: (cb) =>
    ipcRenderer.on(IpcChannels.sessionStreamDelta, (_event, delta: string) => cb(delta)),
  onResponseDone: (cb) => ipcRenderer.on(IpcChannels.sessionResponseDone, () => cb()),
  onActivity: (cb) =>
    ipcRenderer.on(IpcChannels.sessionActivity, (_event, label: string | null) => cb(label)),
  onSessionError: (cb) =>
    ipcRenderer.on(IpcChannels.sessionError, (_event, message: string) => cb(message)),
  onSessionCancelled: (cb) => ipcRenderer.on(IpcChannels.sessionCancelled, () => cb()),
  onSessionLinks: (cb) =>
    ipcRenderer.on(IpcChannels.sessionLinks, (_event, links: string[]) => cb(links)),
  onCallStatus: (cb) =>
    ipcRenderer.on(IpcChannels.callStatus, (_event, status: CallStatus) => cb(status)),
  onCommandOutput: (cb) =>
    ipcRenderer.on(IpcChannels.commandOutput, (_event, event: CommandOutputEvent) => cb(event)),
  openExternal: (url) => ipcRenderer.invoke(IpcChannels.openExternal, url),
  openMailto: (url) => ipcRenderer.invoke(IpcChannels.openMailto, url),
  getFavicon: (host) => ipcRenderer.invoke(IpcChannels.faviconGet, host),
  getAppIcon: (name) => ipcRenderer.invoke(IpcChannels.appIconGet, name),
  getProductPhoto: (imageUrl, pageUrl) => ipcRenderer.invoke(IpcChannels.productPhotoGet, imageUrl, pageUrl),
  getMcpServers: () => ipcRenderer.invoke(IpcChannels.mcpGetServers),
  saveMcpServer: (draft) => ipcRenderer.invoke(IpcChannels.mcpSaveServer, draft),
  removeMcpServer: (id) => ipcRenderer.invoke(IpcChannels.mcpRemoveServer, id),
  importMcpServers: (json) => ipcRenderer.invoke(IpcChannels.mcpImport, json),
  setMcpToolPermission: (serverId, toolName, permission) =>
    ipcRenderer.invoke(IpcChannels.mcpSetToolPermission, serverId, toolName, permission),
  setAppSecret: (name, value) => ipcRenderer.invoke(IpcChannels.appSecretSet, name, value),
  savePaymentCard: (draft) => ipcRenderer.invoke(IpcChannels.paymentCardSet, draft),
  listAppConnections: () => ipcRenderer.invoke(IpcChannels.appsList),
  connectApp: (slug) => ipcRenderer.invoke(IpcChannels.appsConnect, slug),
  disconnectApp: (slug) => ipcRenderer.invoke(IpcChannels.appsDisconnect, slug),
  onMcpServersChanged: (cb) =>
    ipcRenderer.on(IpcChannels.mcpServersChanged, (_event, views: McpServerView[]) => cb(views)),
  onMcpConfirm: (cb) =>
    ipcRenderer.on(IpcChannels.mcpConfirm, (_event, card: ConfirmCard | null) => cb(card)),
  sendConfirmPlanDraft: (draft: ConfirmPlanDraft) =>
    ipcRenderer.send(IpcChannels.confirmPlanDraft, draft),
  submitConfirmPlan: (draft: ConfirmPlanDraft) =>
    ipcRenderer.send(IpcChannels.confirmPlanSubmit, draft),
  cancelConfirm: () => ipcRenderer.send(IpcChannels.confirmCancel),
  onAskQuestion: (cb) =>
    ipcRenderer.on(IpcChannels.askQuestion, (_event, card: QuestionCard | null) => cb(card)),
  submitAskAnswer: (answer: string) => ipcRenderer.send(IpcChannels.askAnswer, answer),
  setOverlayMouse: (mode: OverlayMouseMode) => ipcRenderer.send(IpcChannels.overlayMouse, mode),
  onAgentPointer: (cb) =>
    ipcRenderer.on(IpcChannels.agentPointer, (_event, pos: CursorMove) => cb(pos)),
  onAgentDriving: (cb) =>
    ipcRenderer.on(IpcChannels.agentDriving, (_event, hud: AgentDrivingHud) => cb(hud)),
  getAgentLog: () => ipcRenderer.invoke(IpcChannels.agentLogGet),
  saveAgentLog: () => ipcRenderer.invoke(IpcChannels.agentLogSave),
  onAgentLogAppend: (cb) =>
    ipcRenderer.on(IpcChannels.agentLogAppend, (_event, entry: AgentLogEntry) => cb(entry)),
  onAgentLogReset: (cb) => ipcRenderer.on(IpcChannels.agentLogReset, () => cb()),
  onSelectionShow: (cb) =>
    ipcRenderer.on(IpcChannels.selectionShow, (_event, pos: SelectionShow) => cb(pos)),
  onSelectionHide: (cb) => ipcRenderer.on(IpcChannels.selectionHide, () => cb()),
  askAboutSelection: () => ipcRenderer.send(IpcChannels.selectionAsk),
  learnDictionary: (original, corrected) =>
    ipcRenderer.invoke(IpcChannels.dictionaryLearn, original, corrected),
  getChatIndex: () => ipcRenderer.invoke(IpcChannels.chatIndex),
  getConversation: (id) => ipcRenderer.invoke(IpcChannels.chatGet, id),
  deleteConversation: (id) => ipcRenderer.invoke(IpcChannels.chatDelete, id),
  setActiveConversation: (id) => ipcRenderer.invoke(IpcChannels.chatSetActive, id),
  sendChatMessage: (text, conversationId, attachments = []) =>
    ipcRenderer.send(IpcChannels.chatSend, text, conversationId, attachments),
  startTalking: () => ipcRenderer.send(IpcChannels.chatTalkDown),
  stopTalking: () => ipcRenderer.send(IpcChannels.chatTalkUp),
  onChatChanged: (cb) =>
    ipcRenderer.on(IpcChannels.chatChanged, (_event, index: ChatIndex) => cb(index)),
  onChatFocusChanged: (cb) =>
    ipcRenderer.on(IpcChannels.chatFocusChanged, (_event, focused: boolean) => cb(focused)),
  onTourChanged: (cb) =>
    ipcRenderer.on(IpcChannels.tourChanged, (_event, stop: TourStopId | null) => cb(stop)),
  onQuickAskShow: (cb) =>
    ipcRenderer.on(IpcChannels.quickAskShow, (_event, highlight: string | null) => cb(highlight)),
  onQuickAskHighlight: (cb) =>
    ipcRenderer.on(IpcChannels.quickAskHighlight, (_event, label: string | null) => cb(label)),
  onQuickAskTranscript: (cb) =>
    ipcRenderer.on(IpcChannels.quickAskTranscript, (_event, event: DictationTranscript) => cb(event)),
  submitQuickAsk: (text) => ipcRenderer.send(IpcChannels.quickAskSubmit, text),
  cancelQuickAsk: () => ipcRenderer.send(IpcChannels.quickAskCancel),
  onQuickAskOpenChanged: (cb) =>
    ipcRenderer.on(IpcChannels.quickAskOpenChanged, (_event, open: boolean) => cb(open)),
  getOllamaStatus: () => ipcRenderer.invoke(IpcChannels.ollamaStatus),
  pullOllamaModel: (model) => ipcRenderer.invoke(IpcChannels.ollamaPull, model),
  installOllama: () => ipcRenderer.invoke(IpcChannels.ollamaInstall),
  onOllamaPullProgress: (cb) =>
    ipcRenderer.on(IpcChannels.ollamaPullProgress, (_event, progress: OllamaPullProgress) =>
      cb(progress),
    ),
  getLocalWhisperReady: () => ipcRenderer.invoke(IpcChannels.sttLocalStatus),
  downloadLocalWhisper: () => ipcRenderer.invoke(IpcChannels.sttLocalDownload),
  onLocalWhisperProgress: (cb) =>
    ipcRenderer.on(IpcChannels.sttLocalProgress, (_event, percent: number) => cb(percent)),
  onMarksMode: (cb) =>
    ipcRenderer.on(IpcChannels.marksMode, (_event, mode: MarksMode) => cb(mode)),
  sendMarkStrokeBegin: () => ipcRenderer.send(IpcChannels.markStrokeBegin),
  sendMarkStroke: (payload: MarkStrokePayload) => ipcRenderer.send(IpcChannels.markStroke, payload),
  onMarksSet: (cb) => ipcRenderer.on(IpcChannels.marksSet, (_event, marks: CleanMark[]) => cb(marks)),
  onMarksClear: (cb) => ipcRenderer.on(IpcChannels.marksClear, () => cb()),
  getLastMarksTurn: () => ipcRenderer.invoke(IpcChannels.marksLastTurn),
  listJobs: () => ipcRenderer.invoke(IpcChannels.jobsList),
  saveJob: (draft) => ipcRenderer.invoke(IpcChannels.jobsSave, draft),
  deleteJob: (id) => ipcRenderer.invoke(IpcChannels.jobsDelete, id),
  runJobNow: (id) => ipcRenderer.invoke(IpcChannels.jobsRunNow, id),
  setJobPaused: (id, paused) => ipcRenderer.invoke(IpcChannels.jobsSetPaused, id, paused),
  resolveApproval: (id, decision) => ipcRenderer.invoke(IpcChannels.approvalsResolve, id, decision),
  onJobsChanged: (cb) =>
    ipcRenderer.on(IpcChannels.jobsChanged, (_event, view: JobsView) => cb(view)),
  listIdeas: () => ipcRenderer.invoke(IpcChannels.ideasList),
  dismissIdea: (id, answer) => ipcRenderer.invoke(IpcChannels.ideasDismiss, id, answer),
  installIdea: (id) => ipcRenderer.invoke(IpcChannels.ideasInstall, id),
  refreshIdeas: () => ipcRenderer.invoke(IpcChannels.ideasRefresh),
  onIdeasChanged: (cb) =>
    ipcRenderer.on(IpcChannels.ideasChanged, (_event, view: IdeasView) => cb(view)),
  onHomeShow: (cb) =>
    ipcRenderer.on(IpcChannels.homeShow, (_event, target: HomeShowTarget) => cb(target)),
  homeReady: () => ipcRenderer.send(IpcChannels.homeReady),
  onHomeReveal: (cb) => ipcRenderer.on(IpcChannels.homeReveal, () => cb()),
  openHome: (target) => ipcRenderer.send(IpcChannels.homeOpen, target),
  setDictationField: (focused) => ipcRenderer.send(IpcChannels.dictationField, focused),
  holdDictation: (down) => ipcRenderer.send(IpcChannels.dictationHold, down),
  onDictation: (cb) =>
    ipcRenderer.on(IpcChannels.dictation, (_event, event: DictationTranscript) => cb(event)),
  getBrowserStatus: () => ipcRenderer.invoke(IpcChannels.browserStatusGet),
  onBrowserStatus: (cb) =>
    ipcRenderer.on(IpcChannels.browserStatus, (_event, status: BrowserStatus) => cb(status)),
  onBrowserPreview: (cb) =>
    ipcRenderer.on(IpcChannels.browserPreview, (_event, base64: string) => cb(base64)),
  sendBrowserCommand: (command) => ipcRenderer.send(IpcChannels.browserCommand, command),
  listLoginSources: () => ipcRenderer.invoke(IpcChannels.browserLoginSources),
  bringLogins: (sourceId) => ipcRenderer.invoke(IpcChannels.browserBringLogins, sourceId),
  forgetLogins: () => ipcRenderer.invoke(IpcChannels.browserForgetLogins),
  openInBrowser: (url) => ipcRenderer.invoke(IpcChannels.browserOpen, url),
  listSignedInSites: () => ipcRenderer.invoke(IpcChannels.browserSignedIn),
};

contextBridge.exposeInMainWorld('buddy', api);
