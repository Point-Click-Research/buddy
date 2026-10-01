// The contract between main and the renderers: every IPC channel name, and
// the `window.buddy` API the preload builds on top of them. Main, preload,
// and every renderer import from here so they can never disagree on a name.
// Domain types (what travels over these channels) live in types.ts.

import type { UpgradePlan } from './contracts';
import type { Attachment, AttachmentDraft } from './attachments';
import type { DrawingReveal, DrawingsPayload } from './drawing';
import type { IdeasView, JobDraft, JobsView } from './jobs';
import type { TourStopId } from './tour';
import type {
  AccountView,
  AgentDrivingHud,
  AgentLogEntry,
  Annotation,
  AppConnection,
  AppState,
  BrowserCommand,
  BrowserStatus,
  CallStatus,
  ChatIndex,
  CleanMark,
  CommandOutputEvent,
  ConfirmCard,
  ConfirmPlanDraft,
  ConversationView,
  CursorMove,
  HomeShowTarget,
  KeyProvider,
  KeyTestResult,
  LoginSource,
  MarkStrokePayload,
  MarksMode,
  MarksTurnDebug,
  McpImportResult,
  McpServerDraft,
  McpServerView,
  ModelListResult,
  OllamaPullProgress,
  OllamaStatus,
  OverlayMouseMode,
  PaymentCardDraft,
  PermissionPane,
  PermissionsStatus,
  QuestionCard,
  DictationTranscript,
  RecordingResult,
  SelectionShow,
  Settings,
  SettingsView,
  ToolPermission,
  UpdateStatus,
} from './types';

