// What every setting is until the user changes it. New settings added in an
// update get their value from here, so a stored settings object is always
// merged over these.

import { DISCO_COLOR } from '../../shared/color';
import {
  BRAIN_PROVIDERS,
  DEFAULT_CALL_STYLE,
  IDEAS_COUNT,
  SPEECH_WPM,
  type BuyerProfile,
  type Settings,
  type ShopperProfile,
} from '../../shared/types';
import { DEFAULT_VOICE_ID } from '../../shared/voices';
import { APP_SKILLS } from '../ai/app-notes';

export const EMPTY_BUYER: BuyerProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address1: '',
  city: '',
  province: '',
  postalCode: '',
};

/** A shopper profile with nothing remembered yet. */
export function emptyShopper(name: string): ShopperProfile {
  return { name, products: [], travel: [], dining: [], formFacts: [], general: [] };
}

export const DEFAULT_SETTINGS: Settings = {
  onboardingDone: false,
  onboardingStep: '',
  onboardingStory: '',
  onboardingStorySaved: false,
  brainProvider: 'openrouter',
  brainModel: BRAIN_PROVIDERS.openrouter.model,
  brainEffort: 'auto',
  brainFastModel: BRAIN_PROVIDERS.openrouter.fastModel,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: '',
  airplaneMode: false,
  screenAwareness: true,
  ttsProvider: 'elevenlabs',
  elevenLabsVoiceId: DEFAULT_VOICE_ID,
  systemVoice: '',
  keyWarnings: {},
  hotkey: 'Control+Alt',
  agentHotkey: 'Control+Alt+Shift',
  alwaysOnHotkey: 'Control+Alt+a',
  quickAskTrigger: 'off',
  quickAskHotkey: '',
  showCaptionBubble: true,
  bubbleLocation: 'cursor',
  appearance: 'auto',
  dotAlwaysVisible: true,
  speechEnabled: true,
  sfxEnabled: true,
  speechWpm: SPEECH_WPM.natural,
  alwaysOnIdleTimeoutMinutes: 10,
  mcpResultLimit: 12_000,
  disabledBuiltinTools: [],
  runCommandApproval: 'always',
  codingWorkspaceRoot: '',
  codingWorkspaceAuto: false,
  codingEditApproval: 'always',
  codingShowDiffs: true,
  agentMaxActions: 50,
  agentMaxMinutes: 10,
  // Apps where the agent must never act: password managers and finance apps.
  agentExcludedApps: [
    '1Password',
    'Bitwarden',
    'LastPass',
    'Dashlane',
    'KeePass',
    'Keeper',
    'NordPass',
    'Proton Pass',
    'Keychain Access',
    'PayPal',
    'Venmo',
    'Cash App',
    'Coinbase',
    'Chase',
    'Bank of America',
    'Wells Fargo',
    'Fidelity',
    'Vanguard',
    'Charles Schwab',
  ],
  agentModeEnabled: true,
  agentModel: '',
  agentEffort: 'auto',
  agentConfirmPlans: true,
  agentConfirmActions: true,
  distillSaveCards: true,
  visionAssist: false,
  callStyle: DEFAULT_CALL_STYLE,
  blandVoice: 'maya',
  computerProvider: 'cua',
  vocabulary: [],
  // Starters showing the shape; the Voice settings page edits these.
  pronunciations: [
    { text: '°F', spoken: 'degrees Fahrenheit' },
    { text: '°C', spoken: 'degrees Celsius' },
    { text: 'mph', spoken: 'miles per hour' },
  ],
  // Skills that ship with Buddy: editable and disableable in Settings,
  // never deletable. The writing starters layer on the prompt's "draft in
  // the user's voice" rule and double as documentation of the format; the
  // app skills (spread in below) carry apps/sites keys and load themselves
  // when their app or site is frontmost.
  skills: [
    {
      name: 'Professional Email',
      builtIn: true,
      instructions:
        'A workplace email. Get to the point in the first sentence, no "I hope this finds you well". Short paragraphs, one topic each. Plain words over formal ones. If something is being asked for, ask it clearly and once. Close simply ("Best," or "Thanks,") with the user\'s first name.',
    },
    {
      name: 'Casual Message',
      builtIn: true,
      instructions:
        "A text or chat message. Write like the user talks: short, warm, contractions, no greeting or sign-off. One or two sentences unless they asked for more. Match the energy of the conversation on screen, don't be more formal than the other person.",
    },
    {
      name: 'Meeting Follow-up',
      builtIn: true,
      instructions:
        'A follow-up after a meeting or call. Open with one line of thanks or context, then what was decided, then who does what by when, as a short list if there are several. End with the single next step. No recap of the whole discussion.',
    },
    {
      name: 'File Organizer',
      builtIn: true,
      instructions:
        "Cleaning up a folder (Downloads, Desktop, or wherever they point). Look before touching: list it newest-first (ls -lt), size the big items (du -sh * | sort -rh | head), count the types (find . -maxdepth 1 -type f | sed 's/.*\\.//' | sort | uniq -c | sort -rn). A quick look or a couple of moves happens now with run_command; a full reorganization is a proposed task whose steps are the commands to run, not windows to drive. Group into a few flat folders named for what things are (Documents, Images, Installers, Archives, Screenshots), never a deep tree. Move, never delete: mkdir -p then mv; obvious junk goes to the Trash with mv into ~/.Trash/, and duplicates (same size, same md5 -q hash) are named to the user before anything moves. Leave dotfiles and anything that looks like an active project alone; when it's unclear where something belongs, ask instead of guessing. Finish with one spoken sentence on what moved where.",
    },
    {
      name: 'Shopping',
      builtIn: true,
      instructions:
        'Finding something to buy, anywhere or on a named store: "find me…", "look for…", "I need a new…", "find me something funny on Amazon". Check the shopper profiles before searching: sizes and fit come from whoever the shopping is for (the user unless they name someone) and their colors, brands, and aesthetics shape the picks. For clothing, shoes, and accessories, the department (men\'s, women\'s, kids\') comes from that person\'s profile; when it is not there, ask once before searching and save the answer to their form facts. Never assume it. When the shopping is for someone whose profile is new or says nothing that bears on the ask (no sizes, tastes, or interests to go on), do not search yet: ask two or three quick questions first (what they are into, the occasion, a budget, a size if it matters), save each answer to their profile, and only then look. Generic picks for a stranger are worse than a short question. Search first, shop second: the product tools come first when they exist, catalog_search (Shopify merchants), then product_search (any store on the web, with a checked price and seller), and the web search tool is the fallback; gather 3 to 5 strong options with the name, price, and where each is sold, favoring direct product pages over search-results pages as well as more well-known popular brands (if not specified) over less well-known ones; if they named a store, every option comes from that store (product_search takes it as store). Never recite the list before the pages are open, and never ask which one to open or whether to pull them up: you pick the order, best match first. The search and the tabs happen in the same turn, and you talk about the tab that opened. The links stay under sources. browser_tabs open refuses a link whose page is gone. When that happens, quietly present a different option in its place (searching again if needed) instead of mentioning the dead link. Never read URLs aloud. When they circle or mark a product photo and ask for something like it, describe exactly what is marked (category, color, material, shape, any visible brand) and run that description as the search; the matches are by description, not the image itself, so say so if they expect an exact visual match. If they say buy this, or buy that one, propose a checkout task for the product page already in this conversation, the option you just presented. Do not ask them to paste a URL, and do not type a card or address; the task runs in Buddy\'s own browser and fills the saved card and the shipping address. If computer use or the card is missing, say what is missing. If good options are thin, say so and ask what to loosen (price, brand, retailer) rather than padding the list with weak matches. If they say they like or dislike something for x reasons, save it to their shopper profile that same turn (save_memory with shopper and category), in passing, without being asked. How the pages open is appended below and overrides any other pace.',
    },
    {
      name: 'Booking',
      builtIn: true,
      instructions:
        'Booking something with a date attached (a table, a flight, a train, a hotel): "book a table for two Friday night", "get me on the morning train to Boston". Confirm the essentials before anything is booked: date, time, party size or travelers, and the name it goes under. Never invent one. Check the shopper profiles\' travel and dining rows and let them shape the picks (cuisine, seat, hotel style, price). Search first: use the web search tool to find the venue or route and how it takes bookings. Then book one of two ways. If the place books online and agent mode is on, propose_task to drive the booking site in the user\'s own logged-in browser with the confirmed details. If it takes reservations by phone (or has no booking site) and calling is connected, place the call with the confirmed details and report exactly what was secured. If neither route is available, say which piece is missing and present the best option with its booking link instead. After a successful booking, offer once to save the plan (a Google Maps list, a Sheets itinerary, or a Notion page) when those apps are connected.',
    },
    {
      name: 'Moodboards',
      builtIn: true,
      instructions:
        'Building or adding to a moodboard: "start a moodboard for the living room", "add this to my summer board". If Pinterest is connected, that is the board: search_apps then use_app to create or reuse a board and pin each image (from links already in this conversation or on screen, never hotlink-guess URLs). Do not build an HTML page or a local folder when Pinterest can do it. List their boards through the connection when they ask what boards exist; ask which board when it is unclear. Only if Pinterest is not connected: boards live in ~/Documents/Buddy Moodboards, one folder per board, built with run_command. Create with mkdir -p; save images with curl -L -o; after every change regenerate index.html (a plain grid of the images, each captioned and linked to its product page) and open it with `open` so they see the board. List boards with ls. Never delete a board or an image outright: removals move to ~/.Trash/. If they would rather keep the board in Google Sheets or Notion and those are connected, build it with use_app as rows or a page of links and images instead.',
    },
    ...APP_SKILLS,
  ],
  selectionButtonEnabled: true,
  // Overlay colors; the Appearance tab can change them.
  colorIdleDot: '#000000',
  colorSpeakingDot: '#209d55',
  colorBuddySpeakingDot: '#000000',
  colorLoadingDot: DISCO_COLOR,
  colorDrivingFrame: DISCO_COLOR,
  colorAnnotations: '#ff5a5f',
  colorErrorBubble: '#e5484d',
  colorUserMarks: '#ffffff',
  marksEnabled: true,
  documentReadLimit: 80_000,
  buddyShipping: EMPTY_BUYER,
  buddyBilling: EMPTY_BUYER,
  trustedMerchants: [],
  browserLoginsFrom: '',
  composioUserId: '',
  productBrowse: 'one',
  ideasEnabled: true,
  ideasTime: 'morning',
  ideasCount: IDEAS_COUNT.natural,
  ideasReach: false,
  ideasAutoRun: false,
  textBridgeEnabled: false,
  textBridgeHandle: '',
  textBridgeConfirm: true,
  // "Me" seeded so the Memory page opens on the shape rather than a blank list.
  shoppers: [emptyShopper('Me')],
};

/**
 * The settings that differ from the defaults: what the user chose. Only these
 * are stored, so a default that changes later reaches everyone who never
 * chose, and nothing has to remember what the default used to be.
 */
export function chosenSettings(settings: Partial<Settings>): Partial<Settings> {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[key as keyof Settings]),
    ),
  ) as Partial<Settings>;
}
