// Throwaway preview stub for scripts/preview-ui.mjs: fakes the `buddy` API so
// the settings and overlay renderers run without the real main process.
const { contextBridge } = require('electron');

const settings = {
  claudeModel: 'claude-sonnet-5',
  claudeFastModel: 'claude-haiku-4-5',
  ttsProvider: 'elevenlabs',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  hotkey: 'Control+Alt',
  agentHotkey: 'Control+Alt+Shift',
  showCaptionBubble: true,
  bubbleLocation: 'cursor',
  speechEnabled: true,
  alwaysOnIdleTimeoutMinutes: 10,
  mcpResultLimit: 12000,
  agentMaxActions: 50,
  agentMaxMinutes: 10,
  agentExcludedApps: ['1Password', 'Bitwarden', 'LastPass', 'Dashlane', 'KeePass', 'Keeper', 'NordPass'],
  agentModeEnabled: true,
  agentModel: '',
  aboutMe: 'First Name: Zach\nLast Name: Sweedler',
  agentConfirmPlans: true,
  agentConfirmActions: true,
  agentDefaultMode: 'watch',
  computerProvider: 'cua',
  dictionary: ['Sweedler', 'ElevenLabs'],
  skills: [
    { name: 'Y Combinator', instructions: 'Write like a YC founder update.' },
    { name: 'Write Like Farza', instructions: 'Casual, energetic, first person.' },
  ],
  selectionButtonEnabled: true,
  colorIdleDot: '#000000',
  colorSpeakingDot: '#209d55',
  colorBuddySpeakingDot: '#000000',
  colorLoadingDot: '#bfbfbf',
  colorDrivingFrame: '#ffffff',
  colorAnnotations: '#ff5a5f',
  colorErrorBubble: '#e5484d',
  documentReadLimit: 80000,
};

const view = () => ({
  settings,
  keys: { openrouter: true, elevenlabs: true, jev: false },
});

const servers = [
  {
    id: '1',
    name: 'Exa Search',
    transport: 'http',
    enabled: true,
    url: 'https://mcp.exa.ai/mcp',
    headers: {},
    command: '',
    args: [],
    env: {},
    status: 'connected',
    error: '',
    tools: [
      { name: 'web_search_exa', exposedName: 'exa__web_search_exa', description: 'Search the web', permission: 'allow' },
      { name: 'web_fetch_exa', exposedName: 'exa__web_fetch_exa', description: 'Fetch a page', permission: 'ask' },
      { name: 'web_research_exa', exposedName: 'exa__web_research_exa', description: 'Deep research', permission: 'deny' },
    ],
  },
];

const memories = [
  { id: '1', text: 'He likes pizza', createdAt: 0 },
  { id: '2', text: 'The towels are in the washing machine', createdAt: 0 },
];

// Callbacks the renderer registers, re-firable from the preview script.
const callbacks = {};
const on = (name) => (cb) => {
  callbacks[name] = cb;
};

contextBridge.exposeInMainWorld('buddy', {
  getState: async () => 'idle',
  getSettings: async () => view(),
  updateSettings: async (patch) => {
    Object.assign(settings, patch);
    return view();
  },
  setApiKey: async () => view(),
  clearApiKey: async () => view(),
  testApiKey: async () => ({ ok: true, message: 'Key works.' }),
  onSettingsChanged: on('settingsChanged'),
  getMcpServers: async () => servers,
  saveMcpServer: async () => servers,
  removeMcpServer: async () => servers,
  importMcpServers: async () => ({ added: 0, errors: [] }),
  setMcpToolPermission: async () => servers,
  onMcpServersChanged: on('mcpServersChanged'),
  getMemories: async () => memories,
  addMemory: async (text) => [...memories, { id: '3', text, createdAt: 0 }],
  removeMemory: async () => memories,
  onMemoriesChanged: on('memoriesChanged'),
  // Overlay surface:
  onStateChanged: on('stateChanged'),
  onCursorMoved: on('cursorMoved'),
  onCursorHidden: on('cursorHidden'),
  onAnnotationsDraw: on('annotationsDraw'),
  onAnnotationsClear: on('annotationsClear'),
  onDrawings: on('drawings'),
  onDrawingsReveal: on('drawingsReveal'),
  onMicLevel: on('micLevel'),
  onTranscript: on('transcript'),
  onMessageStart: on('messageStart'),
  onResponseDelta: on('responseDelta'),
  onResponseDone: on('responseDone'),
  onActivity: on('activity'),
  onSessionError: on('sessionError'),
  onSessionCancelled: on('sessionCancelled'),
  onSessionLinks: on('sessionLinks'),
  onMcpConfirm: on('mcpConfirm'),
  onSelectionShow: on('selectionShow'),
  onSelectionHide: on('selectionHide'),
  onAgentPointer: on('agentPointer'),
  onAgentDriving: on('agentDriving'),
  onAgentGhost: on('agentGhost'),
  setOverlayMouse: () => {},
  onChatFocusChanged: on('chatFocusChanged'),
  // Type to Buddy box:
  onQuickAskShow: on('quickAskShow'),
  onQuickAskHighlight: on('quickAskHighlight'),
  onQuickAskTranscript: on('quickAskTranscript'),
  onQuickAskOpenChanged: on('quickAskOpenChanged'),
  submitQuickAsk: () => {},
  cancelQuickAsk: () => {},
  sendConfirmPlanDraft: () => {},
  submitConfirmPlan: () => {},
  cancelConfirm: () => {},
  askAboutSelection: () => {},
  openExternal: async () => true,
  openMailto: async () => true,
  getFavicon: async () => null,
});

contextBridge.exposeInMainWorld('__fire', (name, payload) => {
  callbacks[name]?.(payload);
});
