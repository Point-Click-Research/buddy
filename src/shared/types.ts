// Shared domain types: settings, conversations, marks, agent tasks, and the
// payloads that travel over IPC. The channel names themselves are in ipc.ts.

import type { Meters, PlanId, UpgradePlan } from "./contracts";
import type { Attachment } from "./attachments";
import type { ProductBrowse } from "./product-browse";
import type { SuggestionTimeId } from "./suggestions";

// Working name — kept in one place so it's easy to rename later.
export const APP_NAME = "Buddy";

/** The app state machine's states. See src/main/state.ts for transitions. */
export type AppState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

/** Cursor position in overlay-local DIP coordinates (origin = display top-left). */
export interface CursorMove {
  x: number;
  y: number;
}

/**
 * A drawing command for an overlay window. All coordinates are overlay-local
 * DIP (already converted from screenshot pixels by the main process).
 */
export type Annotation =
  | { id: string; kind: "point"; x: number; y: number; label: string }
  | {
      id: string;
      kind: "circle";
      x: number;
      y: number;
      radius: number;
      label: string;
    }
  | {
      id: string;
      kind: "arrow";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      label: string;
    }
  | {
      id: string;
      kind: "highlight";
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
    };

/** Who speaks: ElevenLabs, or the Mac's own voice. Whether Buddy speaks at all is the separate speechEnabled switch. */
export type TtsProvider = "elevenlabs" | "system";

/** Bland curated voices the send-call API accepts by name. */
export const BLAND_VOICES = [
  "maya",
  "june",
  "mason",
  "nat",
  "josh",
  "florian",
  "derek",
  "paige",
] as const;

/**
 * Whether an MCP server is the Bland phone server. Shared so the prompt
 * (main) and Buddy's Phone settings page (renderer) agree on when phone calls
 * are available.
 */
export function isBlandServer(server: {
  enabled: boolean;
  name: string;
  url: string;
}): boolean {
  return (
    server.enabled &&
    (server.name.toLowerCase() === "bland" || /bland\.ai/i.test(server.url))
  );
}

/** What the user sees for an MCP server. Phone calls never name the vendor. */
export function mcpServerLabel(server: { name: string; url?: string }): string {
  if (
    server.name.toLowerCase() === "bland" ||
    (server.url && /bland\.ai/i.test(server.url))
  ) {
    return "Buddy's Phone";
  }
  return server.name.charAt(0).toUpperCase() + server.name.slice(1);
}

/**
 * A phone call Buddy is placing through Bland, for the thread's call card.
 * `dialing` while the send-call tool runs, then `started` (Bland's agent is
 * on the line) or `failed`. The card clears when the turn ends.
 */
export interface CallStatus {
  /** The number as passed to Bland; empty when the tool call didn't name one. */
  number: string;
  /** Whose number it is, when a contact lookup this session said. */
  name?: string;
  /** ended: the turn that placed it is over, so the call is too. */
  state: "dialing" | "started" | "failed" | "ended";
}

const CALL_STATE_LABELS: Record<CallStatus["state"], string> = {
  dialing: "Placing call…",
  started: "Call in progress",
  failed: "Call failed",
  ended: "Call ended",
};

/**
 * The two lines every call card (overlay pill, chat thread) shows: who is
 * being dialed — the contact when known, else the number — and how it's
 * going, with the number alongside when the name took the top line.
 */
export function callCardLines(call: CallStatus): {
  who: string;
  status: string;
} {
  const label = CALL_STATE_LABELS[call.state];
  return {
    who: call.name || call.number || "Unknown number",
    status: call.name && call.number ? `${label} · ${call.number}` : label,
  };
}

/** Default instructions injected when a Bland phone server is connected. Editable. */
export const DEFAULT_CALL_STYLE =
  "Have the phone agent identify itself as an AI assistant calling on the user's behalf. Never speak passwords, one-time codes, card numbers, or government IDs; hand those steps back. Stay on the approved goal and end the call when it is done. When the call ends, Buddy reports back how it went: who picked up, what was said or agreed, and any next step.";

/**
 * Bounds for the speaking-pace setting. The voices naturally speak around
 * `natural` WPM; playback is scaled by wpm/natural (pitch preserved), so the
 * same knob works for every provider.
 */
export const SPEECH_WPM = { min: 100, max: 250, natural: 175 } as const;

/** How many suggestions the morning run may propose. */
export const IDEAS_COUNT = { min: 1, max: 6, natural: 3 } as const;

/**
 * How an overlay wants the mouse handled. Overlays are click-through by
 * default; a part that needs clicks asks for 'click', and one that needs
 * typing asks for 'focus' — which takes keyboard focus from the user's app,
 * so only the plan card's textarea uses it.
 */
