// Renders annotations as SVG in the overlay window. Coordinates are
// overlay-local DIP, already converted by the main process.

import type { Annotation } from '../../shared/types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FADE_MS = 350;
const AUTO_CLEAR_MS = 20_000;

const svg = document.getElementById('annotations') as unknown as SVGSVGElement;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Where an annotation wants its label: centered at cx, top edge at topY. */
interface LabelSpec {
  text: string;
  cx: number;
  topY: number;
}

/**
 * Add a chat-bubble label. The group MUST already be attached to the
 * document: getBBox() returns zeros for detached elements, which collapses
 * the bubble to a dot.
 */
function addLabel(group: SVGGElement, { text, cx, topY }: LabelSpec): void {
  if (!text) return;
  const padX = 10;
  const padY = 6;
  const textEl = svgEl('text', { class: 'label-text' });
  textEl.textContent = text;
  group.append(textEl);

  const box = textEl.getBBox();
  const pillW = box.width + padX * 2;
  const pillH = box.height + padY * 2;
  const x = Math.max(8, Math.min(cx - pillW / 2, window.innerWidth - pillW - 8));
  const y = Math.max(8, Math.min(topY, window.innerHeight - pillH - 8));

  const rect = svgEl('rect', {
    class: 'label-bg',
    x,
    y,
    width: pillW,
    height: pillH,
    rx: 12, // --radius-base: the caption bubble's corners
  });
  textEl.setAttribute('x', String(x + padX));
  textEl.setAttribute('y', String(y + padY + box.height - 3));
  group.insertBefore(rect, textEl);
}

/** Build the SVG group for one annotation and say where its label belongs. */
function buildAnnotation(annotation: Annotation): { group: SVGGElement; label: LabelSpec } {
  const group = svgEl('g', { class: 'ann' });

  switch (annotation.kind) {
    case 'point': {
      const { x, y, label } = annotation;
      group.append(svgEl('circle', { class: 'ping', cx: x, cy: y, r: 12 }));
      group.append(svgEl('circle', { class: 'shape filled', cx: x, cy: y, r: 8 }));
      return { group, label: { text: label, cx: x, topY: y + 22 } };
    }
    case 'circle': {
      const { x, y, radius, label } = annotation;
      group.append(svgEl('circle', { class: 'shape', cx: x, cy: y, r: radius }));
      return { group, label: { text: label, cx: x, topY: y + radius + 12 } };
    }
    case 'arrow': {
      const { fromX, fromY, toX, toY, label } = annotation;
      group.append(
        svgEl('line', {
          class: 'shape',
          x1: fromX,
          y1: fromY,
          x2: toX,
          y2: toY,
          'marker-end': 'url(#arrowhead)',
        }),
      );
      return { group, label: { text: label, cx: fromX, topY: fromY + 12 } };
    }
    case 'highlight': {
      const { x, y, width, height, label } = annotation;
      group.append(svgEl('rect', { class: 'shape soft', x, y, width, height, rx: 10 }));
      return { group, label: { text: label, cx: x + width / 2, topY: y + height + 12 } };
    }
  }
}

function fadeOutAndRemove(group: SVGGElement): void {
  group.classList.remove('show');
  setTimeout(() => group.remove(), FADE_MS);
}

export function drawAnnotations(annotations: Annotation[]): void {
  for (const annotation of annotations) {
    const { group, label } = buildAnnotation(annotation);
    // Attach first, label second: the bubble is sized by measuring the text,
    // which only works once the group is in the document.
    svg.append(group);
    addLabel(group, label);
    // Next frame so the fade-in transition actually runs.
    requestAnimationFrame(() => group.classList.add('show'));
    setTimeout(() => fadeOutAndRemove(group), AUTO_CLEAR_MS);
  }
}

export function clearAnnotations(): void {
  for (const group of svg.querySelectorAll<SVGGElement>('g.ann')) {
    fadeOutAndRemove(group);
  }
}
