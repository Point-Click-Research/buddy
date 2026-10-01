// Which uiohook keycode each key produces. Every provider declares the keys
// it is about to synthesize through this table, so safety.ts can tell
// Buddy's own keystrokes from the user's. Without it the kill switch fires
// on the agent's own Escape and typing reads as the user taking over.

import { UiohookKey } from 'uiohook-napi';
import { canonicalKeyName } from './keys';

const CODES: Record<string, number> = {
  cmd: UiohookKey.Meta,
  ctrl: UiohookKey.Ctrl,
  alt: UiohookKey.Alt,
  shift: UiohookKey.Shift,
  enter: UiohookKey.Enter,
  tab: UiohookKey.Tab,
  escape: UiohookKey.Escape,
  space: UiohookKey.Space,
  backspace: UiohookKey.Backspace,
  delete: UiohookKey.Delete,
  up: UiohookKey.ArrowUp,
  down: UiohookKey.ArrowDown,
  left: UiohookKey.ArrowLeft,
  right: UiohookKey.ArrowRight,
  home: UiohookKey.Home,
  end: UiohookKey.End,
  pageup: UiohookKey.PageUp,
  pagedown: UiohookKey.PageDown,
  minus: UiohookKey.Minus,
  equal: UiohookKey.Equal,
  comma: UiohookKey.Comma,
  period: UiohookKey.Period,
  slash: UiohookKey.Slash,
  backslash: UiohookKey.Backslash,
  semicolon: UiohookKey.Semicolon,
  quote: UiohookKey.Quote,
  grave: UiohookKey.Backquote,
};

for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(97 + i); // a..z
  CODES[letter] = UiohookKey[letter.toUpperCase() as 'A'];
}
for (let digit = 0; digit <= 9; digit++) {
  CODES[String(digit)] = UiohookKey[String(digit) as '0'];
}
for (let f = 1; f <= 12; f++) {
  CODES[`f${f}`] = UiohookKey[`F${f}` as 'F1'];
}

/** The keycode a key name produces, or undefined if we can't predict it. */
export function uiohookCodeFor(name: string): number | undefined {
  return CODES[canonicalKeyName(name)];
}