export type OverlayMouseMode = "through" | "click" | "focus";

// --- Built-in tools ------------------------------------------------------------

/** One built-in ability listed in Settings → Tools; disabling it removes its tools. */
export interface BuiltinTool {
  id: string;
  label: string;
  description: string;
  /** The registry tool names this entry switches on and off. */
  toolNames: string[];
}

/** The abilities that ship with Buddy and can be switched off, never deleted. */
export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    id: "run_command",
    label: "Terminal",
    description: "Run commands in your login shell.",
    toolNames: ["run_command"],
  },
  {
    id: "media",
    label: "Media & volume",
    description: "Pause, skip, and change volume.",
    toolNames: ["media_control"],
  },
  {
    id: "contacts",
    label: "Contacts",
    description: "Find contacts by name, number, or company.",
    toolNames: ["find_contact"],
  },
  {
    id: "files",
    label: "File search",
    description: "Spotlight search and reveal in Finder.",
    toolNames: ["search_files", "reveal_file"],
  },
  {
    id: "messages",
    label: "Messages",
    description: "Send iMessages. Each asks first.",
    toolNames: ["send_message"],
  },
  {
    id: "mail",
    label: "Mail",
    description: "Read mail and compose. Never sends alone.",
    toolNames: ["mail"],
  },
  {
    id: "notes",
    label: "Notes",
    description: "Create and search Notes.",
    toolNames: ["notes"],
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    description: "List and run Shortcuts.",
    toolNames: ["list_shortcuts", "run_shortcut"],
  },
  {
    id: "browser_tabs",
    label: "Browser tabs",
    description: "Manage tabs in your browser.",
    toolNames: ["browser_tabs"],
  },
  {
    id: "coding",
    label: "Coding",
    description: "Read, search, and edit in the workspace folder below.",
    toolNames: [
      "list_files",
      "read_file",
      "search_code",
      "edit_file",
      "write_file",
    ],
  },
];

/** When run_command asks for approval: every command, or only risky ones. */
type RunCommandApproval = "always" | "risky";

/** When the coding tools' file writes ask for approval: every change, only risky ones, or never. */
type CodingEditApproval = "always" | "risky" | "auto";

// --- MCP servers -------------------------------------------------------------

export type McpTransport = "http" | "stdio";
type McpServerStatus = "connected" | "connecting" | "error" | "disabled";
export type ToolPermission = "allow" | "ask" | "deny";

/** Shown instead of encrypted header/env values; sending it back keeps the stored value. */
export const MCP_SECRET_MASK = "••••••";

