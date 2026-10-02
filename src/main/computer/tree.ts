// Turning a window's accessibility tree into something a model can read.
//
// A real tree is mostly noise: TextEdit's 189 nodes are 157 menu-bar items,
// 16 ruler markers and 16 useful controls. Sending all of it would cost more
// context than the screenshot it replaces, so this module keeps only what a
// model could actually address, and renders one short line per element.
//
// Pure module: it takes the driver's JSON and returns text, so it is fully
// unit-testable against the recorded trees in tests/fixtures.

/** One element as the driver reports it, in the fields Buddy reads. */
export interface RawElement {
  element_index: number;
  role: string;
  depth: number;
  element_token?: string;
  label?: string;
  value?: string;
  enabled?: boolean;
  selected?: boolean;
  frame?: { x: number; y: number; w: number; h: number };
  actions?: string[];
}

/** A box in global screen DIP, as macOS reports it. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An element that survived the filter, ready to be given a ref. */
export interface TreeElement {
  index: number;
  token: string | null;
  /** The AX prefix stripped: AXPopUpButton -> popupbutton. */
  role: string;
  name: string;
  value: string;
  enabled: boolean;
  selected: boolean;
  /** Global screen coordinates in DIP, as macOS reports them. */
  bounds: Bounds | null;
  /**
   * Where this element's words actually are, when its own frame is the block
   * around them: a page's heading spans the whole column while the text in it
   * does not, and a box drawn on the frame boxes the column. Null when the
   * frame is already the thing — every control, and text with nothing inside.
   */
  textBounds: Bounds | null;
  /** Depth in the driver's tree, kept so a subtree can still be identified. */
  depth: number;
  /** The AX actions the element answers to, e.g. AXPress. Empty if unsaid. */
  actions: readonly string[];
  /**
   * The web origin of the frame this element lives in, as the browser
   * process reports it (never as the frame describes itself). Set only by
   * Buddy's browser; the card fill refuses a field without one.
   */
  origin?: string;
  /**
   * The origins of every frame above this element's frame, innermost first,
   * from the same browser-process frame tree. A processor's card frame placed
   * by an ad frame has the ad's origin here, and the card fill refuses it.
   */
  ancestors?: readonly string[];
}

/** Pressing anything else fails in the driver with an unsupported action. */
export const PRESS_ACTION = 'AXPress';

/** A filtered element once the registry has named it. */
export interface RefRow extends TreeElement {
  ref: string;
}

export interface WindowTree {
  pid: number;
  windowId: number;
  /** The driver's snapshot_id, which becomes Buddy's observationId. */
  snapshotId: string;
  app: string;
  title: string;
  elements: TreeElement[];
  /** How many elements the driver walked, before filtering. */
  total: number;
  /** Set when the driver could not resolve the window's AX surface. */
  degradedReason: string;
}

/** How many lines one tool result may carry; the rest need expand_element. */
const MAX_ROWS = 300;

/**
 * Trees larger than this are rendered as a depth-limited overview instead of
 * dumped whole. A dense app (Slack, an IDE) keeps hundreds of addressable
 * rows even after filtering; showing three levels with a `+N inside` marker
 * on each truncated branch costs a fraction of that, and expand_element
 * reveals any branch on demand — the full rows are already recorded.
 */
const SKELETON_THRESHOLD = 100;

/** How many levels an overview shows, counted from its shallowest row. */
const SKELETON_DEPTH = 3;

/**
 * Apps that publish their own chrome to accessibility but not the content
 * inside them. Safari hands over its toolbar and address bar and nothing of
 * the page; Chromium browsers hand over the whole page. Saying so up front
 * saves the model discovering it one failed step at a time.
 */
const PAGE_BLIND_APPS = new Set(['Safari', 'Safari Technology Preview']);

/** Where the window itself sits on screen, from its own root element. */
export function windowBounds(elements: readonly TreeElement[]): TreeElement['bounds'] {
  return elements.find((element) => element.role === 'window')?.bounds ?? null;
}

/**
 * The box to draw on or point at: an element's own words when its frame is
 * only the block around them, and otherwise the frame itself. Acting still
 * goes through the element, whose frame is what a click needs.
 */
export function visibleBounds(element: TreeElement): Bounds | null {
  return element.textBounds ?? element.bounds;
}

/** Why this window's elements are not the whole story, if they aren't. */
export function treeCaveat(app: string, elements: readonly TreeElement[]): string {
  if (!PAGE_BLIND_APPS.has(app)) return '';
  if (elements.some((element) => element.role === 'webarea')) return '';
  return `${app} publishes its toolbar but not the page inside it`;
}

/** Long labels are usually a whole document; the model only needs the start. */
const MAX_TEXT = 80;

/**
 * The menu bar is its own root in the tree and is enormous — over 150 nodes
 * in a plain document app. Buddy invokes menus by path instead, so the whole
 * subtree is dropped rather than paid for on every observation.
 */
const MENU_BAR_ROLE = 'AXMenuBar';

