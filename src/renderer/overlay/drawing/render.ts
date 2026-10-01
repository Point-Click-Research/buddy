// Drawing the main process's commands as SVG.
//
// The renderer builds elements from a closed set of primitives and sets text
// with textContent — it never inserts markup and never evaluates anything.
// Coordinates arrive in overlay-local DIP with every path already computed,
// so there is no geometry here beyond measuring text for its bubble.

import type { DrawCommand, DrawingsPayload, Geometry } from '../../../shared/drawing';
import { placeLabels } from './labels';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Long enough to read as deliberate, short enough not to hold anything up. */
const FADE_MS = 250;
/** A stroke draws at roughly this pace, between the two bounds. */
const MS_PER_UNIT = 1.1;
const MIN_DRAW_MS = 240;
const MAX_DRAW_MS = 900;
/** Shapes appear one after another so an explanation reads in order. */
const STAGGER_MS = 150;
/**
 * Big enough to cover any display whatever the overlay's offset. macOS parks
 * the overlay window over the menu bar, so the drawing layer is translated to
 * compensate — and a rect sized in percentages would move with it and leave
 * an undimmed strip along one edge.
 */
const COVER = { x: -8_000, y: -8_000, size: 24_000 };

const root = document.getElementById('drawings') as unknown as SVGGElement | null;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Build the SVG for one command's geometry. */
function build(geometry: Geometry, id: string): SVGElement {
  switch (geometry.kind) {
    case 'ink': {
      // A pen stroke is an outline, so it is filled rather than stroked —
      // and revealed by a mask whose centreline draws itself, since a fill
      // has no stroke to dash.
      const group = el('g', {});
      const maskId = `draw-ink-${id.replace(/[^\w-]/g, '')}`;
      const mask = el('mask', { id: maskId, maskUnits: 'userSpaceOnUse' });
      mask.append(
        el('path', {
          class: 'draw-reveal',
          d: geometry.center,
          fill: 'none',
          stroke: 'white',
          'stroke-width': geometry.reveal,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
      group.append(mask);
      group.append(el('path', { class: 'draw-ink', d: geometry.d, mask: `url(#${maskId})` }));
      return group;
    }
    case 'spotlight':
      return spotlight(geometry.hole, geometry.feather, id);
    case 'path': {
      const path = el('path', { d: geometry.d, class: 'draw-stroke' });
      if (geometry.arrowEnd) path.setAttribute('marker-end', 'url(#draw-arrow)');
      if (geometry.arrowStart) path.setAttribute('marker-start', 'url(#draw-arrow)');
      return path;
    }
    case 'rect':
      return el('rect', {
        class: 'draw-stroke',
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        rx: geometry.radius,
      });
    case 'ellipse': {
      const ellipse = el('ellipse', {
        class: 'draw-stroke',
        cx: geometry.cx,
        cy: geometry.cy,
        rx: geometry.rx,
        ry: geometry.ry,
      });
      if (geometry.rotation) {
        ellipse.setAttribute('transform', `rotate(${geometry.rotation} ${geometry.cx} ${geometry.cy})`);
      }
      return ellipse;
    }
    case 'text': {
      const text = el('text', { class: `draw-text draw-text-${geometry.size}`, x: geometry.x, y: geometry.y });
      text.textContent = geometry.content;
      return text;
    }
    case 'badge': {
      const group = el('g', {});
      group.append(el('circle', { class: 'draw-badge', cx: geometry.x, cy: geometry.y, r: 15 }));
      const number = el('text', {
        class: 'draw-badge-number',
        x: geometry.x,
        y: geometry.y,
      });
      number.textContent = String(geometry.number);
      group.append(number);
      return group;
    }
    case 'callout': {
      const group = el('g', {});
      group.append(el('path', { class: 'draw-stroke draw-leader', d: geometry.leader }));
      group.append(bubble(geometry.x, geometry.y, geometry.content));
      return group;
    }
  }
}

/**
 * Dim the display and leave a soft-edged hole. The dimming is one big rect
 * masked by a blurred cut-out, so the edge fades instead of looking like a
 * sticker with a window in it.
 */
function spotlight(
  hole: { x: number; y: number; width: number; height: number },
  feather: number,
  id: string,
): SVGGElement {
  const group = el('g', {});
  const maskId = `draw-spot-${id.replace(/[^\w-]/g, '')}`;
  const blurId = `${maskId}-blur`;

  const defs = el('defs', {});
  const filter = el('filter', { id: blurId, x: '-50%', y: '-50%', width: '200%', height: '200%' });
  filter.append(el('feGaussianBlur', { stdDeviation: Math.max(0.01, feather / 2) }));
  const mask = el('mask', { id: maskId, maskUnits: 'userSpaceOnUse' });
  mask.append(
    el('rect', { x: COVER.x, y: COVER.y, width: COVER.size, height: COVER.size, fill: 'white' }),
  );
  mask.append(
    el('rect', {
      x: hole.x,
      y: hole.y,
      width: hole.width,
      height: hole.height,
      rx: 12,
      fill: 'black',
      filter: `url(#${blurId})`,
    }),
  );
  defs.append(filter, mask);
  group.append(defs);
  group.append(
    el('rect', {
      class: 'draw-dim',
      x: COVER.x,
      y: COVER.y,
      width: COVER.size,
      height: COVER.size,
      mask: `url(#${maskId})`,
    }),
  );
  return group;
}

/**
 * A rounded label bubble. The text must be in the document before it can be
 * measured, so the group is returned with a placeholder rect that is sized
 * once attached.
 */
function bubble(x: number, y: number, content: string): SVGGElement {
  const group = el('g', { class: 'draw-bubble', 'data-bubble': `${x},${y}` });
  const rect = el('rect', { class: 'draw-bubble-bg', rx: 12, x, y, width: 0, height: 0 });
  const text = el('text', { class: 'draw-bubble-text', x, y });
  text.textContent = content;
  group.append(rect, text);
  return group;
}

/** Size every bubble to its text, now that it can be measured. */
function sizeBubbles(scope: SVGGElement): void {
  for (const group of scope.querySelectorAll<SVGGElement>('g.draw-bubble')) {
    const rect = group.querySelector<SVGRectElement>('rect.draw-bubble-bg');
    const text = group.querySelector<SVGTextElement>('text.draw-bubble-text');
    if (!rect || !text) continue;
    const [cx, cy] = (group.dataset['bubble'] ?? '0,0').split(',').map(Number);
    const box = text.getBBox();
    const padX = 12;
    const padY = 8;
    const width = box.width + padX * 2;
    const height = box.height + padY * 2;
    const x = Math.max(8, Math.min((cx ?? 0) - width / 2, window.innerWidth - width - 8));
    const y = Math.max(8, Math.min((cy ?? 0) - height / 2, window.innerHeight - height - 8));
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    text.setAttribute('x', String(x + padX));
    text.setAttribute('y', String(y + padY + box.height - 3));
  }
}

/**
 * Trace a stroke along its real length, so it draws itself.
 *
 * This runs through the animation API rather than a CSS transition. Setting
 * the start and end of a transition in one tick lets the browser coalesce
 * them and skip the animation entirely — which it did, leaving every drawing
 * to merely fade in. An explicit keyframe animation cannot be optimised away.
 *
 * Longer strokes take longer, within limits, so a quick tick and a whole
 * hexagon both feel like they were drawn by the same hand.
 */
function drawOn(group: SVGGElement, delay: number): void {
  // .draw-reveal is the hidden centreline that unmasks an ink stroke: a pen
  // stroke is a filled outline with nothing to dash, so its reveal is a
  // masked stroke drawing itself instead.
  for (const stroke of group.querySelectorAll<SVGGeometryElement>('.draw-stroke, .draw-reveal')) {
    const length = typeof stroke.getTotalLength === 'function' ? stroke.getTotalLength() : 0;
    if (!length) continue;
    const duration = Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, length * MS_PER_UNIT));
    stroke.animate(
      [
        { strokeDasharray: String(length), strokeDashoffset: String(length) },
        { strokeDasharray: String(length), strokeDashoffset: '0' },
      ],
      // 'backwards' holds the first frame through the delay, so a staggered
      // shape stays unstarted instead of flashing into view first.
      { duration, delay, easing: 'ease-out', fill: 'backwards' },
    );
  }
}

/**
 * Show these commands, and only these. The list is diffed against what is
 * already on screen: an unchanged shape is left alone (its animations and
 * reveal state intact), a shape that merely moved — an element being
 * followed — is swapped in place without re-drawing itself, and one that is
 * gone fades out. Only genuinely new shapes get the hand.
 */
export function setDrawings({ commands, offset }: DrawingsPayload): void {
  if (!root) return;
  root.setAttribute('transform', `translate(${offset.x} ${offset.y})`);

  const existing = new Map<string, SVGGElement>();
  for (const group of root.querySelectorAll<SVGGElement>('g.draw')) {
    const id = group.dataset['id'];
    if (id) existing.set(id, group);
  }

  const still = reduceMotion.matches;
  let appeared = 0;
  for (const command of commands) {
    const hash = JSON.stringify(command);
    const known = existing.get(command.id);
    existing.delete(command.id);

    if (known && known.dataset['hash'] === hash) continue;

    const group = groupFor(command, hash);
    if (known) {
      // The same shape somewhere else: it moved, it was not redrawn.
      group.classList.add('draw-shown');
      if (known.classList.contains('draw-pending')) group.classList.add('draw-pending');
      known.replaceWith(group);
      continue;
    }

    if (command.showAt) group.classList.add('draw-pending');
    root.append(group);
    const delay = still ? 0 : appeared * STAGGER_MS;
    appeared++;
    // Everything with a stroke draws itself on; that is Buddy's hand. The
    // animate field chooses the extras — pulse, or none to appear at once —
    // rather than whether the hand moves. A shape waiting on its marker
    // draws itself when revealed instead.
    if (!still && command.animate !== 'none' && !command.showAt) drawOn(group, delay);
    window.setTimeout(() => group.classList.add('draw-shown'), delay);
  }

  // Whatever was not in the list is gone — a stale element, an erase.
  for (const group of existing.values()) {
    group.classList.remove('draw-shown');
    window.setTimeout(() => group.remove(), FADE_MS);
  }

  sizeBubbles(root);
  placeLabels(root);
}

function groupFor(command: DrawCommand, hash: string): SVGGElement {
  const group = el('g', {
    'data-id': command.id,
    'data-hash': hash,
    ...(command.showAt ? { 'data-show-at': command.showAt } : {}),
    class: [
      'draw',
      `draw-color-${command.color}`,
      `draw-stroke-${command.stroke}`,
      `draw-width-${command.width}`,
      `draw-fill-${command.fill}`,
      command.animate === 'pulse' ? 'draw-pulse' : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
  group.append(build(command.geometry, command.id));
  if (command.label) group.append(bubble(command.label.x, command.label.y, command.label.text));
  return group;
}

/** Reveal shapes that were waiting for their marker in the spoken reply. */
export function revealDrawings(names: string[], all: boolean): void {
  if (!root) return;
  for (const group of root.querySelectorAll<SVGGElement>('g.draw-pending')) {
    const waitingFor = group.dataset['showAt'] ?? '';
    if (!all && !names.includes(waitingFor)) continue;
    group.classList.remove('draw-pending');
    group.classList.add('draw-shown');
    // Its moment has come: now the hand draws it.
    if (!reduceMotion.matches) drawOn(group, 0);
  }
}

export function clearDrawings(): void {
  if (!root) return;
  for (const group of root.querySelectorAll<SVGGElement>('g.draw')) {
    group.classList.remove('draw-shown');
    window.setTimeout(() => group.remove(), FADE_MS);
  }
}