/** What the settings UI edits. Secret values may be MCP_SECRET_MASK. */
export interface McpServerDraft {
  /** Absent = create a new server. */
  id?: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** HTTP transport only. */
  url: string;
  headers: Record<string, string>;
  /** stdio transport only. */
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpToolView {
  name: string;
  /** The sanitized `<server>__<tool>` name the model sees. */
  exposedName: string;
  description: string;
  permission: ToolPermission;
}

/** One server as the settings UI sees it: masked config + live status. */
export interface McpServerView extends Omit<McpServerDraft, "id"> {
  id: string;
  status: McpServerStatus;
  error: string;
  tools: McpToolView[];
}

export interface McpImportResult {
  added: number;
  errors: string[];
}

/**
 * How an agent task drives the computer. Watch: the real cursor moves and
 * the user watches. Browser: the task runs inside Buddy's own browser
 * window, driven from within the page, and the user keeps working.
 */
export type AgentTaskMode = "watch" | "browser";

/** How much of Buddy's browser the user sees: nothing, a corner peek, or the whole window. */
export type BrowserViewState = "hidden" | "peek" | "expanded";

/** Buddy's browser as the chrome strip and the chat window show it. */
export interface BrowserStatus {
  state: BrowserViewState;
  /** A task is driving the browser right now. */
  active: boolean;
  /** A real page is loaded, so the window is worth reopening between tasks. */
  hasPage: boolean;
  title: string;
  url: string;
  /** What Buddy is doing ("Clicking Add to cart"); null between actions. */
  activity: string | null;
}

/** What the chrome strip (or the chat window) asks of Buddy's browser. `stop` ends the task. */
export type BrowserCommand = "expand" | "peek" | "hide" | "stop";

/**
 * Sites Buddy acts on most, for Settings → Buddy's Browser. Travel first: a ride or
 * a stay is what a moment offers. Then stores, then the social sites. Each
 * opens on a page that asks a signed-out visitor to sign in.
 */
export const SIGN_IN_SITES = [
  { host: "uber.com", label: "Uber", url: "https://riders.uber.com/trips" },
  { host: "lyft.com", label: "Lyft", url: "https://ride.lyft.com/" },
  {
    host: "airbnb.com",
    label: "Airbnb",
    url: "https://www.airbnb.com/account-settings",
  },
  {
    host: "expedia.com",
    label: "Expedia",
    url: "https://www.expedia.com/user/account",
  },
  {
    host: "booking.com",
    label: "Booking.com",
    url: "https://account.booking.com/",
  },
  {
    host: "opentable.com",
    label: "OpenTable",
    url: "https://www.opentable.com/my/profile",
  },
  { host: "resy.com", label: "Resy", url: "https://resy.com/account" },
  {
    host: "amazon.com",
    label: "Amazon",
    url: "https://www.amazon.com/gp/css/homepage.html",
  },
  {
    host: "target.com",
    label: "Target",
    url: "https://www.target.com/account",
  },
  {
    host: "walmart.com",
    label: "Walmart",
    url: "https://www.walmart.com/account",
  },
  {
    host: "costco.com",
    label: "Costco",
    url: "https://www.costco.com/myaccount",
  },
  {
    host: "instacart.com",
    label: "Instacart",
    url: "https://www.instacart.com/store/account",
  },
  {
    host: "linkedin.com",
    label: "LinkedIn",
    url: "https://www.linkedin.com/feed/",
  },
  { host: "facebook.com", label: "Facebook", url: "https://www.facebook.com/settings" },
  {
    host: "instagram.com",
    label: "Instagram",
    url: "https://www.instagram.com/accounts/edit/",
  },
] as const;

/** A profile in the user's own browser whose sign-ins Buddy's browser can bring over. */
export interface LoginSource {
  id: string;
  /** "Chrome", or "Chrome (Work)" when the browser has more than one profile. */
  label: string;
  /** The Mac app, for its icon ("Google Chrome"). */
  app: string;
}

/** Editable plan text on the approval card (plain language; first line = goal). */
export interface ConfirmPlanDraft {
  description: string;
  /** The user's run-style choice; only sent when the card offered it. */
  mode?: AgentTaskMode;
}

/** The overlay confirmation card ("allow this tool call?"); null hides it. */
export interface ConfirmCard {
  title: string;
  detail: string;
  /** A plain-language line under the detail (e.g. what a command does). */
  note?: string;
  /** The action is destructive (e.g. a deletion): the card wears red. */
  danger?: boolean;
  /** When set, the card is an editable plan (no title); otherwise MCP/tool confirm. */
  plan?: ConfirmPlanDraft & {
    /** Show the Watch / Buddy's-browser choice. */
    offerBrowser?: boolean;
    /** The run style is fixed (a purchase): this line shows instead of the choice. */
    lockedNote?: string;
  };
  /** Editable text under the detail (e.g. a message before it sends). */
  edit?: {
    text: string;
    /** The submit button's label ("Send"). */
    action: string;
  };
}

/** The "Buddy is driving" HUD state for one display. */
export interface AgentDrivingHud {
  active: boolean;
}

/** Which implementation drives the computer in agent mode. */
type ComputerProviderId = "cua" | "basic";

/** Where the caption bubble (and activity pill) sit on the display. */
export type BubbleLocation =
  | "cursor"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Light or dark chrome for every Buddy window; 'auto' follows macOS. */
export type Appearance = "auto" | "light" | "dark";
export const APPEARANCES: readonly Appearance[] = ["auto", "light", "dark"];

/** What summons the Type to Buddy box at the cursor; 'off' = the feature is off. */
export type QuickAskTrigger = "off" | "shake" | "doubleTap" | "hotkey";

export const QUICK_ASK_TRIGGERS: readonly QuickAskTrigger[] = [
  "off",
  "shake",
  "doubleTap",
  "hotkey",
];

/** A named skill the user can ask Buddy to apply — a writing style, a routine. */
export interface WritingSkill {
  name: string;
  instructions: string;
  /** Ships with Buddy: editable and disableable, never deletable. */
  builtIn?: boolean;
  /** Hidden from the model entirely until re-enabled. */
  disabled?: boolean;
  /** Lowercase bundle ids: loads by itself when one of these apps is frontmost. */
  apps?: string[];
  /** Hostnames (subdomains count): loads by itself when open in any browser. */
  sites?: string[];
}

/** How the voice says one written form out loud ("°F" → "degrees Fahrenheit"). */
export interface Pronunciation {
  text: string;
  spoken: string;
}

/** One word Buddy should hear correctly, with what it tends to mishear. */
export interface VocabularyEntry {
  /** The correct word ("Sweedler"); biases speech-to-text toward it. */
  word: string;
  /** What Buddy hears instead ("Sweetler"); fixed in transcripts. Empty = bias only. */
  heard: string;
}

// --- Conversations -----------------------------------------------------------

/**
 * The run behind a "Started an agent task" line. `thought` is Buddy's inner
 * reasoning, start to finish; `said` is what Buddy told the user when the
 * task ended. `pending` is set while the task is still running.
 */
interface AgentTaskTrace {
  thought: string;
  said?: string;
  pending?: boolean;
}

/** One message of a conversation's display transcript (not the model context). */
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Epoch ms. */
  at: number;
  /** Sources the reply's tool results surfaced (web searches, read pages). */
  links?: string[];
  /** Set on the line that hands off to an agent task. */
  agent?: AgentTaskTrace;
  /** Background work wrote this line: which job, or which suggestion. */
  source?: MessageSource;
  /** Files sent with the message, as chips; the bytes went to the model and are not kept. */
  attachments?: Attachment[];
}

