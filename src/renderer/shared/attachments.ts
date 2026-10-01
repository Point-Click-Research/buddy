// A file from the picker, a paste, or a drop, made ready to send: images
// are shrunk to what the model reads at (a 12 MB phone photo becomes a few
// hundred KB) and get a small preview for their chip; a PDF goes as it is.

import {
  ATTACHMENT_LIMITS,
  attachmentKind,
  attachmentProblem,
  type AttachmentDraft,
} from '../../shared/attachments';

/** The draft, or the reason the file cannot be sent. */
export async function prepareAttachment(
  file: File,
  count: number,
): Promise<{ draft: AttachmentDraft } | { problem: string }> {
  const problem = attachmentProblem(file, count);
  if (problem) return { problem };
  const kind = attachmentKind(file.type)!;
  if (kind === 'pdf') {
    return { draft: { kind, name: file.name, mediaType: file.type, base64: await toBase64(await file.arrayBuffer()) } };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const [sent, thumb] = await Promise.all([
      shrink(bitmap, ATTACHMENT_LIMITS.imageEdge, 0.85),
      shrink(bitmap, ATTACHMENT_LIMITS.thumbEdge, 0.7),
    ]);
    bitmap.close();
    return {
      draft: { kind, name: file.name || 'photo.jpg', mediaType: 'image/jpeg', base64: sent.split(',')[1]!, thumb },
    };
  } catch {
    return { problem: `${file.name} could not be read as a photo.` };
  }
}

/** The image fit inside `edge` on its longest side, as a JPEG data URL. Smaller images are left their size. */
async function shrink(bitmap: ImageBitmap, edge: number, quality: number): Promise<string> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const context = canvas.getContext('2d')!;
  // A transparent PNG on a JPEG's black would lose its dark lines.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return `data:image/jpeg;base64,${await toBase64(await blob.arrayBuffer())}`;
}

function toBase64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([buffer]));
  });
}

/** The files in a paste or a drop. Anything Buddy cannot take is kept so the user hears why. */
export function droppedFiles(transfer: DataTransfer | null): File[] {
  return transfer ? [...transfer.files] : [];
}
