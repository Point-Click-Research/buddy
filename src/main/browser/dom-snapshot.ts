// What a page looks like to the model: the same one-line-per-element list a
// native window gets, built from the DOM instead of accessibility. The
// script below runs inside every frame of Buddy's browser (cross-origin card
// iframes included) and reports the elements a model could address, keeping
// a handle to each node on that frame's window so a ref can act on it later.
// The mapping onto TreeElement is pure, so the renderer, expand_element and
// off-view marking all work unchanged.

import type { Bounds, TreeElement } from '../computer/tree';

/** One element as the in-page script reports it, in its own frame's viewport px. */
export interface SnapshotElement {
  /** Position in the frame's remembered node list (window.__buddyNodes). */
  index: number;
  role: string;
  name: string;
  value: string;
  enabled: boolean;
  selected: boolean;
  bounds: Bounds | null;
  /** For iframe rows: the frame's src and name, so its child frame can be matched. */
  src?: string;
  frameName?: string;
}

/** What the script returns for one frame. */
export interface FrameSnapshot {
  url: string;
  name: string;
  title: string;
  viewport: { width: number; height: number };
  elements: SnapshotElement[];
}

/** One frame's snapshot plus the offset of that frame inside the page. */
export interface PlacedFrame {
  frame: number;
  snapshot: FrameSnapshot;
  /** Where the frame's (0,0) sits in main-frame viewport px; null when unknown. */
  offset: { x: number; y: number } | null;
}

/** A row's node handle: which frame, and which remembered node in it. */
export interface NodeRef {
  frame: number;
  index: number;
}

/** The token a TreeElement carries, so a ref resolves back to its node. */
export function nodeToken(ref: NodeRef): string {
  return `${ref.frame}:${ref.index}`;
}

export function parseNodeToken(token: string | null): NodeRef | null {
  const match = /^(\d+):(\d+)$/.exec(token ?? '');
  return match ? { frame: Number(match[1]), index: Number(match[2]) } : null;
}

/** Elements the snapshot may return per frame; the rest are beyond a model's reach anyway. */
const MAX_PER_FRAME = 400;
/** Leaf text rows per frame: enough for prices, errors and labels, not the whole article. */
const MAX_TEXT_PER_FRAME = 120;
const MAX_TEXT_LENGTH = 120;

/**
 * The snapshot script. Runs in the frame's own world and returns a
 * FrameSnapshot. Written as a string so it can be handed to
 * WebFrameMain.executeJavaScript for every frame, including cross-origin
 * ones Buddy's main world cannot reach.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX = ${MAX_PER_FRAME};
  const MAX_TEXT = ${MAX_TEXT_PER_FRAME};
  const TEXT_LENGTH = ${MAX_TEXT_LENGTH};
  const nodes = [];
  const elements = [];
  const clip = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, TEXT_LENGTH);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return null;
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const labelFor = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const text = by.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (text.trim()) return text;
    }
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.textContent).join(' ');
    const wrap = el.closest('label');
    if (wrap && wrap !== el) return wrap.textContent;
    return el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '';
  };
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const explicit = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'password') return 'securetextfield';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return 'button';
      if (type === 'hidden') return '';
      return 'textfield';
    }
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'combobox';
    if (tag === 'button' || explicit === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (explicit === 'link') return 'link';
    if (explicit === 'checkbox' || explicit === 'switch') return 'checkbox';
    if (explicit === 'radio') return 'radio';
    if (explicit === 'combobox' || explicit === 'listbox') return 'combobox';
    if (explicit === 'textbox' || el.isContentEditable) return 'textfield';
    if (explicit === 'tab' || explicit === 'menuitem' || explicit === 'option') return 'button';
    if (tag === 'iframe' || tag === 'frame') return 'iframe';
    if (tag === 'img' && el.getAttribute('alt')) return 'image';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (explicit === 'alert' || explicit === 'status' || el.getAttribute('aria-live')) return 'alert';
    if (tag === 'label' || tag === 'legend' || tag === 'option') return 'statictext';
    return '';
  };
  const valueOf = (el, role) => {
    if (role === 'combobox' && el.tagName.toLowerCase() === 'select') {
      const opt = el.options && el.options[el.selectedIndex];
      return opt ? opt.textContent : '';
    }
    if (role === 'securetextfield') return el.value ? '•'.repeat(String(el.value).length) : '';
    if ('value' in el && typeof el.value === 'string' && role !== 'button') return el.value;
    if (el.isContentEditable) return el.textContent;
    return '';
  };
  const push = (el, role, name, value, extra) => {
    if (elements.length >= MAX) return;
    const bounds = visible(el);
    if (!bounds) return;
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    const checked = el.checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
    nodes.push(el);
    elements.push(Object.assign({
      index: nodes.length - 1,
      role,
      name: clip(name),
      value: clip(value),
      enabled: !disabled,
      selected: checked,
      bounds,
    }, extra || {}));
  };
  // Controls and landmarks first, in document order. One element's failure
  // (a page's anti-tamper script wrapping a DOM call) must not lose the rest.
  let texts = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (elements.length >= MAX) break;
    try {
      const role = roleOf(el);
      if (!role) continue;
      if (role === 'iframe') {
        push(el, role, el.getAttribute('title') || el.getAttribute('name') || '', '', { src: el.getAttribute('src') || '', frameName: el.getAttribute('name') || '' });
        continue;
      }
      if (role === 'heading' || role === 'alert' || role === 'statictext') {
        if (texts >= MAX_TEXT) continue;
        const text = clip(el.textContent);
        if (!text) continue;
        texts++;
        push(el, role, text, '');
        continue;
      }
      const name = role === 'button' || role === 'link' || role === 'image'
        ? (clip(el.textContent) || labelFor(el))
        : labelFor(el);
      push(el, role, name, valueOf(el, role));
    } catch (e) {}
  }
  // Short leaf text the controls do not carry: prices, error lines, totals.
  if (texts < MAX_TEXT) {
    for (const el of document.querySelectorAll('body p, body span, body div, body li, body td, body th, body dd, body dt, body strong, body b, body small')) {
      if (elements.length >= MAX || texts >= MAX_TEXT) break;
      try {
        if (el.children.length > 0) continue;
        if (el.closest('button, a, label, [role="button"], [role="link"], option')) continue;
        const text = clip(el.textContent);
        if (text.length < 2) continue;
        texts++;
        push(el, 'statictext', text, '');
      } catch (e) {}
    }
  }
  window.__buddyNodes = nodes;
  return {
    url: location.href,
    name: window.name || '',
    title: document.title || '',
    viewport: { width: window.innerWidth, height: window.innerHeight },
    elements,
  };
})()`;

/** Act on a remembered node: the JS for one action, by node index. */
export function nodeScript(index: number, action: 'focus' | 'click' | 'scrollIntoView' | 'rect' | 'options'): string {
  const target = `(window.__buddyNodes || [])[${index}]`;
  switch (action) {
    case 'options':
      // A native <select>'s choices, or null for anything else.
      return `(() => { const el = ${target}; if (!el || el.tagName !== 'SELECT') return null; return Array.from(el.options).filter((o) => !o.disabled).map((o) => (o.textContent || '').trim()).filter(Boolean); })()`;
    case 'focus':
      return `(() => { const el = ${target}; if (!el) return false; el.focus(); if (typeof el.select === 'function') el.select(); return document.activeElement === el; })()`;
    case 'click':
      return `(() => { const el = ${target}; if (!el) return false; el.click(); return true; })()`;
    case 'scrollIntoView':
      return `(() => { const el = ${target}; if (!el) return false; el.scrollIntoView({ block: 'center', inline: 'nearest' }); return true; })()`;
    case 'rect':
      return `(() => { const el = ${target}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`;
  }
}

