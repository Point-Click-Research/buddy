// The chat composer: hold-to-talk beside a field that grows with the draft,
// then scrolls once it hits the cap. Enter sends; Shift+Enter is a newline.
// The field is contenteditable so a link can show its icon inline, which a
// textarea cannot do. React does not own the field's contents. Photos and
// PDFs come in by the paperclip, a paste, or a drop, and wait as chips
// above the footer until the message goes.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type InputEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { ACCEPTED_TYPES, type AttachmentDraft } from '../../shared/attachments';
import { typePlaceholder } from '../../shared/hotkeys';
import { linkHost } from '../../shared/link-text';
import { splitBareLinks } from '../shared/markdown';
import { buddy } from '../buddy';
import { mountSiteIcon } from '../ui/SiteIcon';
import { getTalkState, subscribeTalk } from '../shared/talk';
import { droppedFiles, prepareAttachment } from '../shared/attachments';
import { AttachmentChips } from './AttachmentChips';
import { ArrowUp, Paperclip } from 'lucide-react';

/** How long a "can't send that" line stays up. */
const PROBLEM_MS = 4_000;

const ICON_CLASS = 'mr-1.5 align-middle select-none';

export interface ComposerField {
  focus(): void;
}

export function Composer({
  draft,
  onDraft,
  area,
  conversationId,
  busy,
  autoFocus = false,
  glow = false,
}: {
  draft: string;
  onDraft: (text: string) => void;
  /** The field itself, so the sidebar's New Chat click can hand it focus. */
  area: RefObject<ComposerField | null>;
  conversationId: string | null;
  busy: boolean;
  /** New Chat empty state — the field is why this view exists. */
  autoFocus?: boolean;
  /** Spectral light above the field. Lives on the field so it moves with it. */
  glow?: boolean;
}): ReactElement {
  const editor = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const caret = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [problem, setProblem] = useState('');
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!problem) return;
    const timer = setTimeout(() => setProblem(''), PROBLEM_MS);
    return () => clearTimeout(timer);
  }, [problem]);

  /** Files from the picker, a paste, or a drop: each becomes a chip, or a line saying why not. */
  const addFiles = async (files: File[]): Promise<void> => {
    let count = attachments.length;
    for (const file of files) {
      const outcome = await prepareAttachment(file, count);
      if ('problem' in outcome) {
        setProblem(outcome.problem);
        continue;
      }
      count += 1;
      setAttachments((current) => [...current, outcome.draft]);
    }
  };

  // Paint when the draft changes from outside (send clears it, a chip fills it).
  // Typing already painted, and the text matches, so this leaves the caret alone.
  useLayoutEffect(() => {
    const el = editor.current;
    if (!el || readText(el) === draft) return;
    paint(el, draft);
    if (document.activeElement === el) placeCaret(el, Math.min(caret.current, draft.length));
  }, [draft]);

  useLayoutEffect(() => {
    area.current = {
      focus() {
        editor.current?.focus();
      },
    };
    if (autoFocus) editor.current?.focus();
    return () => {
      area.current = null;
    };
  }, [area, autoFocus]);

  const send = (): void => {
    const text = (editor.current ? readText(editor.current) : draft).trim();
    if ((!text && attachments.length === 0) || busy) return;
    buddy.sendChatMessage(text, conversationId, attachments);
    onDraft('');
    setAttachments([]);
  };

  const syncFromDom = (): void => {
    const el = editor.current;
    if (!el || composing.current) return;
    const shot = snapshot(el);
    const text = shot.text.replace(/^\n$/, '');
    if (!text) {
      if (el.childNodes.length > 0) paint(el, '');
      onDraft('');
      return;
    }
    if (shot.caret !== null) caret.current = text === shot.text ? shot.caret : 0;
    if (shot.caret !== null && shouldDecorate(el, text)) {
      paint(el, text);
      placeCaret(el, caret.current);
    }
    onDraft(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.metaKey || event.ctrlKey) && 'biu'.includes(event.key.toLowerCase())) {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    send();
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault();
    // A copied screenshot or photo pastes as a file, not words.
    const files = droppedFiles(event.clipboardData);
    if (files.length > 0) {
      void addFiles(files);
      return;
    }
    const text = event.clipboardData.getData('text/plain');
    const el = editor.current;
    if (!text || !el) return;
    if (document.execCommand('insertText', false, text)) return;
    const shot = snapshot(el);
    const at = shot.caret ?? shot.text.length;
    const next = `${shot.text.slice(0, at)}${text}${shot.text.slice(at)}`;
    paint(el, next);
    placeCaret(el, at + text.length);
    caret.current = at + text.length;
    onDraft(next);
  };

  const onInput = (event: InputEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    syncFromDom();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    void addFiles(droppedFiles(event.dataTransfer));
  };

  // The home window has no settings provider; talk already keeps the hold-to-talk chord.
  const { chord } = useSyncExternalStore(subscribeTalk, getTalkState);
  const placeholder = typePlaceholder(chord);

  const field = (
    // Card chrome, not a form control: rounded-base + border-line + raised +
    // shadow-card matches the user bubble and the overlay cards. The field
    // itself is borderless so its padding is truly even (px-3.5 py-3); the
    // send sits in the footer row instead of overlapping the text.
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`w-full rounded-base border bg-raised shadow-card transition-colors duration-150 ${dragging ? 'border-focus' : 'border-line'}`}
    >
      <div
        ref={editor}
        role="textbox"
        aria-multiline
        aria-label="Message"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          syncFromDom();
        }}
        onFocus={() => {
          const el = editor.current;
          if (!el || readText(el).replace(/\n/g, '') !== '') return;
          el.replaceChildren();
        }}
        className="editable-field max-h-[160px] min-h-[44px] overflow-y-auto px-3.5 py-3 text-[13px] leading-5 whitespace-pre-wrap wrap-break-word text-ink outline-none"
      />
      {attachments.length > 0 && (
        <AttachmentChips
          attachments={attachments}
          onRemove={(index) => setAttachments((current) => current.filter((_, i) => i !== index))}
        />
      )}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
        <span className="min-w-0 truncate text-[11px] text-faint">
          {problem || (dragging ? 'Drop to attach' : '⏎ to send · ⇧⏎ for new line')}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <input
            ref={picker}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            hidden
            onChange={(event) => {
              void addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            aria-label="Attach a photo or PDF"
            title="Attach a photo or PDF"
            onClick={() => picker.current?.click()}
            className="flex size-7 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted transition-colors duration-150 hover:bg-wash hover:text-ink"
          >
            <Paperclip className="size-4" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={(!draft.trim() && attachments.length === 0) || busy}
            className="flex size-7 cursor-pointer items-center justify-center rounded-xs border-0 bg-ink text-on-ink hover:bg-ink-hover disabled:cursor-default disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={1.5} />
          </button>
        </span>
      </div>
    </div>
  );
  if (!glow) return field;
  return (
    <div className="composer-glow">
      {SUNRISE}
      {field}
    </div>
  );
}