/** Where a background message came from, for the tag over it in the thread. */
export interface MessageSource {
  kind: "job" | "suggestion";
  name: string;
}

/** One conversation as the home window's sidebar lists it. */
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  /** The log background work reports into: read, never written to. */
  background?: boolean;
  /** Texts from the user's phone: read here, answered there. */
  texts?: boolean;
  /** Something landed here since it was last opened. */
  unread?: boolean;
}

/** One conversation opened for reading. */
export interface ConversationView {
  id: string;
  title: string;
  messages: ChatMessage[];
}

/**
 * The home window's whole world: every conversation, and which one the next
 * ask lands in (null = the next ask starts a fresh conversation).
 */
export interface ChatIndex {
  conversations: ConversationSummary[];
  activeId: string | null;
  /**
   * The conversation an exchange actually landed in this run. Reopening the
   * window focuses this one; a chat merely viewed (which also becomes
   * active, so voice asks follow the eyes) opens on New Chat instead.
   */
  engagedId: string | null;
}

/** Overlay-local DIP position for the Ask Buddy selection button. */
export interface SelectionShow {
  x: number;
  y: number;
}

// --- User marks (point and talk) ----------------------------------------------

/** What a raw stroke was classified as. See src/main/marks/classify.ts. */
export type MarkKind = "tap" | "region" | "underline" | "path";

/** One sampled point of a user stroke: overlay-local DIP plus epoch ms. */
interface MarkStrokePoint {
  x: number;
  y: number;
  t: number;
}

/**
 * A finished stroke, sent from an overlay to main on mouse-up. Points are in
 * GLOBAL screen DIP (event.screenX/Y), not window-local coordinates, so a
 * stroke survives macOS moving the overlay window mid-drag; main converts
 * them to display space against the display's bounds.
 */
export interface MarkStrokePayload {
  points: MarkStrokePoint[];
}

/** Whether overlays should capture the mouse for marking, and the ink color. */
export interface MarksMode {
  active: boolean;
  color: string;
}

/**
 * A finished mark, as the overlay keeps showing it: the ink exactly as it
 * was drawn, or a dot for a tap. The classified outline is for the model's
 * screenshot, not the screen, and the mark numbers are only drawn there too.
 * All coordinates are overlay-local DIP.
 */
export interface CleanMark {
  number: number;
  kind: MarkKind;
  color: string;
  /** The stroke as drawn; a tap's first point is where the dot goes. */
  points: Array<{ x: number; y: number }>;
  /** The mark's box, used for close-up crops. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** The last turn's marks payload, for the dev "Marks" view. */
export interface MarksTurnDebug {
  /** Epoch ms when the turn ran. */
  at: number;
  /** The transcript with ⟦mark N⟧ tokens inserted. */
  transcript: string;
  /** Annotated screenshots (and any release shots that differed). */
  images: Array<{ label: string; base64: string }>;
  /** Close-up crops, at most four. */
  crops: Array<{ label: string; base64: string }>;
  /** The per-mark text blocks exactly as the model received them. */
  context: string;
}

/** Name and US address Buddy fills into checkout forms. Not a card. */
export interface BuyerProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  province: string;
  postalCode: string;
}

/**
 * One person the user shops for — themselves by default, plus anyone else.
 * Each category is a table of short entries, one remembered fact per row,
 * the same shape as the master memory table. The model reads them verbatim,
 * so only the checkout addresses need rigid fields.
 */
export interface ShopperProfile {
  /** How the user refers to them: "Me", "Sanna (girlfriend)", "my brother". */
  name: string;
  /** Sizes, colors, aesthetics, brands, links to loved products. */
  products: string[];
  /** Airlines, seat/class, hotel style, budget habits. */
  travel: string[];
  /** Cuisines, dietary limits, vibe, price range. */
  dining: string[];
  /** Form-filling facts for this person: shipping address, contact details. */
  formFacts: string[];
  /** Name, gender, age, anything cross-cutting. */
  general: string[];
}