/**
 * Set a field's value the way frameworks expect: through the native setter
 * (so React's tracked value differs) and with input and change events.
 * Selects pick the option whose text or value matches.
 */
export function setValueScript(index: number, value: string): string {
  const literal = JSON.stringify(value);
  return `(() => {
    const el = (window.__buddyNodes || [])[${index}];
    if (!el) return 'missing';
    const fire = (type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    if (el.tagName === 'SELECT') {
      const wanted = ${literal}.trim().toLowerCase();
      const option = Array.from(el.options).find((o) => o.value.toLowerCase() === wanted || (o.textContent || '').trim().toLowerCase() === wanted)
        || Array.from(el.options).find((o) => (o.textContent || '').trim().toLowerCase().startsWith(wanted));
      if (!option) return 'no-option';
      el.value = option.value;
      fire('input'); fire('change');
      return 'ok';
    }
    if (el.isContentEditable) {
      el.focus();
      el.textContent = ${literal};
      fire('input'); fire('change');
      return 'ok';
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, ${literal}); else el.value = ${literal};
    fire('input'); fire('change');
    return 'ok';
  })()`;
}

/**
 * Lay the frames out as one element list the registry can record. Each
 * frame's elements are shifted by where that frame sits in the page; a
 * child frame whose owner iframe could not be matched keeps null bounds
 * (still readable and fillable by ref, not clickable by coordinate).
 */
export function toTreeElements(frames: readonly PlacedFrame[]): TreeElement[] {
  const rows: TreeElement[] = [];
  const main = frames[0];
  if (!main) return rows;
  rows.push({
    index: 0,
    token: null,
    role: 'window',
    name: main.snapshot.title || main.snapshot.url,
    value: main.snapshot.url,
    enabled: true,
    selected: false,
    bounds: { x: 0, y: 0, w: main.snapshot.viewport.width, h: main.snapshot.viewport.height },
    textBounds: null,
    depth: 0,
    actions: [],
  });
  for (const placed of frames) {
    const depth = placed.frame === 0 ? 1 : 2;
    for (const element of placed.snapshot.elements) {
      const shifted =
        element.bounds && placed.offset
          ? { ...element.bounds, x: element.bounds.x + placed.offset.x, y: element.bounds.y + placed.offset.y }
          : null;
      rows.push({
        index: rows.length,
        token: nodeToken({ frame: placed.frame, index: element.index }),
        role: element.role,
        name: element.name,
        value: element.value,
        enabled: element.enabled,
        selected: element.selected,
        bounds: shifted,
        textBounds: null,
        depth,
        actions: [],
      });
    }
  }
  return rows;
}

/**
 * The iframe element in the parent that owns a child frame, matched by src,
 * then by name, then as the only iframe there is. Its bounds (plus the
 * parent's own offset) are where the child's coordinates start. Null when
 * nothing in the parent matches.
 */
export function frameOwner(
  parent: FrameSnapshot,
  child: { url: string; name: string },
): SnapshotElement | null {
  const owners = parent.elements.filter((element) => element.role === 'iframe' && element.bounds);
  return (
    owners.find((element) => element.src && sameUrl(element.src, child.url)) ??
    owners.find((element) => element.frameName && element.frameName === child.name) ??
    (owners.length === 1 ? owners[0]! : null)
  );
}

function sameUrl(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const left = new URL(a, 'https://placeholder.invalid');
    const right = new URL(b, 'https://placeholder.invalid');
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
}
