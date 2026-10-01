import { describe, expect, it } from 'vitest';
import { approvalReply, plainText, sameHandle, textFromAttributedBody } from '../src/main/texts/parse';

/** An attributedBody shaped like chat.db's: archive noise, NSString, header, length, text, trailing attributes. */
function archived(text: string): string {
  const words = Buffer.from(text, 'utf8');
  const length =
    words.length < 0x80
      ? Buffer.from([words.length])
      : Buffer.from([0x81, words.length & 0xff, words.length >> 8]);
  return Buffer.concat([
    Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08', 'latin1'),
    Buffer.from('NSString'),
    Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]),
    length,
    words,
    Buffer.from('\x86\x84\x02iI\x01\x05\x92\x84\x84\x84\x0cNSDictionary', 'latin1'),
  ]).toString('hex');
}

describe('sameHandle', () => {
  it('matches phone numbers across country code and formatting', () => {
    expect(sameHandle('+15551234567', '(555) 123-4567')).toBe(true);
    expect(sameHandle('+1 555 123 4567', '5551234567')).toBe(true);
    expect(sameHandle('+15551234567', '+15551234568')).toBe(false);
  });

  it('matches emails case-insensitively, never against a phone', () => {
    expect(sameHandle('Me@iCloud.com', ' me@icloud.com ')).toBe(true);
    expect(sameHandle('me@icloud.com', '+15551234567')).toBe(false);
  });

  it('never matches an empty handle', () => {
    expect(sameHandle('', '')).toBe(false);
    expect(sameHandle('abc', 'xyz')).toBe(false);
  });
});

describe('textFromAttributedBody', () => {
  it('reads a short message', () => {
    expect(textFromAttributedBody(archived('find me a cast iron pan'))).toBe('find me a cast iron pan');
  });

  it('reads a message past 127 bytes (two-byte length)', () => {
    const long = 'a'.repeat(300);
    expect(textFromAttributedBody(archived(long))).toBe(long);
  });

  it('keeps multi-byte characters whole', () => {
    expect(textFromAttributedBody(archived('café ☕ at 7?'))).toBe('café ☕ at 7?');
  });

  it('returns empty for a body with no string', () => {
    expect(textFromAttributedBody('')).toBe('');
    expect(textFromAttributedBody(Buffer.from('nothing here').toString('hex'))).toBe('');
  });
});

describe('approvalReply', () => {
  it('reads yes, always, and no in their common forms', () => {
    expect(approvalReply('YES')).toBe('once');
    expect(approvalReply('ok!')).toBe('once');
    expect(approvalReply('Always')).toBe('always');
    expect(approvalReply('no.')).toBe('deny');
    expect(approvalReply("don't")).toBe('deny');
  });

  it('treats anything longer as a new ask', () => {
    expect(approvalReply('yes but make it Tuesday')).toBeNull();
    expect(approvalReply('find a hotel in Boston')).toBeNull();
  });
});

describe('plainText', () => {
  it('drops bold, italic, and heading marks that iMessage would show literally', () => {
    expect(plainText('**Nothing needs a reply.** Went through the inbox.')).toBe('Nothing needs a reply. Went through the inbox.');
    expect(plainText('## Brief\n- **BofA**: account is *negative*')).toBe('Brief\n- BofA: account is negative');
  });

  it('leaves lists, links, and lone asterisks alone', () => {
    const text = '- Old Navy shipped\n- https://example.com/a_b_c\n5 * 3 = 15';
    expect(plainText(text)).toBe(text);
  });
});
