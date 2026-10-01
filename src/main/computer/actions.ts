// The one catalogue of computer actions: which family each belongs to,
// whether it synthesizes input (and so must pass the safety gate), and the
// fields it accepts. The model's tool schema and every provider read this
// table, so an action is declared exactly once.

import type { ActionFamily } from './provider';

/** The argument fields any action can accept, described once. */
const FIELDS = {
  coordinate: {
    type: 'array',
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
    description: '[x, y] in the pixel space of the most recent screenshot.',
  },
  start_coordinate: {
    type: 'array',
    items: { type: 'number' },
    minItems: 2,
    maxItems: 2,
    description: 'Where a drag begins, in the most recent screenshot\'s pixel space.',
  },
  region: {
    type: 'array',
    items: { type: 'number' },
    minItems: 4,
    maxItems: 4,
    description: '[x0, y0, x1, y1] corners of the region to magnify, in screenshot pixels.',
  },
  frame_id: {
    type: 'string',
    description:
      'The frame_id of the screenshot the coordinates were measured in. Required whenever ' +
      'you send a coordinate, so a stale measurement is refused instead of misclicked.',
  },
  text: {
    type: 'string',
    description: 'Literal text for type, or a key combo for key (e.g. "cmd+s", "Return").',
  },
  repeat: {
    type: 'integer',
    description: 'How many times to press the combo (key only). Default 1.',
  },
  modifiers: {
    type: 'array',
    items: { type: 'string' },
    description: 'Keys held down during the click, e.g. ["cmd"] or ["cmd", "shift"].',
  },
  scroll_direction: {
    type: 'string',
    enum: ['up', 'down', 'left', 'right'],
    description: 'Which way to scroll.',
  },
  scroll_amount: {
    type: 'integer',
    description:
      'Wheel clicks to scroll. Default 10, about one screenful; use 30 or more to cover a long page in one move, or key End / Page Down to jump to the bottom.',
  },
  duration: {
    type: 'number',
    description: 'Seconds to wait, up to 30.',
  },
  pid: {
    type: 'integer',
    description: 'Process id from list_windows. Send it with window_id; omit both for the window in front.',
  },
  window_id: {
    type: 'integer',
    description: 'Window id from list_windows. Send it with pid; omit both for the window in front.',
  },
  observation_id: {
    type: 'string',
    description: 'The observation_id a ref came from, so a superseded ref is refused.',
  },
  ref: {
    type: 'string',
    description: 'An element ref (e1, e2, …) from that observation.',
  },
  element: {
    type: 'string',
    description:
      'The element in plain words, instead of observation_id and ref: "the Add to cart button", ' +
      '"the email field". Buddy reads the window and picks it, so no get_window_state call is needed first. ' +
      'Add pid and window_id for a window that is not in front.',
  },
  value: {
    type: 'string',
    description: 'The text to put in the element, replacing what is there.',
  },
  query: {
    type: 'string',
    description: 'Only return elements whose text matches this, for windows with large trees.',
  },
  element_text: {
    type: 'string',
    description:
      'Text identifying the element wait_for watches, matched case-insensitively against each ' +
      'element\'s name, value and role.',
  },
  until: {
    type: 'string',
    enum: ['appears', 'gone', 'changed'],
    description: 'What must happen to the element_text element. Default appears.',
  },
  condition: {
    type: 'string',
    description:
      'A plain-language condition to wait for instead of element_text, judged from the ' +
      'window\'s elements each poll (e.g. "the export has finished").',
  },
  clipboard_text: {
    type: 'string',
    description: 'The text to put on the clipboard.',
  },
  path: {
    type: 'array',
    items: { type: 'string' },
    description: 'A menu path from the menu bar down, e.g. ["File", "Save As…"]. Labels must match exactly.',
  },
  url: {
    type: 'string',
    description: 'An http(s) URL to open in Buddy\'s browser.',
  },
} as const;

export type FieldName = keyof typeof FIELDS;

export { FIELDS };

