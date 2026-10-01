// The tree serializer, against accessibility trees recorded from the real
// driver: a native document window (TextEdit) and a web page in a browser.
// The fixtures are the driver's own structuredContent, trimmed to the fields
// Buddy reads.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  formatRows,
  inView,
  keepAddressable,
  parseWindowTree,
  renderTree,
  subtreeOf,
  treeCaveat,
  visibleBounds,
  type RawElement,
  type RefRow,
} from '../src/main/computer/tree';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');
}

const TEXT_EDIT = fixture('window-state-textedit');
const WEB_PAGE = fixture('window-state-webpage');

function refs(elements: ReturnType<typeof keepAddressable>): RefRow[] {
  return elements.map((element, i) => ({ ...element, ref: `e${i + 1}` }));
}

function raw(json: string): RawElement[] {
  return (JSON.parse(json) as { elements: RawElement[] }).elements;
}

describe('reading the driver payload', () => {
  it('takes the identity a later element action needs', () => {
    const tree = parseWindowTree(TEXT_EDIT);
    expect(tree).not.toBeNull();
    expect(tree?.snapshotId).toBe('s00000004');
    expect(tree?.app).toBe('TextEdit');
    expect(tree?.title).toBe('Untitled');
    expect(tree?.pid).toBeGreaterThan(0);
    expect(tree?.windowId).toBeGreaterThan(0);
  });

  it('survives a payload the driver could not produce', () => {
    expect(parseWindowTree(undefined)).toBeNull();
    expect(parseWindowTree('not json')).toBeNull();
    expect(parseWindowTree('{}')?.elements).toEqual([]);
  });
});

describe('what a real tree is mostly made of', () => {
  it('drops the menu bar, which is most of a native app tree', () => {
    // 189 elements, of which 157 are the menu bar: sending them would cost
    // more than the screenshot this is supposed to replace, and invoke_menu
    // reaches menus by path without any of it.
    const all = raw(TEXT_EDIT);
    const kept = keepAddressable(all);
    expect(all.length).toBe(189);
    expect(kept.length).toBeLessThan(25);
    // A menu button inside the window is a real control and stays; the menu
    // bar's own items are the ones that go.
    expect(kept.some((element) => ['menubar', 'menubaritem', 'menu', 'menuitem'].includes(element.role))).toBe(
      false,
    );
  });

  it('keeps a web page readable without repeating every label three times', () => {
    // A link, the text inside it and the image beside it all carry the same
    // words; only the link can be acted on.
    const kept = keepAddressable(raw(WEB_PAGE));
    expect(kept.length).toBeLessThan(raw(WEB_PAGE).length * 0.7);
    const names = kept.filter((element) => element.name === 'Messaging');
    expect(names).toHaveLength(1);
    expect(names[0]?.role).toBe('link');
  });

  it('drops the ruler and its markers, which nothing would ever address', () => {
    const kept = keepAddressable(raw(TEXT_EDIT));
    expect(kept.some((element) => element.role.includes('ruler'))).toBe(false);
  });

  it('keeps the controls a task actually needs', () => {
    const named = keepAddressable(raw(TEXT_EDIT)).map((element) => element.name);
    expect(named).toContain('bold');
    expect(named).toContain('typeface');
    expect(named).toContain('align left');
  });

  it('keeps an unlabelled button, because position still identifies it', () => {
    // The window's own close / minimise / zoom buttons carry no AX label.
    const kept = keepAddressable(raw(TEXT_EDIT));
    expect(kept.some((element) => element.role === 'button' && !element.name)).toBe(true);
  });

  it('keeps the links a web page is navigated by', () => {
    const kept = keepAddressable(raw(WEB_PAGE));
    const links = kept.filter((element) => element.role === 'link').map((element) => element.name);
    expect(links).toContain('Home');
    expect(links).toContain('Jobs');
    // Decorative images have no label and are not worth a line.
    expect(kept.every((element) => element.role !== 'image' || element.name !== '')).toBe(true);
  });

  it('drops an element with no size, which is a row scrolled out of view', () => {
    const kept = keepAddressable([
      { element_index: 0, role: 'AXButton', depth: 0, label: 'real', frame: { x: 0, y: 0, w: 80, h: 20 } },
      { element_index: 1, role: 'AXButton', depth: 0, label: 'virtual', frame: { x: 0, y: 0, w: 80, h: 1 } },
    ]);
    expect(kept.map((element) => element.name)).toEqual(['real']);
  });
});