export const IpcChannels = {
  /** invoke: renderer asks main for the current AppState. */
  stateGet: 'state:get',
  /** main -> renderers: AppState changed. */
  stateChanged: 'state:changed',
  /** main -> one overlay: cursor moved on your display (CursorMove). */
  cursorMoved: 'cursor:moved',
  /** main -> one overlay: cursor left your display, hide the buddy. */
  cursorHidden: 'cursor:hidden',
  /** main -> one overlay: draw these annotations (Annotation[]). */
  annotationsDraw: 'annotations:draw',
  /** main -> all overlays: remove all annotations. */
  annotationsClear: 'annotations:clear',
  /** main -> one overlay: this is everything it should show (DrawCommand[]). */
  drawingsSet: 'drawings:set',
  /** main -> all overlays: reveal shapes waiting on markers (DrawingReveal). */
  drawingsReveal: 'drawings:reveal',
  /** invoke: get AccountView (signed in, plan, usage). */
  accountGet: 'account:get',
  /** main -> renderers: the account changed (AccountView). */
  accountChanged: 'account:changed',
  /** invoke: open Google sign-in in the browser; resolves when signed in or failed ({ ok, message }). */
  accountSignInGoogle: 'account:sign-in-google',
  /** invoke: sign out; returns AccountView. */
  accountSignOut: 'account:sign-out',
  /** invoke: save the first and last name (first, last); returns { ok, message }. */
  accountSetName: 'account:set-name',
  /** invoke: open Stripe in the browser ('checkout' to upgrade, 'portal' to manage); returns { ok, message }. */
  accountBilling: 'account:billing',
  /** invoke: redeem a waitlist referral code (string); returns { ok, message }. */
  accountReferral: 'account:referral',
  /** invoke: extra usage past the pool on or off (boolean); returns { ok, message }. */
  accountOnDemand: 'account:on-demand',
  /** send: the next spoken turn is the first-run story (true), or no longer is (false). */
  onboardingStory: 'onboarding:story',
  /** send: the walk is on its permissions step (true): open System Settings and float the drag card. False takes both down. */
  onboardingPermissions: 'onboarding:permissions',
  /** send: play the first-run tour again for the signed-in account (Settings → Controls). */
  tourReplay: 'tour:replay',
  /** send: start dragging Buddy's app bundle from this window (into a System Settings list). */
  onboardingDragApp: 'onboarding:drag-app',
  /** invoke: public ElevenLabs sample URLs for these voice ids (id → url). Playing them is free. */
  voicePreviews: 'voices:previews',
  /** invoke: where the app's update stands (UpdateStatus). */
  updatesStatus: 'updates:status',
  /** invoke: check the feed now; returns UpdateStatus. */
  updatesCheck: 'updates:check',
  /** invoke: relaunch into the downloaded update. */
  updatesInstall: 'updates:install',
  /** main -> renderers: the update status changed (UpdateStatus). */
  updatesChanged: 'updates:changed',
  /** invoke: get SettingsView (non-secret settings + key statuses). */
  settingsGet: 'settings:get',
  /** invoke: merge a Partial<Settings>; returns the new SettingsView. */
  settingsUpdate: 'settings:update',
  /** invoke: save an API key ({ provider, value }). */
  settingsSetKey: 'settings:set-key',
  /** invoke: delete an API key ({ provider }). */
  settingsClearKey: 'settings:clear-key',
  /** invoke: make a tiny request to verify a key; returns KeyTestResult. */
  settingsTestKey: 'settings:test-key',
  /** invoke: native folder picker; returns the chosen path or null. */
  settingsChooseFolder: 'settings:choose-folder',
  /** main -> renderers: settings or key statuses changed (SettingsView). */
  settingsChanged: 'settings:changed',
  /** send: open the settings window (optional string payload: the page to show). */
  settingsOpenWindow: 'settings:open-window',
  /** main -> settings renderer: switch to a named sidebar page (string). */
  settingsShowPage: 'settings:show-page',
  /** invoke: get PermissionsStatus. */
  permissionsGet: 'permissions:get',
  /** invoke: prompt for / open System Settings for one permission; returns fresh statuses. */
  permissionsRequest: 'permissions:request',
  /** invoke: send a test text to the saved number; returns { ok, message }. */
  textBridgeTest: 'texts:test',
  /** invoke: whether this process can read the Messages database (boolean). */
  textsReadable: 'texts:readable',
  /** invoke: bring Messages to the front on its Settings window; returns { ok, message }. */
  textsOpenMessagesSettings: 'texts:open-messages-settings',
  /** send: quit and reopen Buddy (a permission that applies on the next launch). */
  appRelaunch: 'app:relaunch',
  /** invoke: whether the Mac is on battery right now; returns boolean. */
  powerOnBattery: 'power:on-battery',
  /** invoke: open System Settings on the Lock Screen pane. */
  lockScreenOpen: 'system:open-lock-screen',
  /** main -> recorder: start capturing microphone audio. */
  recorderStart: 'recorder:start',
  /** main -> recorder: stop capturing; boolean payload = discard the audio. */
  recorderStop: 'recorder:stop',
  /** recorder -> main: the finished recording (RecordingResult). */
  recorderResult: 'recorder:result',
  /** recorder -> main: microphone error (string). */
  recorderError: 'recorder:error',
  /** recorder -> main: current mic level 0..1 while recording. */
  micLevelReport: 'mic:level-report',
  /** main -> all windows: mic level 0..1 for meters and the buddy dot. */
  micLevel: 'mic:level',
  /** invoke: is always-on mode active? */
  alwaysOnGet: 'always-on:get',
  /** main -> all windows: always-on mode toggled (boolean). */
  alwaysOnChanged: 'always-on:changed',
  /** main -> all: the user's side of the turn (string), with the chips of any files sent (Attachment[]). */
  sessionTranscript: 'session:transcript',
  /**
   * main -> all: a new message begins. Boolean payload = it is spoken aloud;
   * silent messages (the agent's work log) stay out of the caption bubble.
   */
  sessionMessageStart: 'session:message-start',
  /** main -> all: a chunk of Claude's streaming response (string). */
  sessionResponseDelta: 'session:response-delta',
  /**
   * main -> all: the model's reply text as it streams, markers removed
   * (string). Unlike sessionResponseDelta — which follows the voice when
   * speech is on — this always follows the model, for the home window's
   * chat-style streaming.
   */
  sessionStreamDelta: 'session:stream-delta',
  /** main -> all: the response stream finished. */
  sessionResponseDone: 'session:response-done',
  /**
   * main -> all: what Buddy is doing between speeches, for the shimmer pill
   * ("Searching…", "Thinking…"). Null payload = nothing; take it down.
   */
  sessionActivity: 'session:activity',
  /** main -> all: a user-facing error message with a next step (string). */
  sessionError: 'session:error',
  /** main -> all: the turn was cancelled; take the caption down now. */
  sessionCancelled: 'session:cancelled',
  /** main -> all: links found in a tool result, for the panel's sources (string[]). */
  sessionLinks: 'session:links',
  /** main -> all: a Bland phone call's number and state (CallStatus). */
  callStatus: 'call:status',
  /** main -> all: run_command's live terminal feed (CommandOutputEvent). */
  commandOutput: 'command:output',
  /** invoke: open an http(s) URL in the user's browser; returns whether it was allowed. */
  openExternal: 'shell:open-external',
  /** invoke: open a vetted mailto link in the default mail app; returns whether it was allowed. */
  openMailto: 'shell:open-mailto',
  /** invoke: a site's icon as a data URL, or null (string host). */
  faviconGet: 'favicon:get',
  /** invoke: an installed Mac app's icon as a data URL, or null (string app name, e.g. "Messages"). */
  appIconGet: 'app-icon:get',
  /** invoke: a product photo as a data URL, or null (image URL, product page URL). */
  productPhotoGet: 'product-photo:get',
  /** main -> recorder: play this TTS clip (audio bytes, then the mime type). */
  ttsPlay: 'tts:play',
  /** main -> recorder: stop playback immediately. */
  ttsStop: 'tts:stop',
  /** recorder -> main: the current clip finished (or failed). */
  ttsEnded: 'tts:ended',
  /** main -> recorder: start voice activity detection (always-on mode). */
  vadStart: 'vad:start',
  /** main -> recorder: stop VAD and release the microphone. */
  vadStop: 'vad:stop',
  /** recorder -> main: VAD heard speech begin. */
  vadSpeechStart: 'vad:speech-start',
  /** recorder -> main: what sounded like speech was too short; ignore it. */
  vadMisfire: 'vad:misfire',
  /** recorder -> main: a finished utterance (RecordingResult, WAV). */
  vadResult: 'vad:result',
  /** invoke: current MCP server list with status (McpServerView[]). */
  mcpGetServers: 'mcp:get-servers',
  /** invoke: add or update a server (McpServerDraft); returns McpServerView[]. */
  mcpSaveServer: 'mcp:save-server',
  /** invoke: delete a server by id; returns McpServerView[]. */
  mcpRemoveServer: 'mcp:remove-server',
  /** invoke: import a Claude Desktop-style mcpServers JSON string; returns McpImportResult. */
  mcpImport: 'mcp:import',
  /** invoke: set one tool's permission ({serverId, toolName, permission}); returns McpServerView[]. */
  mcpSetToolPermission: 'mcp:set-tool-permission',
  /** invoke: save or clear a Composio or Shopify Catalog key; returns SettingsView. */
  appSecretSet: 'app-secret:set',
  /** invoke: save (PaymentCardDraft) or clear (null) the payment card; returns an error message or null. */
  paymentCardSet: 'payment:card-set',
  /** invoke: Composio toolkits this Mac has an account for, with status. */
  appsList: 'apps:list',
  /** invoke: open a Connect Link for one toolkit slug. */
  appsConnect: 'apps:connect',
  /** invoke: remove one toolkit's connected account. */
  appsDisconnect: 'apps:disconnect',
  /** main -> renderers: server list or statuses changed (McpServerView[]). */
  mcpServersChanged: 'mcp:servers-changed',
  /** main -> overlays/recorder: show a confirmation card (ConfirmCard) or hide it (null). */
  mcpConfirm: 'mcp:confirm',
  /** overlay -> main: live edits while a plan approval card is open (ConfirmPlanDraft). */
  confirmPlanDraft: 'confirm:plan-draft',
  /** overlay -> main: user finished editing and approved the plan (ConfirmPlanDraft). */
  confirmPlanSubmit: 'confirm:plan-submit',
  /** overlay -> main: Esc on the confirmation card. */
  confirmCancel: 'confirm:cancel',
  /** main -> overlays: show an ask_user question card (QuestionCard) or hide it (null). */
  askQuestion: 'ask:question',
  /** overlay -> main: the user clicked an option or typed an answer (string). */
  askAnswer: 'ask:answer',
  /** overlay -> main: how this overlay wants the mouse handled (OverlayMouseMode). */
  overlayMouse: 'overlay:mouse',
  /** main -> one overlay: the agent is about to act here; fly the dot (CursorMove). */
  agentPointer: 'agent:pointer',
  /** main -> one overlay: show/hide the "Buddy is driving" border + pill (AgentDrivingHud). */
  agentDriving: 'agent:driving',
  /** main -> renderers: one new action-log entry (AgentLogEntry). */
  agentLogAppend: 'agent:log-append',
  /** main -> renderers: a new task started; clear the log. */
  agentLogReset: 'agent:log-reset',
  /** invoke: the current task's log entries (AgentLogEntry[]). */
  agentLogGet: 'agent:log-get',
  /** invoke: save the log to a JSON file; returns the path or null. */
  agentLogSave: 'agent:log-save',
  /** main -> one overlay: show the Ask Buddy button (SelectionShow). */
  selectionShow: 'selection:show',
  /** main -> overlays: hide the Ask Buddy button. */
  selectionHide: 'selection:hide',
  /** overlay -> main: the user clicked Ask Buddy. */
  selectionAsk: 'selection:ask',
  /** invoke: teach the dictionary from a transcript edit ({ original, corrected }). */
  dictionaryLearn: 'dictionary:learn',
  /** invoke: the conversation list and active id (ChatIndex). */
  chatIndex: 'chat:index',
  /** invoke: one conversation's transcript (string id); ConversationView | null. */
  chatGet: 'chat:get',
  /** invoke: delete a conversation by id; returns ChatIndex. */
  chatDelete: 'chat:delete',
  /** invoke: make this the conversation the next ask continues (string id, or null for a fresh one); returns ChatIndex. */
  chatSetActive: 'chat:set-active',
  /** send: a typed ask ({ text, conversationId }); null id starts a new conversation. */
  chatSend: 'chat:send',
  /** send: the home window's hold-to-talk button went down / came up. */
  chatTalkDown: 'chat:talk-down',
  chatTalkUp: 'chat:talk-up',
  /** main -> renderers: conversations or the active id changed (ChatIndex). */
  chatChanged: 'chat:changed',
  /** main -> overlays: the home window gained/lost focus (boolean). */
  chatFocusChanged: 'chat:focus-changed',
  /** main -> renderers: the first-run tour moved to this stop (TourStopId), or ended (null). */
  tourChanged: 'tour:changed',
  /** main -> quick-ask window: the box just opened; reset, focus, and show this chip (string | null). */
  quickAskShow: 'quick-ask:show',
  /** main -> quick-ask window: highlighted text to show as a chip (string), or null to clear it. */
  quickAskHighlight: 'quick-ask:highlight',
  /** main -> quick-ask window: dictated speech for the field (DictationTranscript). */
  quickAskTranscript: 'quick-ask:transcript',
  /** quick-ask -> main: Enter — send this draft (string) with any pending marks. */
  quickAskSubmit: 'quick-ask:submit',
  /** quick-ask -> main: Escape — close without sending; the marks go too. */
  quickAskCancel: 'quick-ask:cancel',
  /** main -> all: the Type to Buddy box opened/closed (boolean). Overlays keep the dot out; the recorder plays the listening cue. */
  quickAskOpenChanged: 'quick-ask:open',
  /** invoke: is Ollama running, and which models are installed (OllamaStatus). */
  ollamaStatus: 'ollama:status',
  /** invoke: download a model by tag (string); resolves with KeyTestResult. */
  ollamaPull: 'ollama:pull',
  /** invoke: brew install ollama and start it (KeyTestResult). */
  ollamaInstall: 'ollama:install',
  /** main -> settings: download progress for a pull (OllamaPullProgress). */
  ollamaPullProgress: 'ollama:pull-progress',
  /** invoke: models a provider offers for brain, ears, or voice (ModelListResult). */
  modelsList: 'models:list',
  /** invoke: is the local Whisper ear downloaded (boolean)? */
  sttLocalStatus: 'stt-local:status',
  /** invoke: download the local Whisper model; resolves with KeyTestResult. */
  sttLocalDownload: 'stt-local:download',
  /** main -> settings: local Whisper download progress (percent 0..100). */
  sttLocalProgress: 'stt-local:progress',
  /** main -> overlays: capture the mouse for marking, or stop (MarksMode). */
  marksMode: 'marks:mode',
  /** overlay -> main: a stroke just started (screenshot this display now). */
  markStrokeBegin: 'marks:stroke-begin',
  /** overlay -> main: a finished stroke (MarkStrokePayload). */
  markStroke: 'marks:stroke',
  /** main -> one overlay: everything it should show (CleanMark[]). */
  marksSet: 'marks:set',
  /** main -> all overlays: remove all marks. */
  marksClear: 'marks:clear',
  /** invoke: the last turn's marks payload for the dev view (MarksTurnDebug | null). */
  marksLastTurn: 'marks:last-turn',
  /** invoke: saved jobs and parked approvals (JobsView). */
  jobsList: 'jobs:list',
  /** invoke: add or update a job (JobDraft); returns JobsView. */
  jobsSave: 'jobs:save',
  /** invoke: delete a job by id; returns JobsView. */
  jobsDelete: 'jobs:delete',
  /** invoke: run a job right now (string id); returns JobsView. */
  jobsRunNow: 'jobs:run-now',
  /** invoke: pause or resume a job (id, paused); returns JobsView. */
  jobsSetPaused: 'jobs:set-paused',
  /** main -> renderers: jobs or approvals changed (JobsView). */
  jobsChanged: 'jobs:changed',
  /** invoke: resolve a parked approval (id, 'once'|'always'|'deny'); returns JobsView. */
  approvalsResolve: 'approvals:resolve',
  /** invoke: the current Ideas batch (IdeasView). */
  ideasList: 'ideas:list',
  /** invoke: drop one idea by id; returns IdeasView. */
  ideasDismiss: 'ideas:dismiss',
  /** invoke: install a recurring idea as a job (string id); returns IdeasView. */
  ideasInstall: 'ideas:install',
  /** invoke: run the Ideas job now; resolves with the fresh IdeasView. */
  ideasRefresh: 'ideas:refresh',
  /** main -> renderers: the Ideas batch changed (IdeasView). */
  ideasChanged: 'ideas:changed',
  /** main -> home window: show this conversation, or New Chat (HomeShowTarget). */
  homeShow: 'home:show',
  /** home -> main: the chat shell has painted, so the window can show without a blank frame. */
  homeReady: 'home:ready',
  /** main -> home window: the chat window was hidden and is on screen again. */
  homeReveal: 'home:reveal',
  /** any window -> main: open the home window on this conversation, or New Chat (HomeShowTarget). */
  homeOpen: 'home:open',
  /** settings -> main: a field that takes dictation (a job's instructions) gained (true) or lost focus. */
  dictationField: 'dictation:field',
  /** settings -> main: the field's hold-to-talk button went down (true) or up. */
  dictationHold: 'dictation:hold',
  /** main -> settings window: dictated speech for the focused field (DictationTranscript). */
  dictation: 'dictation:transcript',
  /** invoke: Buddy's browser as it stands (BrowserStatus). */
  browserStatusGet: 'browser:status-get',
  /** main -> renderers: Buddy's browser changed (BrowserStatus). */
  browserStatus: 'browser:status',
  /** main -> the chrome strip: the latest page capture (base64 JPEG). */
  browserPreview: 'browser:preview',
  /** renderer -> main: expand, peek, hide, or stop (BrowserCommand). */
  browserCommand: 'browser:command',
  /** invoke: the user's browser profiles whose sign-ins can be brought over (LoginSource[]). */
  browserLoginSources: 'browser:login-sources',
  /** invoke: bring one profile's sign-ins into Buddy's browser (string id); returns { ok, message }. */
  browserBringLogins: 'browser:bring-logins',
  /** invoke: which of SIGN_IN_SITES Buddy's browser is signed in to (string[] of hosts). */
  browserSignedIn: 'browser:signed-in',
  /** invoke: sign Buddy's browser out of everything; returns { ok, message }. */
  browserForgetLogins: 'browser:forget-logins',
  /** invoke: open Buddy's browser expanded on this URL (string); returns { ok, message }. */
  browserOpen: 'browser:open',
} as const;