export interface ActionSpec {
  family: ActionFamily;
  /** Synthesizes input, so it must pass the safety gate before a provider sees it. */
  mutates: boolean;
  /** One line describing the action to the model. */
  summary: string;
  fields?: readonly FieldName[];
  /** Fields the action also takes on a provider with the element family (key focusing a field first). */
  elementFields?: readonly FieldName[];
  required?: readonly FieldName[];
}

/** Every field an action can take: its own, plus the element ones where a provider can honour them. */
export function fieldsOf(spec: ActionSpec, withElements: boolean): readonly FieldName[] {
  return withElements && spec.elementFields ? [...(spec.fields ?? []), ...spec.elementFields] : (spec.fields ?? []);
}

const CLICK_SUMMARY = 'at coordinate, or where the cursor already is when coordinate is omitted';
/** A coordinate is optional for a click, but never without its frame_id. */
const CLICK_FIELDS = ['coordinate', 'frame_id', 'modifiers'] as const;
/**
 * How an element action names its target: a ref from an observation, or
 * (with Jev) the element in plain words, in the window pid and window_id
 * name or the front one.
 */
const ELEMENT_FIELDS = ['observation_id', 'ref', 'element', 'pid', 'window_id'] as const;

/** Fields that only mean something with Jev configured (see ComputerDescriptor.jev). */
export const JEV_FIELDS: readonly FieldName[] = ['element', 'condition'];

/** Whether the input points at an element: a ref, or plain words for Jev. */
export function namesElement(input: Record<string, unknown>): boolean {
  return input['ref'] !== undefined || (typeof input['element'] === 'string' && input['element'].trim() !== '');
}

/** How an action chose what it acts on, for the log: Jev from plain words, a ref, a pixel, or nothing to aim at. */
export type Targeting = 'jev' | 'ref' | 'coordinate' | 'none';

export function targetingOf(input: Record<string, unknown>): Targeting {
  const said = (key: string): boolean => typeof input[key] === 'string' && (input[key] as string).trim() !== '';
  if (JEV_FIELDS.some(said)) return 'jev';
  if (input['ref'] !== undefined) return 'ref';
  if (input['coordinate'] !== undefined || input['start_coordinate'] !== undefined) return 'coordinate';
  return 'none';
}

