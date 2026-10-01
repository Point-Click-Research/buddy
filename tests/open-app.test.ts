import { describe, expect, it } from 'vitest';
import { isExcludedAppName, resolveAppName } from '../src/main/agent/open-app';

describe('resolveAppName', () => {
  it('maps iMessage/messages onto Messages', () => {
    expect(resolveAppName('iMessage')).toBe('Messages');
    expect(resolveAppName('imessage')).toBe('Messages');
    expect(resolveAppName('Messages')).toBe('Messages');
  });

  it('keeps unknown names as the user typed them', () => {
    expect(resolveAppName('  Blender  ')).toBe('Blender');
    expect(resolveAppName('"Notes"')).toBe('Notes');
  });

  it('returns empty for blank input', () => {
    expect(resolveAppName('   ')).toBe('');
  });
});

describe('isExcludedAppName', () => {
  it('matches against the excluded list', () => {
    expect(isExcludedAppName('1Password', ['1Password', 'Chase'])).toBe(true);
    expect(isExcludedAppName('Notes', ['1Password'])).toBe(false);
  });
});