/**
 * What the preload exposes as `window.buddy`. One preload serves every
 * window (sandboxed preloads must be a single file, so splitting per-window
 * would duplicate code); each renderer only uses the parts it needs.
 */
export interface BuddyApi {
  getState(): Promise<AppState>;
  onStateChanged(cb: (state: AppState) => void): void;
  onCursorMoved(cb: (pos: CursorMove) => void): void;
  onCursorHidden(cb: () => void): void;
  onAnnotationsDraw(cb: (annotations: Annotation[]) => void): void;
  onAnnotationsClear(cb: () => void): void;
  onDrawings(cb: (payload: DrawingsPayload) => void): void;
  onDrawingsReveal(cb: (reveal: DrawingReveal) => void): void;
  // The Buddy account (Settings → Account):
  getAccount(): Promise<AccountView>;
  onAccountChanged(cb: (view: AccountView) => void): void;
  signInWithGoogle(): Promise<{ ok: boolean; message: string }>;
  signOut(opts?: { showSignIn?: boolean }): Promise<AccountView>;
  setAccountName(firstName: string, lastName: string): Promise<{ ok: boolean; message: string }>;
  /** Open Stripe: Checkout for a plan (Pro unless said), or the portal. */
  openBilling(kind: 'checkout' | 'portal', plan?: UpgradePlan): Promise<{ ok: boolean; message: string }>;
  redeemReferral(code: string): Promise<{ ok: boolean; message: string }>;
  /** Extra usage past the paid plan's pool, billed at cost at the end of the month. */
  setOnDemand(on: boolean): Promise<{ ok: boolean; message: string }>;
  // The first-run walk:
  /** While true, the next spoken turn is the user's story (saved to Memory, answered like Buddy knows them). */
  setOnboardingStory(pending: boolean): void;
  /** While true, main opens each missing permission's pane in turn and floats the drag card over it. */
  setPermissionsWalk(walking: boolean): void;
  /** Play the first-run tour again, from the top. */
  replayTour(): void;
  /** Called from a dragstart handler: the OS drag carries Buddy.app, for dropping on a System Settings list. */
  dragAppBundle(): void;
  /** Sample clips for these ElevenLabs voice ids. Absent ids have no preview. */
  voicePreviews(ids: string[]): Promise<Record<string, string>>;
  // Updates (Settings → Account):
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): void;
  getSettings(): Promise<SettingsView>;
  updateSettings(patch: Partial<Settings>): Promise<SettingsView>;
  setApiKey(provider: KeyProvider, value: string): Promise<SettingsView>;
  clearApiKey(provider: KeyProvider): Promise<SettingsView>;
  testApiKey(provider: KeyProvider): Promise<KeyTestResult>;
  /** Models this provider offers for chat, transcription, or speech. */
  listModels(provider: string): Promise<ModelListResult>;
  chooseFolder(): Promise<string | null>;
  onSettingsChanged(cb: (view: SettingsView) => void): void;
  openSettingsWindow(page?: string): void;
  onSettingsShowPage(cb: (page: string) => void): void;
  getPermissions(): Promise<PermissionsStatus>;
  /** 'automation' and 'fullDisk' have no prompt; they just open the System Settings pane. */
  requestPermission(name: PermissionPane): Promise<PermissionsStatus>;
  /** The text bridge's Send test: can Buddy read texts and send one to the saved number. */
  testTextBridge(): Promise<{ ok: boolean; message: string }>;
  /** On battery the Mac sleeps and texts wait; plugged in, the bridge keeps it awake. */
  isOnBattery(): Promise<boolean>;
  /** Open System Settings → Lock Screen, where display sleep on battery is set. */
  openLockScreenSettings(): Promise<void>;
  /** True when this process can open the Messages database. */
  canReadMessages(): Promise<boolean>;
  /** Bring Messages to the front on its Settings window, where the iMessage addresses are. */
  openMessagesSettings(): Promise<{ ok: boolean; message: string }>;
  /** Quit and reopen Buddy: Screen Recording and Accessibility apply on the next launch. */
  relaunch(): void;
  // Recorder window only:
  onRecorderStart(cb: () => void): void;
  onRecorderStop(cb: (discard: boolean) => void): void;
  sendRecorderResult(result: RecordingResult): void;
  sendRecorderError(message: string): void;
  sendMicLevel(level: number): void;
  onTtsPlay(cb: (bytes: Uint8Array, mime: string) => void): void;
  onTtsStop(cb: () => void): void;
  sendTtsEnded(): void;
  onVadStart(cb: () => void): void;
  onVadStop(cb: () => void): void;
  sendVadSpeechStart(): void;
  sendVadMisfire(): void;
  sendVadResult(result: RecordingResult): void;
  // Mic level + always-on for panel and overlay:
  onMicLevel(cb: (level: number) => void): void;
  getAlwaysOn(): Promise<boolean>;
  onAlwaysOnChanged(cb: (on: boolean) => void): void;
  // Session streaming for the panel and caption bubble:
  onTranscript(cb: (text: string, attachments?: Attachment[]) => void): void;
  onMessageStart(cb: (spoken: boolean) => void): void;
  onResponseDelta(cb: (delta: string) => void): void;
  /** The reply as the model streams it (home window); captions follow the voice instead. */
  onStreamDelta(cb: (delta: string) => void): void;
  onResponseDone(cb: () => void): void;
  /** What Buddy is doing right now, for the shimmer pill; null = done. */
  onActivity(cb: (label: string | null) => void): void;
  onSessionError(cb: (message: string) => void): void;
  onSessionCancelled(cb: () => void): void;
  onSessionLinks(cb: (links: string[]) => void): void;
  /** A Bland phone call the current turn is placing, for the thread's call card. */
  onCallStatus(cb: (status: CallStatus) => void): void;
  /** run_command's live output, for the overlay's terminal panel. */
  onCommandOutput(cb: (event: CommandOutputEvent) => void): void;
  /** Open a link from a tool result in the default browser. */
  openExternal(url: string): Promise<boolean>;
  /** Open feedback mail in the default mail app. */
  openMailto(url: string): Promise<boolean>;
  /** A site's icon as a data URL for the sources list; null when there isn't one. */
  getFavicon(host: string): Promise<string | null>;
  /** An installed Mac app's icon as a data URL; null when it isn't installed. */
  getAppIcon(name: string): Promise<string | null>;
  /** A product photo as a data URL; null when the store would not serve it. */
  getProductPhoto(imageUrl: string, pageUrl: string): Promise<string | null>;
  // MCP servers (settings window) and tool confirmations (overlay + recorder):
  getMcpServers(): Promise<McpServerView[]>;
  saveMcpServer(draft: McpServerDraft): Promise<McpServerView[]>;
  removeMcpServer(id: string): Promise<McpServerView[]>;
  importMcpServers(json: string): Promise<McpImportResult>;
  setMcpToolPermission(
    serverId: string,
    toolName: string,
    permission: ToolPermission,
  ): Promise<McpServerView[]>;
  setAppSecret(name: 'composio' | 'shopify', value: string): Promise<SettingsView>;
  /** Save (draft) or remove (null) the payment card. Resolves to an error message, or null on success. */
  savePaymentCard(draft: PaymentCardDraft | null): Promise<string | null>;
  /** Null when the account's apps cannot be listed yet; [] when none are connected. */
  listAppConnections(): Promise<AppConnection[] | null>;
  connectApp(slug: string): Promise<{ ok: boolean; message: string }>;
  disconnectApp(slug: string): Promise<{ ok: boolean; message: string }>;
  onMcpServersChanged(cb: (views: McpServerView[]) => void): void;
  onMcpConfirm(cb: (card: ConfirmCard | null) => void): void;
  /** overlay only: push goal/steps edits to main (Enter uses the latest draft). */
  sendConfirmPlanDraft(draft: ConfirmPlanDraft): void;
  submitConfirmPlan(draft: ConfirmPlanDraft): void;
  cancelConfirm(): void;
  /** overlay only: the ask_user question card and its clicked/typed answer. */
  onAskQuestion(cb: (card: QuestionCard | null) => void): void;
  submitAskAnswer(answer: string): void;
  setOverlayMouse(mode: OverlayMouseMode): void;
  // Agent HUD (overlay only):
  onAgentPointer(cb: (pos: CursorMove) => void): void;
  onAgentDriving(cb: (hud: AgentDrivingHud) => void): void;
  // Agent action log (panel):
  getAgentLog(): Promise<AgentLogEntry[]>;
  saveAgentLog(): Promise<string | null>;
  onAgentLogAppend(cb: (entry: AgentLogEntry) => void): void;
  onAgentLogReset(cb: () => void): void;
  onSelectionShow(cb: (pos: SelectionShow) => void): void;
  onSelectionHide(cb: () => void): void;
  askAboutSelection(): void;
  learnDictionary(original: string, corrected: string): Promise<string[]>;
  // Conversations (home window):
  getChatIndex(): Promise<ChatIndex>;
  getConversation(id: string): Promise<ConversationView | null>;
  deleteConversation(id: string): Promise<ChatIndex>;
  /** Voice and typed asks continue this conversation; null = start fresh. */
  setActiveConversation(id: string | null): Promise<ChatIndex>;
  /** A typed ask; null conversationId starts a new conversation. */
  /** A typed ask, with any photos or PDFs to send along. */
  sendChatMessage(text: string, conversationId: string | null, attachments?: AttachmentDraft[]): void;
  /** Hold-to-talk: the same voice session the hotkey starts, held by the button instead. */
  startTalking(): void;
  stopTalking(): void;
  onChatChanged(cb: (index: ChatIndex) => void): void;
  /** Overlay only: the reply is on the focused home window; bubbles stand down. */
  onChatFocusChanged(cb: (focused: boolean) => void): void;
  /** The first-run tour is at this stop, or over (null). */
  onTourChanged(cb: (stop: TourStopId | null) => void): void;
  // The Type to Buddy box (quick-ask window + overlays):
  /** quick-ask window: the box just opened — reset, focus, and show this chip (null = none). */
  onQuickAskShow(cb: (highlight: string | null) => void): void;
  /** quick-ask window: a highlight chip (first and last few characters), or null when it goes. */
  onQuickAskHighlight(cb: (label: string | null) => void): void;
  /** quick-ask window: dictated speech streaming into the field. */
  onQuickAskTranscript(cb: (event: DictationTranscript) => void): void;
  /** quick-ask window: Enter — send the draft with any marks drawn meanwhile. */
  submitQuickAsk(text: string): void;
  /** quick-ask window: Escape — close without sending. */
  cancelQuickAsk(): void;
  /** overlay: the Type to Buddy box opened or closed; the dot stays out with it. */
  onQuickAskOpenChanged(cb: (open: boolean) => void): void;
  // Local brain (settings window):
  getOllamaStatus(): Promise<OllamaStatus>;
  pullOllamaModel(model: string): Promise<KeyTestResult>;
  installOllama(): Promise<KeyTestResult>;
  onOllamaPullProgress(cb: (progress: OllamaPullProgress) => void): void;
  // Local ear (settings window):
  getLocalWhisperReady(): Promise<boolean>;
  downloadLocalWhisper(): Promise<KeyTestResult>;
  onLocalWhisperProgress(cb: (percent: number) => void): void;
  // User marks (overlay + dev view):
  onMarksMode(cb: (mode: MarksMode) => void): void;
  sendMarkStrokeBegin(): void;
  sendMarkStroke(payload: MarkStrokePayload): void;
  onMarksSet(cb: (marks: CleanMark[]) => void): void;
  onMarksClear(cb: () => void): void;
  getLastMarksTurn(): Promise<MarksTurnDebug | null>;
  // Background jobs and Ideas (home window):
  listJobs(): Promise<JobsView>;
  saveJob(draft: JobDraft): Promise<JobsView>;
  deleteJob(id: string): Promise<JobsView>;
  runJobNow(id: string): Promise<JobsView>;
  setJobPaused(id: string, paused: boolean): Promise<JobsView>;
  resolveApproval(id: string, decision: 'once' | 'always' | 'deny'): Promise<JobsView>;
  onJobsChanged(cb: (view: JobsView) => void): void;
  listIdeas(): Promise<IdeasView>;
  /** Take an idea off the deck. `answer` is how it was met: a yes clears the way for that kind of moment, a no counts against it. */
  dismissIdea(id: string, answer?: 'yes' | 'no'): Promise<IdeasView>;
  /** Install a recurring idea as a job. One-shot ideas run through sendChatMessage instead. */
  installIdea(id: string): Promise<IdeasView>;
  refreshIdeas(): Promise<IdeasView>;
  onIdeasChanged(cb: (view: IdeasView) => void): void;
  /** Home window: a notification click asked for this conversation, or New Chat. */
  onHomeShow(cb: (target: HomeShowTarget) => void): void;
  /** Home window: the chat shell has painted. */
  homeReady(): void;
  /** Home window: it was hidden, and it is on screen again. */
  onHomeReveal(cb: () => void): void;
  /** Open the home window on a conversation (a notice, a job's reports), or New Chat. */
  openHome(target: HomeShowTarget): void;
  /** Settings window: a field that takes dictation gained or lost focus. */
  setDictationField(focused: boolean): void;
  /** Settings window: the field's hold-to-talk button, down or up. */
  holdDictation(down: boolean): void;
  /** Settings window: dictated speech for the focused field. */
  onDictation(cb: (event: DictationTranscript) => void): void;
  // Buddy's browser (chrome strip + home window):
  getBrowserStatus(): Promise<BrowserStatus>;
  onBrowserStatus(cb: (status: BrowserStatus) => void): void;
  onBrowserPreview(cb: (base64: string) => void): void;
  sendBrowserCommand(command: BrowserCommand): void;
  // Buddy's browser's sign-ins (Settings → Buddy's Browser, and the walk):
  listLoginSources(): Promise<LoginSource[]>;
  /** Copy one profile's cookies in. macOS asks once to let Buddy read that browser's key. */
  bringLogins(sourceId: string): Promise<{ ok: boolean; message: string }>;
  forgetLogins(): Promise<{ ok: boolean; message: string }>;
  /** Open Buddy's browser expanded on this URL: a site to sign in to, or an address typed in its bar. Refused while a task drives the page. */
  openInBrowser(url: string): Promise<{ ok: boolean; message: string }>;
  /** The SIGN_IN_SITES hosts Buddy's browser already holds a sign-in for. */
  listSignedInSites(): Promise<string[]>;
}