// Parsing the model's key combos into a canonical modifier list plus one
// key, so each provider can spell them its own way. The model sends
// xdotool-style names ("Return", "Page_Down", "super"), so those are
// accepted alongside the plain ones. Pure module: fully unit-testable.

export interface KeyCombo {
  /** Canonical modifiers in a stable order: cmd, ctrl, alt, shift. */
  modifiers: string[];
  /** The single non-modifier key. */
  key: string;
}

const MODIFIER_ORDER = ['cmd', 'ctrl', 'alt', 'shift'] as const;
const MODIFIERS = new Set<string>(MODIFIER_ORDER);

/** Anything the model might send -> the canonical name. */
const ALIASES: Record<string, string> = {
  // Modifiers
  command: 'cmd',
  meta: 'cmd',
  super: 'cmd',
  super_l: 'cmd',
  super_r: 'cmd',
  win: 'cmd',
  control: 'ctrl',
  option: 'alt',
  // Keys
  return: 'enter',
  kp_enter: 'enter',
  back_space: 'backspace',
  del: 'delete',
  esc: 'escape',
  page_down: 'pagedown',
  next: 'pagedown',
  page_up: 'pageup',
  prior: 'pageup',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
};

/** One spelling for a key, whatever the model or a driver called it. */
export function canonicalKeyName(name: string): string {
  const lower = name.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}

/**
 * Split a combo like "ctrl+s", "Return" or "super+shift+T" into modifiers
 * and one key. Returns null when the combo is empty or names more than one
 * non-modifier key, which the drivers can't express anyway.
 */
export function parseKeyCombo(combo: string): KeyCombo | null {
  const parts = combo.split('+').map(canonicalKeyName).filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    if (MODIFIERS.has(part)) {
      modifiers.add(part);
    } else if (key) {
      return null; // two non-modifier keys: not a combo
    } else {
      key = part;
    }
  }
  if (!key) return null; // modifiers alone are not a key press
  return { modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)), key };
}

/** The "cmd+shift+t" spelling the nut.js driver takes. */
export function formatCombo(parsed: KeyCombo): string {
  return [...parsed.modifiers, parsed.key].join('+');
}
