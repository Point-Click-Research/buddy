import { describe, expect, it } from 'vitest';
import { providerAccess } from '../src/shared/provider-access';

describe('providerAccess', () => {
  const signedIn = { signedIn: true, managed: ['openrouter'] };

  it("treats Buddy's keys and a saved key as ready", () => {
    expect(providerAccess(signedIn, false, 'openrouter')).toBe('ready');
    expect(providerAccess(signedIn, true, 'elevenlabs')).toBe('ready');
  });

  it('asks for a key whenever Buddy cannot serve the provider', () => {
    expect(providerAccess(signedIn, false, 'elevenlabs')).toBe('add');
    expect(providerAccess({ signedIn: false, managed: [] }, false, 'openrouter')).toBe('add');
  });

  it('waits while the account is unknown', () => {
    expect(providerAccess(null, false, 'openrouter')).toBe('pending');
  });
});
