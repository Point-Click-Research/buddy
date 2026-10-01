// The files on a message, as chips: a photo shows its preview, a PDF its
// name. In the composer each has an × to take it back; on a sent message
// they are just there.

import { FileText, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { Attachment } from '../../shared/attachments';

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: readonly Attachment[];
  /** Offered in the composer; a sent message's chips have none. */
  onRemove?: (index: number) => void;
}): ReactElement {
  return (
    <div className={`flex flex-wrap gap-2 ${onRemove ? 'px-3 pb-2' : 'mb-1.5'}`}>
      {attachments.map((attachment, index) => (
        <span
          key={`${attachment.name}-${index}`}
          title={attachment.name}
          className="group/chip relative flex h-14 max-w-48 items-center gap-2 overflow-hidden rounded-sm bg-chip shadow-button-secondary"
        >
          {attachment.kind === 'image' && attachment.thumb ? (
            <img src={attachment.thumb} alt="" draggable={false} className="size-14 object-cover" />
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center text-muted">
              <FileText className="size-5" strokeWidth={1.6} aria-hidden />
            </span>
          )}
          {attachment.kind === 'pdf' && (
            <span className="min-w-0 truncate pr-3 text-[12px] font-medium text-ink">{attachment.name}</span>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              onClick={() => onRemove(index)}
              className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-full border-0 bg-ink/80 text-on-ink opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