export const ACTIONS: Record<string, ActionSpec> = {
  screenshot: {
    family: 'screen',
    mutates: false,
    summary: 'Capture the screen. Every action already returns one, so rarely needed.',
  },
  zoom: {
    family: 'screen',
    mutates: false,
    summary:
      'Magnify a region to read text the screenshot blurs. Reading only — coordinates still ' +
      'come from the full screenshot.',
    fields: ['region', 'frame_id'],
    required: ['region', 'frame_id'],
  },
  cursor_position: {
    family: 'screen',
    mutates: false,
    summary: 'Report where the pointer is, in screenshot pixels.',
  },
  wait: {
    family: 'screen',
    mutates: false,
    summary: 'Pause for something that is genuinely still loading, then observe.',
    fields: ['duration'],
  },
  mouse_move: {
    family: 'screen',
    mutates: true,
    summary: 'Move the pointer without clicking (to reveal a hover state).',
    fields: ['coordinate', 'frame_id'],
    required: ['coordinate', 'frame_id'],
  },
  left_click: { family: 'screen', mutates: true, summary: `Left-click ${CLICK_SUMMARY}.`, fields: CLICK_FIELDS },
  right_click: { family: 'screen', mutates: true, summary: `Right-click ${CLICK_SUMMARY}.`, fields: CLICK_FIELDS },
  middle_click: { family: 'screen', mutates: true, summary: `Middle-click ${CLICK_SUMMARY}.`, fields: CLICK_FIELDS },
  double_click: { family: 'screen', mutates: true, summary: `Double-click ${CLICK_SUMMARY}.`, fields: CLICK_FIELDS },
  triple_click: { family: 'screen', mutates: true, summary: `Triple-click ${CLICK_SUMMARY}.`, fields: CLICK_FIELDS },
  left_click_drag: {
    family: 'screen',
    mutates: true,
    summary: 'Press at start_coordinate, drag to coordinate, release.',
    fields: ['start_coordinate', 'coordinate', 'frame_id'],
    required: ['start_coordinate', 'coordinate', 'frame_id'],
  },
  left_mouse_down: {
    family: 'screen',
    mutates: true,
    summary: 'Hold the left button down (pair it with left_mouse_up).',
  },
  left_mouse_up: { family: 'screen', mutates: true, summary: 'Release the left button.' },
  scroll: {
    family: 'screen',
    mutates: true,
    summary: 'Scroll, optionally after moving the pointer to coordinate.',
    fields: ['coordinate', 'frame_id', 'scroll_direction', 'scroll_amount'],
    required: ['scroll_direction'],
  },
  type: {
    family: 'screen',
    mutates: true,
    summary: 'Type text into whatever has keyboard focus. Check the frontmost app first.',
    fields: ['text'],
    required: ['text'],
  },
  key: {
    family: 'screen',
    mutates: true,
    summary:
      'Press a key or combo, e.g. "cmd+s", "Return", "Page_Down". Goes to whatever has focus; ' +
      'add observation_id and ref (or element) to focus a text field first.',
    fields: ['text', 'repeat'],
    elementFields: [...ELEMENT_FIELDS],
    required: ['text'],
  },

  list_apps: {
    family: 'window',
    mutates: false,
    summary: 'List the running apps and their pids.',
  },
  list_windows: {
    family: 'window',
    mutates: false,
    summary: 'List the open windows front to back, with the pid and window_id to address them by.',
  },
  get_window_state: {
    family: 'window',
    mutates: false,
    summary:
      'Read a window\'s elements. This is how to find things: prefer it over measuring pixels. ' +
      'Menus are left out — use invoke_menu for those.',
    fields: ['pid', 'window_id', 'query'],
  },
  expand_element: {
    family: 'window',
    mutates: false,
    summary: 'Show the elements inside one element, when a large tree was cut short.',
    fields: ['observation_id', 'ref'],
    required: ['observation_id', 'ref'],
  },
  bring_to_front: {
    family: 'window',
    mutates: true,
    summary: 'Make a window the frontmost one. Needed before typing without a ref.',
    fields: ['pid', 'window_id'],
  },
  invoke_menu: {
    family: 'window',
    mutates: true,
    summary: 'Choose an app menu item by its path. Exact and reliable — prefer it over clicking menus.',
    fields: ['path', 'pid', 'window_id'],
    required: ['path'],
  },
  wait_for: {
    family: 'window',
    mutates: false,
    summary:
      'Poll a window until an element appears, changes or disappears (element_text + until), or ' +
      'a plain-language condition holds. Better than blind wait when something is loading.',
    fields: ['pid', 'window_id', 'element_text', 'until', 'condition', 'duration'],
  },

  click_element: {
    family: 'element',
    mutates: true,
    summary:
      'Press an element. Works without moving the pointer or changing which app is in ' +
      'front, so prefer it over clicking a coordinate.',
    fields: [...ELEMENT_FIELDS],
    required: ['observation_id', 'ref'],
  },
  right_click_element: {
    family: 'element',
    mutates: true,
    summary: 'Right-click an element to open its context menu, without moving the pointer.',
    fields: [...ELEMENT_FIELDS],
    required: ['observation_id', 'ref'],
  },
  set_value: {
    family: 'element',
    mutates: true,
    summary:
      'Put a value straight into a field or dropdown. The right way to fill a form; ' +
      'if it is refused, use type_into.',
    fields: [...ELEMENT_FIELDS, 'value'],
    required: ['observation_id', 'ref', 'value'],
  },
  type_into: {
    family: 'element',
    mutates: true,
    summary: 'Type into an element, keystroke by keystroke. The fallback when set_value is refused.',
    fields: [...ELEMENT_FIELDS, 'text'],
    required: ['observation_id', 'ref', 'text'],
  },

  // Buddy's own browser: the page is the only window, and this is how it
  // gets to one. Mutating, so a task's limits count it.
  navigate: {
    family: 'browser',
    mutates: true,
    summary: 'Open a URL in Buddy\'s browser and read the page. The way to reach a site or product page.',
    fields: ['url'],
    required: ['url'],
  },

  // The clipboard family is write-only here: reading the clipboard is the
  // consent-gated read_clipboard control tool, which always asks the user.
  clipboard_set: {
    family: 'clipboard',
    mutates: true,
    summary:
      'Put text on the clipboard, replacing what is there. With key cmd+v, the reliable way to ' +
      'place long text where set_value is refused.',
    fields: ['clipboard_text'],
    required: ['clipboard_text'],
  },
};

