import { createCipheriv, createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ session: {}, app: { getPath: () => '/tmp' } }));
vi.mock('../src/main/browser/window', () => ({ BROWSER_PARTITION: 'persist:test' }));

const { decryptCookie, deriveCookieKey } = await import('../src/main/browser/logins');

/** A cookie value encrypted the way Chromium does on macOS. */
function chromiumEncrypt(plain: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()]);
}

describe('Chromium cookie decryption', () => {
  const key = deriveCookieKey('keychain-secret');

  it('reads a v10 value from an older database', () => {
    expect(decryptCookie(chromiumEncrypt(Buffer.from('session=abc'), key), key, 23)).toBe('session=abc');
  });

  it('drops the host hash newer databases put in front of the value', () => {
    const hashed = Buffer.concat([createHash('sha256').update('.amazon.com').digest(), Buffer.from('token')]);
    expect(decryptCookie(chromiumEncrypt(hashed, key), key, 24)).toBe('token');
  });

  it('gives up on a wrong key or an unknown scheme instead of writing junk', () => {
    const sealed = chromiumEncrypt(Buffer.from('x'.repeat(40)), key);
    expect(decryptCookie(sealed, deriveCookieKey('other'), 23)).toBeNull();
    expect(decryptCookie(Buffer.from('v20whatever'), key, 24)).toBeNull();
  });
});
