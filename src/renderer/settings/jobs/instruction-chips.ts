// The job instructions field's DOM: text drawn with inline cards for the
// apps and tools it names and dashed blanks for the user to fill, and read
// back to the stored text (see shared/instructions.ts). A card is one
// uneditable node carrying its own token, so the caret steps over it and a
// backspace takes it whole.

import { CONNECT_APPS } from '../../../shared/connect-apps';
import { parseInstructions, type InstructionPart, type RefSource } from '../../../shared/instructions';
import { mountSiteIcon } from '../../ui/SiteIcon';

/** Something the slash menu can put into the instructions. */
export interface RefOption {
  source: RefSource;
  id: string;
  label: string;
  /** Where its icon comes from. */
  host: string;
  description: string;
}

// Inline blocks, so a card's own text sits on the sentence's baseline; only
// the icon is nudged to centre on it.
const CHIP_CLASS =
  'mx-px inline-block rounded-md border border-line bg-wash px-1.5 text-[12px] font-medium leading-5 whitespace-nowrap text-ink select-none';
// data-armed: picked and waiting for words; it stays until they arrive.
const BLANK_CLASS =
  'mx-px inline-block cursor-text rounded-md border border-dashed border-focus px-1.5 text-[12px] leading-5 whitespace-nowrap text-faint select-none transition-colors duration-150 hover:border-muted hover:text-ink data-armed:border-solid data-armed:border-ink data-armed:bg-wash data-armed:text-ink';
const ICON_CLASS = 'mr-1 size-3.5 align-[-2.5px]';

/** A card's icon: the option it came from, else the app's own site; Mac tools are Apple's. */
function refHost(source: RefSource, id: string, options: readonly RefOption[]): string {
  const known = options.find((option) => option.source === source && option.id === id)?.host;
  if (known) return known;
  if (source === 'app') return CONNECT_APPS.find((app) => app.slug === id)?.host ?? id;
  if (source === 'site') return id;
  return source === 'tool' ? 'apple.com' : id;
}

export function chipNode(part: Exclude<InstructionPart, { kind: 'text' }>, options: readonly RefOption[]): HTMLElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.token = part.raw;
  if (part.kind === 'blank') {
    chip.dataset.blank = '';
    chip.className = BLANK_CLASS;
    chip.title = 'Click, then type to fill in';
    chip.textContent = part.hint;
    return chip;
  }
  chip.className = CHIP_CLASS;
  chip.append(mountSiteIcon(refHost(part.source, part.id, options), ICON_CLASS), document.createTextNode(part.label));
  return chip;
}

export function paint(root: HTMLElement, text: string, options: readonly RefOption[]): void {
  const frag = document.createDocumentFragment();
  for (const part of parseInstructions(text)) {
    frag.append(part.kind === 'text' ? document.createTextNode(part.text) : chipNode(part, options));
  }
  root.replaceChildren(frag);
}

/** The field as stored text: each card back to its token, line breaks to newlines. */
export function serialize(root: HTMLElement): string {
  let text = '';
  const visit = (parent: Node): void => {
    for (const child of parent.childNodes) {
      if (child instanceof HTMLElement && child.dataset.token !== undefined) {
        text += child.dataset.token;
      } else if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
      } else if (child instanceof HTMLBRElement) {
        text += '\n';
      } else if (child instanceof HTMLDivElement || child instanceof HTMLParagraphElement) {
        if (text && !text.endsWith('\n')) text += '\n';
        visit(child);
      } else if (child instanceof HTMLElement) {
        visit(child);
      }
    }
  };
  visit(root);
  return text.replace(/\u00a0/g, ' ');
}

/** Put the caret at the very end of the field. */
export function caretToEnd(root: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