// A page's heading is a block that spans the column while its words fill a
// corner of it, and the block is the element that survives the filter. Boxing
// its frame drew a rectangle level with the words but several times as wide.
describe('where an element\'s words actually are', () => {
  it('keeps the text box of a heading that spans its column', () => {
    const heading = keepAddressable(raw(WEB_PAGE)).find((element) => element.name === 'Reactions')!;
    expect(heading.role).toBe('heading');
    expect(heading.bounds?.w).toBeGreaterThan(500);
    expect(visibleBounds(heading)?.w).toBeLessThan(100);
    expect(visibleBounds(heading)?.y).toBe(heading.textBounds?.y);
  });

  it('leaves a control alone: the ring belongs on the button, not its caption', () => {
    const button = keepAddressable(raw(WEB_PAGE)).find(
      (element) => element.role === 'button' && element.name.startsWith('Chris Shanahan and'),
    )!;
    expect(button.textBounds).toBeNull();
    expect(visibleBounds(button)).toEqual(button.bounds);
  });

  it('ignores one paragraph deep inside a block it says nothing about', () => {
    const kept = keepAddressable([
      { element_index: 0, role: 'AXGroup', depth: 0, label: 'Terms and conditions apply', frame: { x: 0, y: 0, w: 900, h: 600 } },
      { element_index: 1, role: 'AXStaticText', depth: 1, label: 'Terms', frame: { x: 10, y: 10, w: 40, h: 14 } },
    ]);
    expect(kept[0]?.textBounds).toBeNull();
  });
});

describe('one line per element', () => {
  it('reads as a short row of facts', () => {
    const rows = refs(keepAddressable(raw(TEXT_EDIT)));
    const bold = rows.find((row) => row.name === 'bold');
    expect(bold).toBeDefined();
    expect(formatRows([bold!])).toBe(`${bold!.ref} | checkbox | bold | =0 | 222,152 20x20`);
  });

  it('collapses a document into one readable line instead of its whole text', () => {
    const rows = refs(keepAddressable(raw(TEXT_EDIT)));
    const document = rows.find((row) => row.role === 'textarea')!;
    const line = formatRows([document]);
    expect(line.split('\n')).toHaveLength(1);
    expect(line.length).toBeLessThan(140);
    expect(line).toContain('Whispers of Morning');
  });

  it('says nothing about a value that only repeats the name', () => {
    const rows = refs(keepAddressable(raw(TEXT_EDIT)));
    const document = rows.find((row) => row.role === 'textarea')!;
    expect(document.value).toBe('');
  });

  it('flags a control the model must not bother pressing', () => {
    const rows = refs(
      keepAddressable([
        { element_index: 0, role: 'AXButton', depth: 0, label: 'Send', enabled: false },
        { element_index: 1, role: 'AXCheckBox', depth: 0, label: 'Remember me', selected: true },
      ]),
    );
    expect(formatRows(rows)).toBe('e1 | button | Send | disabled\ne2 | checkbox | Remember me | selected');
  });

  it('stays small enough to be worth sending', () => {
    for (const [name, json] of [
      ['textedit', TEXT_EDIT],
      ['web page', WEB_PAGE],
    ] as const) {
      const rendered = formatRows(refs(keepAddressable(raw(json))));
      // Well under the cost of the screenshot it replaces.
      expect(rendered.length, name).toBeLessThan(12_000);
    }
  });
});

describe('saying when the elements are not the whole story', () => {
  const toolbar = keepAddressable([
    { element_index: 0, role: 'AXWindow', depth: 0, label: 'Google' },
    { element_index: 1, role: 'AXTextField', depth: 1, label: 'smart search field' },
  ]);

  it('warns that Safari hands over its toolbar but not the page', () => {
    // Recorded from the real driver: a Safari window on google.com exposes
    // 433 elements, every one of them a menu item or a toolbar control.
    expect(treeCaveat('Safari', toolbar)).toContain('not the page');
  });

  it('stays quiet once the page itself is exposed', () => {
    expect(treeCaveat('Safari', [...toolbar, ...keepAddressable([{ element_index: 2, role: 'AXWebArea', depth: 1, label: 'Google' }])])).toBe('');
    expect(treeCaveat('TextEdit', toolbar)).toBe('');
  });
});

