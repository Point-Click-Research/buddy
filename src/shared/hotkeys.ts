// The chord model behind every global hotkey: hold-to-talk, the "do this"
// agent chord, and the always-on toggle. A chord is one or more modifiers
// plus at most one ordinary key ("Control+Alt", "Control+Alt+Space").
//
// Pure module shared by main (uiohook matching) and the renderers (the
// preset menus, the onboarding keycaps), so every side agrees on what a
// valid chord is.

export const CHORD_MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta'] as const;
export type ChordModifier = (typeof CHORD_MODIFIERS)[number];

const MODIFIER_SET = new Set<string>(CHORD_MODIFIERS);

/** A parsed chord: which modifiers, and the one ordinary key if any. */
export interface Chord {
  modifiers: ChordModifier[];
  /** Canonical lowercase key name ("space", "a", "f6"), or null. */
  key: string | null;
}

/**
 * Ordinary keys a chord may include. Letters, digits, F-keys, and the
 * punctuation the global listener can identify. Escape and Enter are out:
 * they already mean stop and approve everywhere in Buddy.
 */
const NAMED_KEYS = new Set([
  'space',
  'tab',
  'up',
  'down',
  'left',
  'right',
  'minus',
  'equal',
  'comma',
  'period',
  'slash',
  'backslash',
  'semicolon',
  'quote',
  'grave',
]);

function isChordKey(name: string): boolean {
  return (
    /^[a-z]$/.test(name) ||
    /^[0-9]$/.test(name) ||
    /^f([1-9]|1[0-2])$/.test(name) ||
    NAMED_KEYS.has(name)
  );
}

/** Parse a stored chord string; null when it isn't one this app can hold. */
export function parseChord(text: string): Chord | null {
  const parts = text
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<ChordModifier>();
  let key: string | null = null;
  for (const part of parts) {
    if (MODIFIER_SET.has(part)) {
      modifiers.add(part as ChordModifier);
      continue;
    }
    const name = part.toLowerCase();
    if (!isChordKey(name) || key !== null) return null;
    key = name;
  }
  if (modifiers.size === 0) return null;
  return { modifiers: CHORD_MODIFIERS.filter((m) => modifiers.has(m)), key };
}

/** The canonical stored spelling: modifiers in fixed order, then the key. */
export function formatChord(chord: Chord): string {
  return [...chord.modifiers, ...(chord.key ? [chord.key] : [])].join('+');
}

/**
 * Why this chord can't be a hotkey, or null when it can. A modifier-only
 * chord needs two modifiers — a single held Control would swallow every
 * ordinary shortcut. `requireKey` is for the always-on toggle, which fires
 * on press rather than hold and so must not be a bare modifier pair.
 */
export function chordError(text: string, options: { requireKey?: boolean } = {}): string | null {
  const chord = parseChord(text);
  if (!chord) return 'Start with a modifier (⌃ ⌥ ⇧ ⌘), then at most one other key, like ⌃⌥ or ⌃⌥A.';
  if (options.requireKey && !chord.key) {
    return 'This one fires on press, so add a letter, number, or F-key after the modifiers, like ⌃⌥A.';
  }
  if (!chord.key && chord.modifiers.length < 2) {
    return `${chordLabel(text)} alone would fire on every ordinary shortcut. Hold a second modifier too, or add a key.`;
  }
  return null;
}

/** The Mac's glyph for each modifier, as printed on its keycap. */
export const MAC_SYMBOLS: Record<ChordModifier, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  minus: '-',
  equal: '=',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  grave: '`',
};

/** "Control+Alt+space" -> "⌃⌥Space", for buttons and menus. */
export function chordLabel(text: string): string {
  const chord = parseChord(text);
  if (!chord) return text;
  const mods = chord.modifiers.map((m) => MAC_SYMBOLS[m]).join('');
  if (!chord.key) return mods;
  return mods + (KEY_LABELS[chord.key] ?? chord.key.toUpperCase());
}

/** The empty type field, in the composer and the Type to Buddy box. */
export function typePlaceholder(chord: string): string {
  const talk = chord ? chordLabel(chord) : '';
  return `Hold ${talk ? `${talk} ` : ''}to talk, or type…`;
}

/** A DOM KeyboardEvent.code ("ControlLeft") -> the chord modifier it is. Null for any other key. */
export function modifierFromCode(code: string): ChordModifier | null {
  const match = /^(Control|Alt|Shift|Meta)(?:Left|Right)$/.exec(code);
  return match ? (match[1] as ChordModifier) : null;
}
