import { describe, expect, it } from 'vitest';
import { browserFamily, browserUrlScript } from '../src/main/reader/frontmost';

// Browsers publish no accessibility tree, so this also decides whether the
// selection has to be read by copying it.
describe('browserFamily', () => {
  it('recognises Safari and Chromium forks by bundle id', () => {
    expect(browserFamily({ name: 'Safari', bundleId: 'com.apple.Safari' })).toBe('safari');
    expect(browserFamily({ name: 'Dia', bundleId: 'company.thebrowser.dia' })).toBe('chromium');
    expect(browserFamily({ name: 'Arc', bundleId: 'company.thebrowser.Browser' })).toBe('chromium');
  });

  it('is null for everything that is not a browser', () => {
    expect(browserFamily({ name: 'Cursor', bundleId: 'com.todesktop.230313mzl4w4u92' })).toBeNull();
    expect(browserFamily({ name: 'TextEdit', bundleId: 'com.apple.TextEdit' })).toBeNull();
  });
});

describe('browserUrlScript', () => {
  it('uses current tab for Safari and active tab for Chromium', () => {
    expect(browserUrlScript({ name: 'Safari', bundleId: 'com.apple.Safari' })).toContain(
      'current tab',
    );
    expect(browserUrlScript({ name: 'Dia', bundleId: 'company.thebrowser.dia' })).toContain(
      'active tab',
    );
  });

  it('addresses the app by bundle id', () => {
    expect(browserUrlScript({ name: 'Dia', bundleId: 'company.thebrowser.dia' })).toContain(
      'application id "company.thebrowser.dia"',
    );
  });

  // A Chromium fork can report Chrome's process name. Targeting by name would
  // script (and launch) the real Chrome instead of the window in front.
  it('never targets by name when a bundle id says otherwise', () => {
    const script = browserUrlScript({ name: 'Google Chrome', bundleId: 'company.thebrowser.dia' });
    expect(script).toContain('company.thebrowser.dia');
    expect(script).not.toContain('application "Google Chrome"');
  });

  it('falls back to the name only when there is no bundle id', () => {
    expect(browserUrlScript({ name: 'Arc', bundleId: '' })).toContain('application "Arc"');
  });

  it('returns null for apps that are not browsers', () => {
    expect(browserUrlScript({ name: 'TextEdit', bundleId: 'com.apple.TextEdit' })).toBeNull();
    expect(browserUrlScript({ name: '', bundleId: '' })).toBeNull();
  });
});
