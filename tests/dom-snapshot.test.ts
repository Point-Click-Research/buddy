// The page-to-elements mapping behind Buddy's browser: frames placed in the
// page, nodes addressable by token, and a list the existing tree renderer
// already knows how to show.

import { describe, expect, it } from 'vitest';
import {
  frameOwner,
  nodeToken,
  parseNodeToken,
  setValueScript,
  SNAPSHOT_SCRIPT,
  toTreeElements,
  type FrameSnapshot,
  type SnapshotElement,
} from '../src/main/browser/dom-snapshot';
import { formatRows, inView, windowBounds } from '../src/main/computer/tree';

function element(index: number, role: string, name: string, extra: Partial<SnapshotElement> = {}): SnapshotElement {
  return {
    index,
    role,
    name,
    value: '',
    enabled: true,
    selected: false,
    bounds: { x: 10 + index * 5, y: 100 + index * 50, w: 300, h: 40 },
    ...extra,
  };
}

const MAIN: FrameSnapshot = {
  url: 'https://shop.example/checkout',
  name: '',
  title: 'Checkout',
  viewport: { width: 1200, height: 780 },
  elements: [
    element(0, 'heading', 'Payment'),
    element(1, 'textfield', 'Name on card', { value: 'Ada Lovelace' }),
    element(2, 'iframe', 'Card number', { src: 'https://pay.example/card-number?x=1', frameName: 'card-number-frame' }),
    element(3, 'button', 'Complete order'),
    // Below the fold: still listed, marked off-view, reachable by ref.
    element(4, 'link', 'Return policy', { bounds: { x: 10, y: 1400, w: 200, h: 20 } }),
  ],
};

const CARD_FRAME: FrameSnapshot = {
  url: 'https://pay.example/card-number?x=1',
  name: 'card-number-frame',
  title: '',
  viewport: { width: 300, height: 40 },
  elements: [element(0, 'textfield', 'Card number', { bounds: { x: 4, y: 4, w: 280, h: 32 } })],
};

describe('placing frames', () => {
  it('finds a child frame\'s owner iframe by src, then by name, then as the only one', () => {
    expect(frameOwner(MAIN, CARD_FRAME)?.index).toBe(2);
    expect(frameOwner(MAIN, { url: 'https://other.example/', name: 'card-number-frame' })?.index).toBe(2);
    expect(frameOwner(MAIN, { url: 'https://other.example/', name: 'nope' })?.index).toBe(2); // the only iframe
    const two = { ...MAIN, elements: [...MAIN.elements, element(5, 'iframe', 'Other', { src: 'https://x.example/' })] };
    expect(frameOwner(two, { url: 'https://other.example/', name: 'nope' })).toBeNull();
  });

  it('shifts a child frame\'s elements by where its iframe sits, and keeps unknown ones unplaced', () => {
    const owner = frameOwner(MAIN, CARD_FRAME)!;
    const rows = toTreeElements([
      { frame: 0, snapshot: MAIN, offset: { x: 0, y: 0 } },
      { frame: 1, snapshot: CARD_FRAME, offset: { x: owner.bounds!.x, y: owner.bounds!.y } },
      { frame: 2, snapshot: { ...CARD_FRAME, url: 'https://lost.example/' }, offset: null },
    ]);
    // Row 0 is the page itself, sized to the viewport.
    expect(rows[0]!.role).toBe('window');
    expect(windowBounds(rows)).toEqual({ x: 0, y: 0, w: 1200, h: 780 });
    const card = rows.find((row) => row.token === nodeToken({ frame: 1, index: 0 }))!;
    expect(card.bounds).toEqual({ x: 20 + 4, y: 200 + 4, w: 280, h: 32 });
    expect(card.depth).toBe(2);
    const lost = rows.find((row) => row.token === nodeToken({ frame: 2, index: 0 }))!;
    expect(lost.bounds).toBeNull();
  });

  it('renders like a native window, off-view rows included', () => {
    const rows = toTreeElements([{ frame: 0, snapshot: MAIN, offset: { x: 0, y: 0 } }]).map((row, i) => ({
      ...row,
      ref: `e${i + 1}`,
    }));
    const text = formatRows(rows);
    expect(text).toMatch(/textfield \| Name on card \| =Ada Lovelace/);
    expect(text).toMatch(/Return policy[^\n]*off-view/);
    expect(inView(rows[4]!.bounds, windowBounds(rows))).toBe(true);
    expect(inView(rows[5]!.bounds, windowBounds(rows))).toBe(false);
  });
});

describe('node tokens', () => {
  it('round-trip, and reject anything else', () => {
    expect(parseNodeToken(nodeToken({ frame: 3, index: 17 }))).toEqual({ frame: 3, index: 17 });
    expect(parseNodeToken('e4')).toBeNull();
    expect(parseNodeToken(null)).toBeNull();
  });
});

describe('the in-page scripts', () => {
  it('are self-contained expressions that remember nodes on the frame window', () => {
    expect(SNAPSHOT_SCRIPT.trim().startsWith('(() => {')).toBe(true);
    expect(SNAPSHOT_SCRIPT).toContain('window.__buddyNodes = nodes');
    // A value goes in through the native setter with input and change events,
    // which is what a React-controlled field needs to keep it.
    const script = setValueScript(2, 'O\'Brien "quoted"');
    expect(script).toContain('__buddyNodes || [])[2]');
    expect(script).toContain(JSON.stringify('O\'Brien "quoted"'));
    expect(script).toContain("fire('input'); fire('change')");
  });
});