/** The light over the empty composer: the outer layer blurs what the inner one masks into beams. */
const SUNRISE = (
  <div className="sunrise" aria-hidden>
    <span />
    <span />
  </div>
);

function shouldDecorate(el: HTMLElement, text: string): boolean {
  return el.querySelector('[data-icon]') !== null || splitBareLinks(text).some((part) => part.kind === 'link');
}

function readText(root: HTMLElement): string {
  return snapshot(root).text;
}

/**
 * The field's plain text and, when the caret is a single point, where it
 * sits. Browser line breaks become newlines, and the icon is not text, so
 * the count matches what paint() writes back.
 */
function snapshot(root: HTMLElement): { text: string; caret: number | null } {
  const sel = window.getSelection();
  const active = sel && sel.rangeCount > 0 && sel.isCollapsed && sel.anchorNode && root.contains(sel.anchorNode) ? sel : null;
  let text = '';
  let caret: number | null = null;
  let placed = !active;

  const visit = (parent: Node): void => {
    const children = parent.childNodes;
    for (let i = 0; i <= children.length; i++) {
      if (active && !placed && active.anchorNode === parent && active.anchorOffset === i) {
        caret = text.length;
        placed = true;
      }
      const child = children[i];
      if (!child) continue;
      if (child instanceof HTMLElement && child.dataset.icon !== undefined) {
        if (active && !placed && active.anchorNode && child.contains(active.anchorNode)) {
          caret = text.length;
          placed = true;
        }
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.textContent ?? '';
        if (active && !placed && active.anchorNode === child) {
          caret = text.length + Math.min(active.anchorOffset, value.length);
          placed = true;
        }
        text += value;
        continue;
      }
      if (child instanceof HTMLBRElement) {
        text += '\n';
        continue;
      }
      if (child instanceof HTMLDivElement || child instanceof HTMLParagraphElement) {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n';
        visit(child);
        continue;
      }
      if (child instanceof HTMLElement) visit(child);
    }
  };

  visit(root);
  if (active && !placed) caret = text.length;
  return { text, caret: active ? caret : null };
}

function paint(root: HTMLElement, text: string): void {
  if (!text) {
    root.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const part of splitBareLinks(text)) {
    if (part.kind === 'text') {
      frag.append(document.createTextNode(part.body));
      continue;
    }
    const link = document.createElement('span');
    link.className = 'text-link wrap-break-word';
    link.append(mountSiteIcon(linkHost(part.url), ICON_CLASS), document.createTextNode(part.url));
    frag.append(link);
  }
  root.replaceChildren(frag);
}

function placeCaret(root: HTMLElement, offset: number): void {
  const walker = textWalker(root);
  let left = offset;
  let current = walker.nextNode();
  let last: Node | null = null;
  while (current) {
    const len = current.textContent?.length ?? 0;
    if (left <= len) {
      setCaret(current, left);
      return;
    }
    left -= len;
    last = current;
    current = walker.nextNode();
  }
  if (last) setCaret(last, last.textContent?.length ?? 0);
}

function textWalker(root: HTMLElement): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest('[data-icon]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
}

function setCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