/** Which button each click action presses, and how many times. */
export const CLICK_BUTTONS: Record<string, { button: 'left' | 'right' | 'middle'; count: number }> = {
  left_click: { button: 'left', count: 1 },
  right_click: { button: 'right', count: 1 },
  middle_click: { button: 'middle', count: 1 },
  double_click: { button: 'left', count: 2 },
  triple_click: { button: 'left', count: 3 },
};

/**
 * The action names a provider supports: everything in its families, minus
 * the handful it genuinely cannot perform. Sorted so the schema (and the
 * tests that read it) are stable.
 */
export function actionsForFamilies(
  families: readonly ActionFamily[],
  missing: readonly string[] = [],
): string[] {
  const allowed = new Set(families);
  return Object.entries(ACTIONS)
    .filter(([name, spec]) => allowed.has(spec.family) && !missing.includes(name))
    .map(([name]) => name)
    .sort();
}

/** True when the action synthesizes input and must pass the safety gate. */
export function mutates(name: string): boolean {
  return ACTIONS[name]?.mutates ?? true;
}

/** Fields that belong to some other action; every action takes only its own. */
/**
 * A value some models send for every property of the flat schema when they
 * mean "not this one": an empty string, an empty list, zero, a list of
 * zeros. GPT models do this under OpenRouter for the whole `computer` tool,
 * so `key {"text":"cmd+n"}` arrives with fifteen blank fields beside it.
 */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === 0 || value === false) return true;
  return Array.isArray(value) && value.every(isBlank);
}

/** This many blank fields in one call is the padding signature, not a model naming things. */
const PADDING_BLANKS = 3;

/** Fields that aim an action. Never dropped silently: a ref on a click is refused, so the model learns. */
const TARGETING_FIELDS = new Set<string>(['observation_id', 'ref', 'element', 'coordinate', 'start_coordinate']);

/**
 * The arguments as meant. Blank fields go. When the call was padded (enough
 * blanks to be sure), the enum fields the same padding fills with their
 * first option (`scroll_direction: "up"`, `until: "appears"`) go too, unless
 * the action takes them or they aim it.
 */
export function cleanArgs(name: string, input: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(input);
  const padded = entries.filter(([, value]) => isBlank(value)).length >= PADDING_BLANKS;
  const allowed = new Set<string>(ACTIONS[name] ? fieldsOf(ACTIONS[name], true) : []);
  return Object.fromEntries(
    entries.filter(
      ([field, value]) => !isBlank(value) && !(padded && !allowed.has(field) && !TARGETING_FIELDS.has(field)),
    ),
  );
}

/** The fields a read can carry without meaning anything: a stray ref on get_window_state acts nowhere. */
const HARMLESS_ON_READS = new Set(['observation_id', 'ref']);

export function unknownFields(name: string, input: Record<string, unknown>, withElements = true): string[] {
  const spec = ACTIONS[name];
  const allowed = new Set<string>(spec ? fieldsOf(spec, withElements) : []);
  return Object.keys(input).filter(
    (field) => !allowed.has(field) && !(spec && !spec.mutates && HARMLESS_ON_READS.has(field)),
  );
}

/**
 * Why those fields don't belong here. The tool exposes one flat set of
 * properties for every action, so nothing stops a model sending a ref to a
 * click — and silently dropping it would act somewhere it never named.
 */
export function wrongFieldsDetail(name: string, extra: readonly string[]): string {
  const misplacedRef = extra.includes('ref') || extra.includes('observation_id');
  return (
    `${name} does not take ${extra.join(', ')}.` +
    (misplacedRef
      ? ' To act on an element ref, use click_element, right_click_element, set_value or type_into.'
      : '')
  );
}