/** Chrome that exists to be drawn, never to be addressed. */
const DECORATIVE_ROLES = new Set([
  'AXRuler',
  'AXRulerMarker',
  'AXScrollBar',
  'AXSplitter',
  'AXGrowArea',
  'AXValueIndicator',
  'AXIncrementArrow',
  'AXDecrementArrow',
  'AXUnknown',
]);

/**
 * Roles worth keeping even with no name: a window's close button and an empty
 * text field are both addressable, and position tells the model which is which.
 */
const INTERACTIVE_ROLES = new Set([
  'AXButton',
  'AXCheckBox',
  'AXColorWell',
  'AXComboBox',
  'AXDisclosureTriangle',
  'AXIncrementor',
  'AXLink',
  'AXMenuButton',
  'AXPopUpButton',
  'AXRadioButton',
  'AXSearchField',
  'AXSlider',
  'AXTab',
  'AXTextArea',
  'AXTextField',
  'AXWindow',
]);

export function parseWindowTree(structuredJson: string | undefined): WindowTree | null {
  if (!structuredJson) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(structuredJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const elements = Array.isArray(raw['elements']) ? (raw['elements'] as RawElement[]) : [];
  return {
    pid: numberOf(raw['pid']),
    windowId: numberOf(raw['window_id']),
    snapshotId: stringOf(raw['snapshot_id']),
    app: stringOf(raw['app_name']),
    title: stringOf(raw['window_title']),
    elements: keepAddressable(elements),
    total: numberOf(raw['total_element_count']) || elements.length,
    degradedReason: stringOf(raw['degraded_reason']),
  };
}

/**
 * Drop everything the model could not act on or learn from. The driver walks
 * depth-first, so a subtree is the run of following elements deeper than its
 * root — which is how whole branches (the menu bar, a ruler) are removed.
 */
export function keepAddressable(elements: readonly RawElement[]): TreeElement[] {
  const kept: TreeElement[] = [];
  /** The kept elements enclosing the current one, innermost last. */
  const ancestors: TreeElement[] = [];
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i]!;
    if (element.role === MENU_BAR_ROLE || DECORATIVE_ROLES.has(element.role)) {
      i = endOfSubtree(elements, i);
      continue;
    }
    const name = compact(element.label);
    // A control's value is its state; a label's "value" is just its text
    // again, and repeating it would double the cost of every line.
    const value = compact(element.value) === name ? '' : compact(element.value);
    // Nothing to name it by and nothing to do with it: pure layout.
    if (!name && !value && !INTERACTIVE_ROLES.has(element.role)) continue;
    const bounds = element.frame ?? null;
    // A virtualized row that is scrolled out of view reports a sliver frame;
    // clicking it would land on whatever is really there.
    if (bounds && (bounds.w <= 1 || bounds.h <= 1)) continue;

    if (bounds) {
      // What encloses this element on screen, which on a web page is a truer
      // parent than tree depth: the text of a link is often its sibling.
      while (ancestors.length > 0 && !encloses(ancestors[ancestors.length - 1]!, bounds)) ancestors.pop();
      // Pages wrap the same words in several nodes — a link, the text inside
      // it, the image beside it. Only the outer one can be acted on, and it
      // already says what they all say.
      if (echoesParent(element.role, name, value, ancestors[ancestors.length - 1])) {
        noteText(ancestors[ancestors.length - 1]!, element.role, bounds);
        continue;
      }
    }

    const row: TreeElement = {
      index: element.element_index,
      token: element.element_token ?? null,
      role: shortRole(element.role),
      name,
      value,
      enabled: element.enabled !== false,
      selected: element.selected === true,
      bounds: bounds ? rounded(bounds) : null,
      textBounds: null,
      depth: element.depth,
      actions: element.actions ?? [],
    };
    kept.push(row);
    // Only a positioned element can enclose anything.
    if (bounds) ancestors.push(row);
  }
  return kept;
}

/** Whether one element's box covers another's. */
function encloses(outer: TreeElement, inner: RawElement['frame'] | null): boolean {
  if (!outer.bounds || !inner) return false;
  return (
    inner.x >= outer.bounds.x &&
    inner.y >= outer.bounds.y &&
    inner.x + inner.w <= outer.bounds.x + outer.bounds.w &&
    inner.y + inner.h <= outer.bounds.y + outer.bounds.h
  );
}

/** Roles whose frame is the glyphs themselves rather than a box around them. */
const TEXT_ROLES = new Set(['AXStaticText', 'AXHeading']);

/** The interactive roles as a kept element names them: AXPopUpButton -> popupbutton. */
const INTERACTIVE_SHORT_ROLES = new Set([...INTERACTIVE_ROLES].map(shortRole));

/** The AX prefix stripped, the way every kept element's role is written. */
function shortRole(role: string): string {
  return role.replace(/^AX/, '').toLowerCase();
}

/**
 * A dropped text node tells its keeper where its words are. Only when the
 * keeper is a block that the words fill the height of: a control's frame is
 * the control (ring the button, not its caption), and one paragraph deep in
 * a page says nothing about where the page is.
 */
