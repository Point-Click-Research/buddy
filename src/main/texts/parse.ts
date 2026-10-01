// The pure pieces of the iMessage bridge: whose text it is, what it says,
// and whether it answers the approval Buddy texted about.

import { withoutEmDash } from '../../shared/em-dash';
import type { ApprovalDecision } from '../jobs/approvals';

/**
 * Markdown read as a text: bold and italic markers and heading marks come
 * off, since iMessage shows them as literal asterisks and hashes, and no
 * em dash ever goes out. Lists and links read fine as they are.
 */
export function plainText(text: string): string {
  return withoutEmDash(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2');
}

/** Phone handles compare by their last ten digits (country code and formatting vary); emails case-insensitively. */
export function sameHandle(a: string, b: string): boolean {
  const key = (handle: string): string => {
    const trimmed = handle.trim().toLowerCase();
    return trimmed.includes('@') ? trimmed : trimmed.replace(/\D/g, '').slice(-10);
  };
  const left = key(a);
  return left !== '' && left === key(b);
}

const NSSTRING = Buffer.from('NSString');
/** The typedstream bytes between the class name and the string's length. */
const NSSTRING_HEADER = 5;

/**
 * Recent macOS leaves `message.text` empty and keeps the words in
 * `attributedBody`, an archived NSAttributedString. Its plain string follows
 * the first NSString marker, length-prefixed: one byte, or 0x81 then a
 * 16-bit length, or 0x82 then a 32-bit one (little-endian).
 */
export function textFromAttributedBody(hex: string): string {
  const body = Buffer.from(hex, 'hex');
  const marker = body.indexOf(NSSTRING);
  if (marker < 0) return '';
  let cursor = marker + NSSTRING.length + NSSTRING_HEADER;
  const lead = body[cursor];
  let length: number;
  if (lead === 0x81 && cursor + 3 <= body.length) {
    length = body.readUInt16LE(cursor + 1);
    cursor += 3;
  } else if (lead === 0x82 && cursor + 5 <= body.length) {
    length = body.readUInt32LE(cursor + 1);
    cursor += 5;
  } else {
    length = lead ?? 0;
    cursor += 1;
  }
  return body.subarray(cursor, cursor + length).toString('utf8').trim();
}

/**
 * A whole-message answer to a texted approval, or null. Only an exact word
 * counts: "yes but make it Tuesday" is a new ask, not a yes.
 */
export function approvalReply(text: string): ApprovalDecision | null {
  const word = text.trim().toLowerCase().replace(/[.!\s]+$/, '');
  if (word === 'always' || word === 'always allow') return 'always';
  if (/^(yes|y|yep|yeah|ok|okay|allow|approve|do it)$/.test(word)) return 'once';
  if (/^(no|n|nope|deny|skip|cancel|don'?t)$/.test(word)) return 'deny';
  return null;
}