/** The profile categories, in display order — one source for UI, prompt, and sanitizing. */
export const SHOPPER_CATEGORIES = [
  { key: "products", label: "Products" },
  { key: "travel", label: "Travel" },
  { key: "dining", label: "Dining" },
  { key: "formFacts", label: "Form facts" },
  { key: "general", label: "General" },
] as const satisfies ReadonlyArray<{
  key: keyof ShopperProfile & string;
  label: string;
}>;

export type ShopperCategory = (typeof SHOPPER_CATEGORIES)[number]["key"];

/** A profile with no entries in any category is an empty row, not a memory. */
export function shopperHasEntries(shopper: ShopperProfile): boolean {
  return SHOPPER_CATEGORIES.some(({ key }) => shopper[key].length > 0);
}

/**
 * "me", "myself", "the user": the first profile, whatever it is named. The
 * model routes the user's own facts with these instead of a real name — the
 * profile may be called "Me" while its rows know the user as Zach, and a
 * real-name lookup would split them into a second profile.
 */
export function isSelfReference(name: string): boolean {
  const needle = name.trim().toLowerCase();
  return [
    "me",
    "myself",
    "i",
    "self",
    "user",
    "the user",
    "you",
    "owner",
    "the owner",
  ].includes(needle);
}

/**
 * Find a profile by how the user (or the model) refers to them: an exact
 * name, or a whole word of it — "Sanna" finds "Sanna (girlfriend)". Whole
 * words only, so "Al" never matches inside "Sally". -1 when nobody matches.
 */
