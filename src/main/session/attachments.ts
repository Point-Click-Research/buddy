// Files sent with a chat message, on the main side: what arrived over IPC
// is checked against the limits (the renderer already shrank the images),
// then becomes the model's content blocks for this turn and the chips the
// transcript keeps.

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages';
import { ATTACHMENT_LIMITS, attachmentKind, type Attachment, type AttachmentDraft } from '../../shared/attachments';

/** The drafts as the renderer sent them, dropping anything malformed or over the limits; never trusted as typed. */
export function attachmentDrafts(raw: unknown): AttachmentDraft[] {
  if (!Array.isArray(raw)) return [];
  const drafts: AttachmentDraft[] = [];
  for (const item of raw.slice(0, ATTACHMENT_LIMITS.count)) {
    const record = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
    const mediaType = typeof record.mediaType === 'string' ? record.mediaType : '';
    const kind = attachmentKind(mediaType);
    const base64 = typeof record.base64 === 'string' ? record.base64 : '';
    if (!kind || !base64) continue;
    const bytes = (base64.length * 3) / 4;
    if (bytes > (kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.pdfBytes)) continue;
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : kind === 'image' ? 'photo' : 'document.pdf';
    const thumb = kind === 'image' && typeof record.thumb === 'string' && record.thumb.startsWith('data:image/') ? record.thumb : undefined;
    drafts.push({ kind, name, mediaType, base64, ...(thumb ? { thumb } : {}) });
  }
  return drafts;
}

/** One labelled block per file, so the model can tell "the receipt" from "the menu". */
export function attachmentBlocks(drafts: AttachmentDraft[]): ContentBlockParam[] {
  return drafts.flatMap((draft): ContentBlockParam[] => [
    { type: 'text', text: `Attached: ${draft.name}` },
    draft.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: draft.mediaType as 'image/jpeg', data: draft.base64 } }
      : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: draft.base64 }, title: draft.name },
  ]);
}

/** The chips: the bytes stay behind, the preview and name go on. */
export function attachmentChips(drafts: AttachmentDraft[]): Attachment[] {
  return drafts.map(({ kind, name, thumb }) => ({ kind, name, ...(thumb ? { thumb } : {}) }));
}

/** How the files that came with this message can be passed on, by name. */
export function attachmentsNote(names: string[]): string {
  const one = names.length === 1;
  return `The user sent ${one ? 'a file' : 'files'} with this message: ${names.join(', ')}. To forward ${one ? 'it' : 'one'}, pass its exact name in the attachments argument of send_message, the mail draft, or use_app (for an app tool that takes a file, like Gmail send). A file already on this Mac goes the same way, named by its path ("~/Desktop/ui-click.mp3"). Never say you cannot attach files.`;
}

/** What a message with files and no words is asking. */
export function attachmentOnlyAsk(drafts: AttachmentDraft[]): string {
  return drafts.length === 1 ? 'Take a look at this.' : 'Take a look at these.';
}