function noteText(parent: TreeElement, role: string, box: NonNullable<RawElement['frame']>): void {
  if (!TEXT_ROLES.has(role) || INTERACTIVE_SHORT_ROLES.has(parent.role)) return;
  if (!parent.bounds || box.h < parent.bounds.h / 2) return;
  const words = rounded(box);
  parent.textBounds = parent.textBounds ? union(parent.textBounds, words) : words;
}

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** A label whose enclosing element already carries the same words. */
function echoesParent(
  role: string,
  name: string,
  value: string,
  parent: TreeElement | undefined,
): boolean {
  if (!parent || !name || value || INTERACTIVE_ROLES.has(role)) return false;
  return parent.name.includes(name);
}

/** The index of the last element inside the subtree rooted at `start`. */
function endOfSubtree(elements: readonly RawElement[], start: number): number {
  const depth = elements[start]!.depth;
  let end = start;
  while (end + 1 < elements.length && elements[end + 1]!.depth > depth) end++;
  return end;
}

/**
 * One row and everything under it. Filtering only removes rows from a
 * depth-first list, so a subtree is still the run that follows its root
 * while the depth stays greater.
 */
export function subtreeOf<T extends { ref: string; depth: number }>(
  rows: readonly T[],
  ref: string,
): T[] {
  const start = rows.findIndex((row) => row.ref === ref);
  if (start < 0) return [];
  let end = start + 1;
  while (end < rows.length && rows[end]!.depth > rows[start]!.depth) end++;
  return rows.slice(start, end);
}

/** One element per line: `e12 | button | Send | =value | disabled | x,y wxh`. */
export function formatRows(rows: readonly RefRow[]): string {
  const view = windowBounds(rows);
  return rows.map((row) => formatRow(row, view)).join('\n');
}

/**
 * Whether an element's box sits inside the window's visible frame. Page
 * content scrolled past the window's edge still carries screen coordinates,
 * and a click there lands on whatever is really at that spot — the Dock,
 * another window — instead of the element.
 */
export function inView(box: Bounds | null, view: Bounds | null): boolean {
  if (!box || !view) return true; // nothing to judge by: let it through
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return cx >= view.x && cx <= view.x + view.w && cy >= view.y && cy <= view.y + view.h;
}

/** What renderTree hands back: the lines to send, and how many rows they are. */
export interface TreeView {
  text: string;
  shown: number;
}

/**
 * Render rows for the model. A small tree is shown whole; a large one as a
 * depth-limited overview where each truncated branch ends in `+N inside`,
 * counting the rows expand_element on it would reveal. The refs are the same
 * either way — an overview hides rows, it never renumbers them.
 */
export function renderTree(rows: readonly RefRow[]): TreeView {
  if (rows.length <= SKELETON_THRESHOLD) {
    const shown = rows.slice(0, MAX_ROWS);
    return { text: formatRows(shown), shown: shown.length };
  }
  let base = Infinity;
  for (const row of rows) base = Math.min(base, row.depth);
  const cutoff = base + SKELETON_DEPTH;

  const kept: RefRow[] = [];
  const hiddenBy = new Map<string, number>();
  /** The kept rows enclosing the current one by depth, innermost last. */
  const ancestors: RefRow[] = [];
  for (const row of rows) {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.depth >= row.depth) ancestors.pop();
    if (row.depth < cutoff) {
      kept.push(row);
      ancestors.push(row);
    } else {
      // A hidden row counts against its nearest shown ancestor — filtering
      // may have dropped the levels between, so depth alone can't say which.
      const parent = ancestors[ancestors.length - 1];
      if (parent) hiddenBy.set(parent.ref, (hiddenBy.get(parent.ref) ?? 0) + 1);
    }
  }

  const shown = kept.slice(0, MAX_ROWS);
  const view = windowBounds(rows);
  const text = shown
    .map((row) => {
      const hidden = hiddenBy.get(row.ref) ?? 0;
      return hidden > 0 ? `${formatRow(row, view)} | +${hidden} inside` : formatRow(row, view);
    })
    .join('\n');
  return { text, shown: shown.length };
}

function formatRow(row: RefRow, view: Bounds | null): string {
  const parts = [row.ref, row.role];
  if (row.name) parts.push(truncate(row.name));
  if (row.value) parts.push(`=${truncate(row.value)}`);
  if (!row.enabled) parts.push('disabled');
  if (row.selected) parts.push('selected');
  if (row.bounds) parts.push(`${row.bounds.x},${row.bounds.y} ${row.bounds.w}x${row.bounds.h}`);
  // The model reads coordinates as reachable; a row past the window's edge
  // is not, until it scrolls.
  if (!inView(row.bounds, view)) parts.push('off-view (scroll to it)');
  return parts.join(' | ');
}

/** Newlines and runs of spaces would break the one-line-per-element format. */
function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}…`;
}

function rounded(box: NonNullable<RawElement['frame']>): Bounds {
  return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) };
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
