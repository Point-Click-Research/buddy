// Files sent with a chat message: what the composer refuses and why, what
// main lets through from IPC, and the blocks the model gets.

import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, attachmentProblem } from '../src/shared/attachments';
import { attachmentBlocks, attachmentChips, attachmentDrafts, attachmentOnlyAsk } from '../src/main/session/attachments';

const MB = 1024 * 1024;

describe('attachmentProblem', () => {
  it('takes photos and PDFs within the limits', () => {
    expect(attachmentProblem({ type: 'image/png', size: 3 * MB, name: 'shot.png' }, 0)).toBeNull();
    expect(attachmentProblem({ type: 'application/pdf', size: 5 * MB, name: 'lease.pdf' }, 2)).toBeNull();
  });

  it('says why a file cannot go, in plain words', () => {
    expect(attachmentProblem({ type: 'text/csv', size: 10, name: 'data.csv' }, 0)).toMatch(/not CSV files/);
    expect(attachmentProblem({ type: 'image/jpeg', size: 25 * MB, name: 'big.jpg' }, 0)).toMatch(/over 20 MB/);
    expect(attachmentProblem({ type: 'image/jpeg', size: 10, name: 'x.jpg' }, ATTACHMENT_LIMITS.count)).toMatch(/Up to 10/);
  });
});

describe('attachmentDrafts', () => {
  it('keeps well-formed drafts and drops the rest, never trusting the shape', () => {
    const drafts = attachmentDrafts([
      { kind: 'image', name: 'a.jpg', mediaType: 'image/jpeg', base64: 'QUJD', thumb: 'data:image/jpeg;base64,QUJD' },
      { kind: 'pdf', name: '', mediaType: 'application/pdf', base64: 'QUJD', thumb: 'javascript:alert(1)' },
      { kind: 'image', name: 'evil.exe', mediaType: 'application/x-msdownload', base64: 'QUJD' },
      'nonsense',
    ]);
    expect(drafts).toEqual([
      { kind: 'image', name: 'a.jpg', mediaType: 'image/jpeg', base64: 'QUJD', thumb: 'data:image/jpeg;base64,QUJD' },
      { kind: 'pdf', name: 'document.pdf', mediaType: 'application/pdf', base64: 'QUJD' },
    ]);
    expect(attachmentDrafts('no')).toEqual([]);
  });

  it('builds a labelled block per file, and chips without the bytes', () => {
    const drafts = attachmentDrafts([
      { kind: 'image', name: 'receipt.jpg', mediaType: 'image/jpeg', base64: 'QUJD', thumb: 'data:image/jpeg;base64,QUJD' },
      { kind: 'pdf', name: 'lease.pdf', mediaType: 'application/pdf', base64: 'REVG' },
    ]);
    expect(attachmentBlocks(drafts)).toEqual([
      { type: 'text', text: 'Attached: receipt.jpg' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'text', text: 'Attached: lease.pdf' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'REVG' }, title: 'lease.pdf' },
    ]);
    expect(attachmentChips(drafts)).toEqual([
      { kind: 'image', name: 'receipt.jpg', thumb: 'data:image/jpeg;base64,QUJD' },
      { kind: 'pdf', name: 'lease.pdf' },
    ]);
    expect(attachmentOnlyAsk(drafts)).toBe('Take a look at these.');
  });
});