export function findShopper(shoppers: ShopperProfile[], name: string): number {
  const needle = name.trim().toLowerCase();
  if (!needle) return -1;
  const wanted = tokens(needle)[0];
  return shoppers.findIndex(
    (shopper) =>
      shopper.name.trim().toLowerCase() === needle ||
      (wanted !== undefined && tokens(shopper.name).includes(wanted)),
  );
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * A Composio toolkit this Mac has an account for. `active` works now;
 * `expired` (token expired, revoked, or failed) needs a reconnect.
 */
export interface AppConnection {
  slug: string;
  status: "active" | "expired";
}

/** Secrets that are not brain or voice providers. Status only; values stay in the keychain. */
interface AppKeyStatus {
  composio: boolean;
  shopify: boolean;
  /** '' when no card is saved; otherwise a display label like "Visa •••• 4242". Never the digits. */
  card: string;
}

/** The card form on Checkout Forms. Parsed and validated in main; stored in the keychain. */
export interface PaymentCardDraft {
  number: string;
  /** MM/YY or MM/YYYY. */
  expiry: string;
  cvc: string;
  /** Name on card. */
  name: string;
}

/** All non-secret settings. API keys are stored separately, encrypted. */
export interface Settings {
  /** The first-run walk (name, permissions, hotkey, story, apps, texts, drawing) has been finished or skipped. */
  onboardingDone: boolean;
  /** The walk's step to come back to after a quit mid-walk; '' = the start. Kept per account (account/local.ts). */
  onboardingStep: string;
  /** The story step's draft, so a quit mid-sentence comes back to the same words. */
  onboardingStory: string;
  /** The story was remembered, so Next stays available after a quit on that step. */
  onboardingStorySaved: boolean;
  /** Who answers: the cloud provider the models below belong to, or 'ollama' for local-only. */
  brainProvider: BrainProvider;
  /** The thinking model: complex questions, drawing, and agent tasks. */
  brainModel: string;
  /**
   * How hard the thinking model thinks. `auto` is low for spoken answers
   * and medium for walkthroughs.
   */
  brainEffort: BrainEffort;
  /**
   * The model quick questions go to. A router picks between this and
   * brainModel on every turn; empty means always use brainModel.
   */
  brainFastModel: string;
  /** Where Ollama listens for the free local brain. */
  ollamaUrl: string;
  /**
   * Open-weight model guide turns fall back to when the cloud key is
   * missing or stops working. Empty = no local fallback.
   */
  ollamaModel: string;
  /**
   * Nothing leaves this Mac: ears use the local Whisper server, the voice is
   * the built-in macOS one, and the brain is the local Ollama model. Cloud
   * providers are never called (and agent tasks, which need one, sit out).
   */
  airplaneMode: boolean;
  /**
   * Buddy's eyes: a screenshot of every display goes with each question.
   * Off = no captures at all — faster answers (dramatically so on the local
   * brain), nothing on screen is shared, and Buddy's pointing switches off.
   * The user can still draw marks; the reply says they can't be seen.
   */
  screenAwareness: boolean;
  ttsProvider: TtsProvider;
  elevenLabsVoiceId: string;
  /** macOS voice name for the free built-in voice; empty = the system default. */
  systemVoice: string;
  /**
   * Last live failure for a saved key (quota, refused). Shown under that
   * provider until the key is replaced or a Test succeeds.
   */
  keyWarnings: Partial<Record<KeyProvider, string>>;
  /** Hold-to-talk chord, e.g. "Control+Alt" or "Control+Alt+space". */
  hotkey: string;
  /** "Do this" hold chord that proposes an agent task, e.g. "Control+Alt+Shift". */
  agentHotkey: string;
  /** Chord that toggles always-on mode (must include an ordinary key); '' = none. */
  alwaysOnHotkey: string;
  /** What opens the Type to Buddy box at the cursor. */
  quickAskTrigger: QuickAskTrigger;
  /** Chord for the 'hotkey' trigger (must include an ordinary key); '' = none set. */
  quickAskHotkey: string;
  showCaptionBubble: boolean;
  /** Where the caption bubble sits: trailing the cursor, or parked in a corner. */
  bubbleLocation: BubbleLocation;
  appearance: Appearance;
  /**
   * Keep the buddy dot trailing the cursor at all times, instead of only
   * while Buddy is listening, working, or speaking.
   */
  dotAlwaysVisible: boolean;
  speechEnabled: boolean;
  /** Short sound cues: mic opens, work starts, response done, errors, cards. */
  sfxEnabled: boolean;
  /** Target speaking pace in words per minute (see SPEECH_WPM). */
  speechWpm: number;
  alwaysOnIdleTimeoutMinutes: number;
  /** Max characters of an MCP tool result passed to the model. */
  mcpResultLimit: number;
  /** Built-in tools (BUILTIN_TOOLS ids) the user switched off. */
  disabledBuiltinTools: string[];
  /** Whether run_command's approval card shows for every command or only risky ones. */
  runCommandApproval: RunCommandApproval;
  /** The one folder the coding tools may work in; empty means they don't exist. */
  codingWorkspaceRoot: string;
  /** Detect the workspace from the frontmost coding window; the fixed folder is the fallback. */
  codingWorkspaceAuto: boolean;
  /** Whether edit_file / write_file wait on a confirmation card. */
  codingEditApproval: CodingEditApproval;
  /** After a change, open the editor's own diff view (cursor/code/zed --diff). */
  codingShowDiffs: boolean;
  /** Agent safety limits (Milestone 3+). */
  agentMaxActions: number;
  agentMaxMinutes: number;
  /** The agent pauses when the frontmost app/window matches any of these. */
  agentExcludedApps: string[];
  /** Master switch: the agent may only drive when this is on. Off by default. */
  agentModeEnabled: boolean;
  /** Optional model override for agent tasks; empty = the thinking model above. */
  agentModel: string;
  /** How hard the agent model thinks. `auto` is medium. */
  agentEffort: BrainEffort;
  /** Show the plan card before an agent task starts. */
  agentConfirmPlans: boolean;
  /** Show a card before consequential actions (submit, send, delete, …). */
  agentConfirmActions: boolean;
  /** After a clean agent run, offer to save the distilled recipe as a skill. */
  distillSaveCards: boolean;
  /**
   * Low-vision preset: bigger drawings and captions, always-describe the
   * screen, prefer spotlight. Does not change how Buddy hears you.
   */
  visionAssist: boolean;
  /**
   * How the phone agent should talk (disclosure, secrets, scope). Injected
   * when a Bland MCP server is connected. Empty = no extra instructions.
   */
  callStyle: string;
  /** Bland send-call `voice` — a curated preset name or a clone UUID. */
  blandVoice: string;
  /**
   * Which provider drives the computer. Cua is the default and falls back to
   * basic when it can't run the task at all (a non-primary display, or a
   * platform without its native package).
   */
  computerProvider: ComputerProviderId;
  /** Words to hear correctly: recognition bias, plus transcript fixes. */
  vocabulary: VocabularyEntry[];
  /** Written → spoken replacements applied to speech, never to the caption. */
  pronunciations: Pronunciation[];
  /** Named writing-style prompts for drafts. */
  skills: WritingSkill[];
  /** Show an Ask Buddy button above selected text. */
  selectionButtonEnabled: boolean;
  /** Dot color at rest — shown when the dot always follows the cursor (hex, or 'disco'). */
  colorIdleDot: string;
  /** Dot color while you talk — the listening / mic-open state (hex, or 'disco'). */
  colorSpeakingDot: string;
  /** Dot color while Buddy talks — the speaking / TTS state (hex, or 'disco'). */
  colorBuddySpeakingDot: string;
  /** Dot color while transcribing, thinking, or using tools (hex, or 'disco'). */
  colorLoadingDot: string;
  /** The agent HUD while Buddy drives: the screen frame (hex, or 'disco'). */
  colorDrivingFrame: string;
  /**
   * Accent for what Buddy points at: annotation shapes and any drawing that
   * doesn't name a palette colour. The named colours (red, yellow, …) are
   * fixed — the model picks those by name for meaning. Hex, or 'disco'.
   */
  colorAnnotations: string;
  /** Error bubble and error-state dot color (hex, or 'disco'). */
  colorErrorBubble: string;
  /** The user's own marks drawn while talking (hex, or 'disco'); distinct from colorAnnotations. */
  colorUserMarks: string;
  /** Draw to point while talking: hold the chord and drag to mark the screen. */
  marksEnabled: boolean;
  /** Max characters of a read document or transcript passed to the model. */
  documentReadLimit: number;
  /** Shipping details Buddy fills into checkout forms (get_about_me). */
  buddyShipping: BuyerProfile;
  /** Billing address for those checkouts. All-empty = same as shipping. */
  buddyBilling: BuyerProfile;
  /** Who the user shops for, with per-category remembered preferences (Settings → Memory). */
  shoppers: ShopperProfile[];
  /**
   * Registrable domains fill_payment may fill card details on without the
   * merchant being named in the plan or noted from an opened tab. Grows
   * after each successful fill; editable under Checkout Forms.
   */
  trustedMerchants: string[];
  /** The browser whose sign-ins Buddy's browser last brought over ("Chrome"); '' when none (Settings → Buddy's Browser). */
  browserLoginsFrom: string;
  /** Stable Composio user id for this Mac. Empty until the first connect. */
  composioUserId: string;
  /** Find Products: open one product page per turn, or every pick at once. */
  productBrowse: ProductBrowse;
  /**
   * The Suggestions run. It reads recent chats, connected apps, inbox
   * headers (subjects and senders only), and open browser tabs.
   */
  ideasEnabled: boolean;
  /** When the batch runs (see SUGGESTION_TIMES). */
  ideasTime: SuggestionTimeId;
  /** At most this many suggestions per run (see IDEAS_COUNT). */
  ideasCount: number;
  /** The first suggestion of a batch is texted (with Text Buddy on) and said from the dot, in the caption bubble. */
  ideasReach: boolean;
  /**
   * Safe suggestions run the moment they land instead of waiting for Do it:
   * opening pages, drafting. A purchase, a booking, a call, a send, or a
   * recurring job still waits on the deck, and any write inside a run still asks.
   */
  ideasAutoRun: boolean;
  /** The iMessage bridge: text Buddy from the phone; job reports and approvals text back. */
  textBridgeEnabled: boolean;
  /** The user's own phone number or iMessage email: the only sender the bridge answers. */
  textBridgeHandle: string;
  /** Texted asks that send, buy, or change something wait for a texted YES; off, they just run. */
  textBridgeConfirm: boolean;
}

/** One step in the agent's action log (shown live in the panel). */
export interface AgentLogEntry {
  index: number;
  /** Epoch ms. */
  timestamp: number;
  action: string;
  /** Compact JSON of the action's arguments, clipped. */
  args: string;
  /** The model's short reasoning text before this action, if any. */
  reasoning: string;
  /**
   * What the action returned, clipped: the element tree, an error, a note.
   * Without it a saved log shows what Buddy tried but not what it learned.
   */
  result: string;
  /** Small JPEG data URL of the post-action screen; '' when none. */
  thumbnail: string;
}

/** The keys a user may bring: OpenRouter for every cloud brain, ElevenLabs for the voice, TypeSafe for Jev. */
export type KeyProvider = "openrouter" | "elevenlabs" | "jev";

/** Where the brain runs: every cloud model through OpenRouter, or the local Ollama model by choice. */
export type BrainProvider = "openrouter" | "ollama";

/**
 * How hard a cloud model thinks. `auto` picks a level from the kind of turn.
 * The rest go out as OpenRouter's reasoning effort, which it maps onto each
 * model's own parameter.
 */
export type BrainEffort = "auto" | "low" | "medium" | "high" | "xhigh" | "max";

/** A concrete effort, after Auto-detect has chosen. */
export type ModelEffort = Exclude<BrainEffort, "auto">;

/** Effort menu, in the order it appears under a model. */
export const BRAIN_EFFORTS: ReadonlyArray<{
  value: BrainEffort;
  label: string;
}> = [
  { value: "auto", label: "Auto-detect" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max" },
];

/** Label and starter models per brain provider, for the UI and defaults. Ollama's models live in ollamaModel instead. */
export const BRAIN_PROVIDERS: Record<
  BrainProvider,
  { label: string; model: string; fastModel: string }
> = {
  openrouter: {
    label: "OpenRouter",
    model: "anthropic/claude-sonnet-5",
    fastModel: "anthropic/claude-haiku-4.5",
  },
  ollama: { label: "Local (Ollama)", model: "", fastModel: "" },
};

/** Whether each API key is set. Renderers never see key contents. */
export type KeyStatus = Record<KeyProvider, boolean>;

/** Where the app's update stands, for the Account page. */
export interface UpdateStatus {
  state: "idle" | "checking" | "downloading" | "ready" | "error";
  /** The running version. */
  version: string;
  /** The version found, once one is downloading or ready. */
  available?: string;
  /** Download progress, 0..100. */
  percent?: number;
  /** Why a check failed, or a note ("Updates apply to installed builds."). */
  message?: string;
}

/** The Buddy account as the Account page sees it. Tokens never leave main. */
export interface AccountView {
  /** This build knows a Buddy API and Supabase project; otherwise the page explains that. */
  configured: boolean;
  signedIn: boolean;
  /** How they signed in: the Google email. '' when signed out. */
  identity: string;
  /** Set on the Account page, else taken from Google at sign-in; '' when unknown. */
  firstName: string;
  lastName: string;
  plan: PlanId | null;
  /** Today's talk turns and agent tasks against the plan's limits; null when unknown. */
  meters: Meters | null;
  /** The period's model use against the plan's pool, in cents; shown on the paid plans. Null when unknown. */
  usage: { spentCents: number; budgetCents: number } | null;
  /** Extra usage past the pool is on; null when this plan or deployment has no such switch. */
  onDemand: boolean | null;
  /** ISO time the pool's period resets. */
  periodEnd: string | null;
  /** The API has Stripe set up, so Upgrade and Manage billing work. */
  billing: boolean;
  /** Plans Stripe can sell here, so Upgrade offers only those. */
  upgrades: UpgradePlan[];
  /** Providers Buddy can serve on this plan, so the desktop need not ask for a key. */
  managed: string[];
  /** Model id prefixes this plan can run. Empty when signed out or not yet known. */
  models: string[];
  /** The code this account hands out, and how many people have joined with it. */
  referral: { code: string; uses: number } | null;
}

/** Everything the settings UI needs to render. */
export interface SettingsView {
  settings: Settings;
  keys: KeyStatus;
  appKeys: AppKeyStatus;
}

export interface KeyTestResult {
  ok: boolean;
  message: string;
}

/** One model a provider offers, for the settings dropdown. */
export interface ProviderModel {
  id: string;
  label: string;
}

/** Which model list to fetch: chat, speech-to-text, or speech. */
export interface ModelListResult {
  models: ProviderModel[];
  /** Empty when the list loaded. */
  error: string;
}

/** Mirrors Electron's media access statuses; accessibility maps to granted/denied. */
type PermissionState =
  | "granted"
  | "denied"
  | "restricted"
  | "not-determined"
  | "unknown";

/** Required for Buddy to work at all; these gate the first-run banner. */
export type PermissionName = "microphone" | "screen" | "accessibility";

export type PermissionsStatus = Record<PermissionName, PermissionState>;

/**
 * What Grant can open: the required permissions, plus panes with no
 * programmatic prompt (Automation, and Full Disk Access for the text bridge).
 * Full Disk Access is confirmed by opening the Messages database.
 */
export type PermissionPane = PermissionName | "automation" | "fullDisk";

/**
 * Dictation streaming into a field (Type to Buddy, a job's instructions):
 * partials replace one another as the user speaks; the final replaces them
 * all ('' = discarded).
 */
export interface DictationTranscript {
  kind: "partial" | "final";
  text: string;
}

/** An ask_user question for the overlay card: clickable options, or type, or speak. */
export interface QuestionCard {
  question: string;
  /** Up to five short choices shown as buttons; empty means free-form only. */
  options: string[];
}

/** One frame of run_command's live terminal feed (see commandOutput). */
export type CommandOutputEvent =
  | { kind: "start"; command: string }
  | { kind: "chunk"; text: string }
  | { kind: "exit"; note: string };

/** What a notification click (or main) asks the home window to show. */
/** A conversation to open, or none for New Chat (where suggestions sit). */
export interface HomeShowTarget {
  conversationId?: string;
}

/** Whether the local Ollama server is reachable, and what it has installed. */
export interface OllamaStatus {
  running: boolean;
  models: string[];
}

/** One progress tick of an ollama:pull download. */
export interface OllamaPullProgress {
  model: string;
  /** 0..100; downloads without a known size report 0 until they finish. */
  percent: number;
}

/** Audio bytes captured by the recorder window. */
export interface RecordingResult {
  bytes: Uint8Array;
  mimeType: string;
  durationMs: number;
  /** The same audio as raw PCM16 mono 16 kHz, for the local Whisper ear. */
  pcm16: Uint8Array;
}
