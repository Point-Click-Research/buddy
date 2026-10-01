// Files sent with a chat message: what the composer accepts, the limits
// (the model API's, checked September 2026), and the two shapes a file
// takes: the bytes on their way to the model, and the chip the transcript
// keeps of it afterwards.

export type AttachmentKind = 'image' | 'pdf';

/** A file as the composer hands it to main: the bytes, ready for the model. */
export interface AttachmentDraft {
  kind: AttachmentKind;
  name: string;
  /** "image/jpeg", "application/pdf". */
  mediaType: string;
  base64: string;
  /** A small preview as a data URL; images only. Kept on the transcript's chip. */
  thumb?: string;
}

/** What the transcript keeps of an attachment: enough for its chip, never the bytes. */
export interface Attachment {
  kind: AttachmentKind;
  name: string;
  /** A small preview as a data URL; images only. */
  thumb?: string;
}

export const ATTACHMENT_LIMITS = {
  /** Files per message. The API takes far more; a chat never needs it. */
  count: 10,
  /** An image, before Buddy shrinks it. The API caps a sent image at 10 MB. */
  imageBytes: 20 * 1024 * 1024,
  /** A PDF as sent: the API's whole request must fit in 32 MB. */
  pdfBytes: 20 * 1024 * 1024,
  /** The API's page cap per request. */
  pdfPages: 100,
  /** Images are shrunk to this on their longest side: what the API reads at anyway, about 1,500 tokens. */
  imageEdge: 1568,
  /** The chip's preview. */
  thumbEdge: 160,
} as const;

/** The file types the picker offers and a paste or drop accepts. Chromium cannot decode HEIC, so iPhone photos need the JPEG the share sheet makes. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const ACCEPTED_TYPES = [...IMAGE_TYPES, 'application/pdf'].join(',');

/** The kind a file's type maps to, or null when Buddy cannot send it. */
export function attachmentKind(mediaType: string): AttachmentKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) return 'image';
  return mediaType === 'application/pdf' ? 'pdf' : null;
}

/** Why a file cannot be sent, in the user's words, or null when it can. */
export function attachmentProblem(file: { type: string; size: number; name: string }, count: number): string | null {
  const kind = attachmentKind(file.type);
  if (!kind) return `Buddy can take photos and PDFs, not ${file.name.split('.').pop()?.toUpperCase() || 'that'} files.`;
  if (count >= ATTACHMENT_LIMITS.count) return `Up to ${ATTACHMENT_LIMITS.count} files per message.`;
  const cap = kind === 'image' ? ATTACHMENT_LIMITS.imageBytes : ATTACHMENT_LIMITS.pdfBytes;
  if (file.size > cap) return `${file.name} is over ${cap / 1024 / 1024} MB.`;
  return null;
}
