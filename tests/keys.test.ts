import { describe, expect, it } from 'vitest';
import { formatCombo, parseKeyCombo } from '../src/main/computer/keys';

/** What the nut.js driver is handed, so the old combo expectations still hold. */
function combo(input: string): string | null {
  const parsed = parseKeyCombo(input);
  return parsed ? formatCombo(parsed) : null;
}

describe('parseKeyCombo', () => {
  it('accepts the xdotool-style names the model tends to send', () => {
    expect(combo('Return')).toBe('enter');
    expect(combo('ctrl+s')).toBe('ctrl+s');
    expect(combo('super+shift+T')).toBe('cmd+shift+t');
    expect(combo('Page_Down')).toBe('pagedown');
    expect(combo('alt+Tab')).toBe('alt+tab');
    expect(combo('BACK_SPACE')).toBe('backspace');
  });

  it('separates modifiers from the one key', () => {
    expect(parseKeyCombo('cmd+shift+t')).toEqual({ modifiers: ['cmd', 'shift'], key: 't' });
    expect(parseKeyCombo('escape')).toEqual({ modifiers: [], key: 'escape' });
  });

  it('orders modifiers the same way however they were written', () => {
    expect(combo('shift+cmd+k')).toBe('cmd+shift+k');
    expect(combo('cmd+shift+k')).toBe('cmd+shift+k');
  });

  it('ignores a repeated modifier', () => {
    expect(parseKeyCombo('ctrl+control+a')).toEqual({ modifiers: ['ctrl'], key: 'a' });
  });

  it('rejects combos no driver can express', () => {
    expect(parseKeyCombo('')).toBeNull();
    expect(parseKeyCombo('cmd')).toBeNull(); // modifiers alone are not a press
    expect(parseKeyCombo('cmd+shift')).toBeNull();
    expect(parseKeyCombo('a+b')).toBeNull(); // two real keys
  });
});
