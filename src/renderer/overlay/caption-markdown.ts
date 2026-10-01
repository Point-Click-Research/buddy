// The caption bubble's markdown: the shared parser rendered as DOM nodes,
// so what Buddy says looks the same by the cursor as in the chat window.
// The overlay has no React; links render as styled text because the bubble
// is click-through.
//
// While text is arriving, each new plain chunk is its own span that fades
// and blurs into focus. Already-shown words stay put, so a later chunk
// doesn't restart their animation. Markdown that would change how the
// prefix reads (a bullet, a fence, a link) still replaces the whole bubble.

import { parseMarkdown, type Block, type Inline, type Line } from '../shared/markdown';

const sourceOf = new WeakMap<HTMLElement, string>();

export interface CaptionRenderOptions {
  /** New plain chunks fade and blur in. Off for the bubble's first paint, which blooms on its own. */
  animate?: boolean;
  /** Chat window: the same classes Markdown uses, and real links. */
  chat?: boolean;
  link?: (url: string, label: string) => HTMLElement;
}

export function renderCaptionMarkdown(
  element: HTMLElement,
  text: string,
  options: CaptionRenderOptions = {},
): void {
  const previous = sourceOf.get(element) ?? '';
  if (previous === text) return;
  sourceOf.set(element, text);

  const delta = text.startsWith(previous) ? text.slice(previous.length) : '';
  if (options.animate && delta && canAppendPlain(previous, text, options)) {
    const last = element.lastElementChild;
    const intact = collectText(element) === (rich(previous) ? renderedText(previous, options) : previous);
    const sameWord =
      intact &&
      last?.classList.contains('word-in') &&
      !/\s$/.test(previous) &&
      (!/^\s/.test(delta) || delta.trim() === '');
    if (sameWord && last) {
      last.append(delta);
      return;
    }
    const tail = document.createElement('span');
    tail.className = 'word-in';
    tail.textContent = delta;
    if (intact) {
      element.append(tail);
      return;
    }
    const settled = previous ? parseMarkdown(previous).map((block) => blockNode(block, options)) : [];
    element.replaceChildren(...settled, tail);
    return;
  }

  element.replaceChildren(...parseMarkdown(text).map((block) => blockNode(block, options)));
}

/** The new suffix can sit after a render of `settled` without changing how that prefix looks. */
function canAppendPlain(settled: string, full: string, options: CaptionRenderOptions): boolean {
  if (!full.startsWith(settled)) return false;
  const delta = full.slice(settled.length);
  if (!delta || openFence(settled) || openFence(full)) return false;
  if (rich(delta)) return false;
  const lastLine = full.slice(full.lastIndexOf('\n') + 1);
  if (/^\s*(?:[-*]\s+|#{1,6}\s+|```)/.test(lastLine)) return false;
  if (!rich(full)) return true;
  return renderedText(full, options) === renderedText(settled, options) + delta;
}

/** Characters the markdown parser would not leave as typed. */
function rich(text: string): boolean {
  return /[*`#\[]|\]\(|https?:\/\/|^\s*```|^\s*[-*]\s+/m.test(text);
}

function openFence(text: string): boolean {
  return (text.match(/^\s*```/gm)?.length ?? 0) % 2 === 1;
}

function renderedText(text: string, options: CaptionRenderOptions): string {
  if (!text) return '';
  const holder = document.createElement('div');
  holder.append(...parseMarkdown(text).map((block) => blockNode(block, options)));
  return collectText(holder);
}

function collectText(root: ParentNode): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node instanceof HTMLElement && node.dataset['icon'] !== undefined) return;
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  for (const child of root.childNodes) walk(child);
  return out;
}

function blockNode(block: Block, options: CaptionRenderOptions): Node {
  if (block.kind === 'code') {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (options.chat) {
      pre.className = 'my-1.5 overflow-x-auto rounded-base bg-wash px-3 py-2 font-mono text-[12px] leading-5';
    }
    code.textContent = block.body;
    pre.append(code);
    return pre;
  }
  const span = document.createElement('span');
  if (options.chat) span.className = 'whitespace-pre-wrap';
  block.lines.forEach((line, i) => {
    if (i > 0) span.append('\n');
    span.append(...lineNodes(line, options));
  });
  return span;
}

function lineNodes(line: Line, options: CaptionRenderOptions): Node[] {
  const parts = inlineNodes(line.parts, options);
  if (line.style === 'heading') {
    const strong = document.createElement('strong');
    strong.append(...parts);
    return [strong];
  }
  if (line.style === 'bullet') return [document.createTextNode(`${line.indent}• `), ...parts];
  return parts;
}

function inlineNodes(parts: Inline[], options: CaptionRenderOptions): Node[] {
  return parts.map((part) => {
    switch (part.kind) {
      case 'text':
        return document.createTextNode(part.body);
      case 'code': {
        const code = document.createElement('code');
        if (options.chat) code.className = 'rounded-[4px] bg-wash px-1 py-px font-mono text-[12px]';
        code.textContent = part.body;
        return code;
      }
      case 'bold': {
        const strong = document.createElement('strong');
        strong.append(...inlineNodes(part.parts, options));
        return strong;
      }
      case 'em': {
        const em = document.createElement('em');
        em.textContent = part.body;
        return em;
      }
      case 'link': {
        if (options.link) return options.link(part.url, part.label);
        const link = document.createElement('span');
        link.className = 'caption-link';
        link.textContent = part.label;
        return link;
      }
    }
  });
}