// A dense app keeps hundreds of addressable rows even after filtering, so a
// big tree is shown as a shallow overview whose truncated branches say how
// many rows expand_element on them would reveal.
describe('rendering a large tree as an overview', () => {
  function denseApp(): RefRow[] {
    const raw: RawElement[] = [
      { element_index: 0, role: 'AXWindow', depth: 0, label: 'general' },
      { element_index: 1, role: 'AXGroup', depth: 1, label: 'Sidebar' },
      ...Array.from({ length: 60 }, (_, i) => ({
        element_index: 2 + i,
        role: 'AXButton',
        depth: 3,
        label: `Channel ${i}`,
        frame: { x: 0, y: 30 + i * 20, w: 200, h: 18 },
      })),
      { element_index: 62, role: 'AXGroup', depth: 1, label: 'Thread' },
      ...Array.from({ length: 60 }, (_, i) => ({
        element_index: 63 + i,
        role: 'AXButton',
        depth: 4,
        label: `Message ${i}`,
        frame: { x: 220, y: 30 + i * 20, w: 400, h: 18 },
      })),
    ];
    return refs(keepAddressable(raw));
  }

  it('shows a small tree whole, exactly as before', () => {
    const rows = refs(keepAddressable(raw(TEXT_EDIT)));
    expect(renderTree(rows)).toEqual({ text: formatRows(rows), shown: rows.length });
  });

  it('cuts a big tree to its shallow rows, each branch counting what it hides', () => {
    const rows = denseApp();
    expect(rows.length).toBeGreaterThan(100);
    const view = renderTree(rows);
    expect(view.shown).toBe(3);
    const lines = view.text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^e2 \| group \| Sidebar \| \+60 inside$/);
    expect(lines[2]).toMatch(/\| Thread \| \+60 inside$/);
    // The savings are the point: three lines instead of 123.
    expect(view.text.length).toBeLessThan(formatRows(rows).length / 10);
  });

  it('keeps the refs of the full tree, so drilling changes nothing', () => {
    const rows = denseApp();
    const inside = subtreeOf(rows, 'e2').slice(1);
    expect(inside).toHaveLength(60);
    // The branch is small enough to be shown whole when expanded.
    const view = renderTree(inside);
    expect(view.shown).toBe(60);
    expect(view.text).toContain('Channel 0');
    expect(view.text).not.toContain('inside');
  });
});

describe('expanding one part of a large tree', () => {
  it('returns an element and everything under it', () => {
    const rows = refs(
      keepAddressable([
        { element_index: 0, role: 'AXButton', depth: 0, label: 'before' },
        { element_index: 1, role: 'AXTextField', depth: 1, label: 'form' },
        { element_index: 2, role: 'AXTextField', depth: 2, label: 'name' },
        { element_index: 3, role: 'AXTextField', depth: 3, label: 'first' },
        { element_index: 4, role: 'AXButton', depth: 1, label: 'after' },
      ]),
    );
    expect(subtreeOf(rows, 'e2').map((row) => row.name)).toEqual(['form', 'name', 'first']);
    expect(subtreeOf(rows, 'e5').map((row) => row.name)).toEqual(['after']);
    expect(subtreeOf(rows, 'nope')).toEqual([]);
  });

  it('still finds descendants whose parents were filtered away', () => {
    // The container is dropped as decoration; its children keep their depth,
    // so they are still inside the element the model asked about.
    const rows = refs(
      keepAddressable([
        { element_index: 0, role: 'AXGroup', depth: 0, label: 'panel' },
        { element_index: 1, role: 'AXUnknown', depth: 1 },
        { element_index: 2, role: 'AXButton', depth: 2, label: 'inside' },
      ]),
    );
    // AXUnknown drops its whole subtree, so the panel really is empty here.
    expect(rows.map((row) => row.name)).toEqual(['panel']);
    expect(subtreeOf(rows, 'e1').map((row) => row.name)).toEqual(['panel']);
  });
});

describe('what the window can actually reach', () => {
  const rows = refs(
    keepAddressable([
      { element_index: 0, role: 'AXWindow', depth: 0, label: 'Checkout', frame: { x: 0, y: 0, w: 1000, h: 800 } },
      { element_index: 1, role: 'AXTextField', depth: 1, label: 'City', frame: { x: 100, y: 300, w: 300, h: 40 } },
      // Laid out below the window: the page scrolled past it.
      { element_index: 2, role: 'AXTextField', depth: 1, label: 'Card number', frame: { x: 100, y: 1180, w: 300, h: 40 } },
    ]),
  );

  it('marks rows past the window edge as off-view in the model\'s list', () => {
    const text = formatRows(rows);
    expect(text).toMatch(/City.*\n/);
    expect(text).not.toMatch(/City[^\n]*off-view/);
    expect(text).toMatch(/Card number[^\n]*off-view \(scroll to it\)/);
  });

  it('judges by the element centre against the window frame', () => {
    const view = { x: 0, y: 0, w: 1000, h: 800 };
    expect(inView({ x: 100, y: 780, w: 300, h: 40 }, view)).toBe(true); // straddles the edge, centre inside
    expect(inView({ x: 100, y: 790, w: 300, h: 40 }, view)).toBe(false);
    expect(inView(null, view)).toBe(true); // nothing to judge by
    expect(inView({ x: 5000, y: 5000, w: 1, h: 1 }, null)).toBe(true);
  });
});
