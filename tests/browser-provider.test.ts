// The browser provider over a fake page: the model's actions become
// in-page reads and trusted events, with the same refs, refusals and
// observations the desktop providers give back.

import { describe, expect, it, vi } from 'vitest';
import type { Jev } from '../src/main/ai/jev';
import type { PageCapture, PageDriver, PageSnapshot } from '../src/main/browser/page';
import { nodeToken, type NodeRef } from '../src/main/browser/dom-snapshot';
import { createBrowserProvider } from '../src/main/computer/browser-provider';
import type { TreeElement } from '../src/main/computer/tree';
import type { WindowObservationView } from '../src/main/computer/provider';

function el(index: number, role: string, name: string, extra: Partial<TreeElement> = {}): TreeElement {
  return {
    index,
    token: index === 0 ? null : nodeToken({ frame: 0, index: index - 1 }),
    role,
    name,
    value: '',
    enabled: true,
    selected: false,
    bounds: index === 0 ? { x: 0, y: 0, w: 1200, h: 780 } : { x: 100, y: 100 * index, w: 300, h: 40 },
    textBounds: null,
    depth: index === 0 ? 0 : 1,
    actions: [],
    ...extra,
  };
}

function fakePage(): PageDriver & { calls: string[]; hash: string; dropdowns: Record<number, string[]> } {
  const page = {
    calls: [] as string[],
    hash: 'h1',
    url: () => 'https://shop.example/checkout',
    title: () => 'Checkout',
    async navigate(url: string) {
      page.calls.push(`navigate ${url}`);
    },
    async snapshot(): Promise<PageSnapshot> {
      page.calls.push('snapshot');
      return {
        url: 'https://shop.example/checkout',
        title: 'Checkout',
        viewport: { width: 1200, height: 780 },
        elements: [el(0, 'window', 'Checkout'), el(1, 'textfield', 'Email'), el(2, 'button', 'Continue')],
      };
    },
    async capture(): Promise<PageCapture> {
      page.calls.push('capture');
      return { base64: 'AAAA', width: 1200, height: 780, hash: page.hash };
    },
    async locate(ref: NodeRef) {
      page.calls.push(`locate ${ref.frame}:${ref.index}`);
      return { x: 100, y: 200, w: 300, h: 40 };
    },
    async click(x: number, y: number, button = 'left', count = 1) {
      page.calls.push(`click ${x},${y} ${button} x${count}`);
    },
    async clickNode(ref: NodeRef) {
      page.calls.push(`clickNode ${ref.index}`);
      return true;
    },
    async selectOptions(ref: NodeRef) {
      return page.dropdowns[ref.index] ?? null;
    },
    /** Node index -> a native <select>'s options; anything absent is not a dropdown. */
    dropdowns: {} as Record<number, string[]>,
    async focus(ref: NodeRef) {
      page.calls.push(`focus ${ref.index}`);
      return true;
    },
    async insertText(text: string) {
      page.calls.push(`insert ${text}`);
    },
    async setValue(ref: NodeRef, value: string) {
      page.calls.push(`set ${ref.index}=${value}`);
      return 'ok' as const;
    },
    async key(combo: { modifiers: string[]; key: string }, repeat = 1) {
      page.calls.push(`key ${[...combo.modifiers, combo.key].join('+')} x${repeat}`);
    },
    async scroll(dx: number, dy: number) {
      page.calls.push(`scroll ${dx},${dy}`);
    },
    nodeRef(token: string | null) {
      const match = /^(\d+):(\d+)$/.exec(token ?? '');
      return match ? { frame: Number(match[1]), index: Number(match[2]) } : null;
    },
  };
  return page;
}

const signal = new AbortController().signal;

describe("Buddy's browser as a provider", () => {
  it('offers page actions only: no apps, menus, drags, or pointer holds', () => {
    const { actions } = createBrowserProvider(fakePage()).descriptor();
    expect(actions).toContain('navigate');
    expect(actions).toContain('click_element');
    expect(actions).toContain('get_window_state');
    for (const missing of ['list_apps', 'bring_to_front', 'invoke_menu', 'mouse_move', 'left_click_drag', 'clipboard_set']) {
      expect(actions).not.toContain(missing);
    }
  });

  it('reads the page into refs and clicks an element at its live centre', async () => {
    const page = fakePage();
    const provider = createBrowserProvider(page);
    const read = await provider.act({ name: 'get_window_state', input: {} }, signal);
    const view = read.observation as WindowObservationView;
    expect(view.kind).toBe('window');
    expect(view.tree).toMatch(/e3 \| button \| Continue/);

    const clicked = await provider.act(
      { name: 'click_element', input: { observation_id: view.observationId, ref: 'e3' } },
      signal,
    );
    expect(clicked.error).toBeUndefined();
    // Scrolled into view and measured first, then clicked at the centre, then re-read.
    expect(page.calls).toEqual(['snapshot', 'locate 0:1', 'click 250,220 left x1', 'snapshot']);
    expect(clicked.observation?.kind).toBe('window');
  });

  // A native <select> opens an OS menu no snapshot sees; clicking it looked
  // like nothing happened, so the model clicked it open and shut forever.
  it('refuses to click a native dropdown and names its options for set_value', async () => {
    const page = fakePage();
    page.dropdowns[0] = ['Small', 'Medium', 'Large'];
    const provider = createBrowserProvider(page);
    const view = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    const clicked = await provider.act({ name: 'click_element', input: { observation_id: view.observationId, ref: 'e2' } }, signal);
    expect(clicked.error?.code).toBe('INVALID_REQUEST');
    expect(clicked.error?.detail).toMatch(/set_value on it with one of: Small, Medium, Large/);
    expect(page.calls).not.toContain(expect.stringMatching(/^click /));
  });

  // The stall detector counts actions that changed nothing; in this browser
  // actions end in a page read, so the read has to carry that verdict.
  it('marks a page read unchanged when it repeats the last full read', async () => {
    const provider = createBrowserProvider(fakePage());
    const first = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    expect(first.unchanged).toBeUndefined();
    const again = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    expect(again.unchanged).toBe(true);
    const filtered = (await provider.act({ name: 'get_window_state', input: { query: 'email' } }, signal))
      .observation as WindowObservationView;
    expect(filtered.unchanged).toBeUndefined();
  });

  it('types by focusing then inserting, and sets values through the page', async () => {
    const page = fakePage();
    const provider = createBrowserProvider(page);
    const view = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    await provider.act({ name: 'type_into', input: { observation_id: view.observationId, ref: 'e2', text: 'ada@x.io' } }, signal);
    expect(page.calls).toContain('focus 0');
    expect(page.calls).toContain('insert ada@x.io');
    const fresh = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    await provider.act({ name: 'set_value', input: { observation_id: fresh.observationId, ref: 'e2', value: 'x' } }, signal);
    expect(page.calls).toContain('set 0=x');
  });

  it('refuses a ref from a superseded read', async () => {
    const provider = createBrowserProvider(fakePage());
    const first = (await provider.act({ name: 'get_window_state', input: {} }, signal)).observation as WindowObservationView;
    await provider.act({ name: 'get_window_state', input: {} }, signal);
    const stale = await provider.act({ name: 'click_element', input: { observation_id: first.observationId, ref: 'e3' } }, signal);
    expect(stale.error?.code).toBe('STALE_OBSERVATION');
  });

  it('only navigates to http(s), and carries the URL on resolved observations', async () => {
    const page = fakePage();
    const provider = createBrowserProvider(page);
    expect((await provider.act({ name: 'navigate', input: { url: 'file:///etc/passwd' } }, signal)).error?.code).toBe('INVALID_REQUEST');
    const opened = await provider.act({ name: 'navigate', input: { url: 'https://shop.example/' } }, signal);
    expect(page.calls[0]).toBe('navigate https://shop.example/');
    const view = opened.observation as WindowObservationView;
    expect(provider.resolveElements(view.observationId)?.url).toBe('https://shop.example/checkout');
  });

  it('keeps the frame id while the page is unchanged, and needs it for coordinates', async () => {
    const page = fakePage();
    const provider = createBrowserProvider(page);
    const first = await provider.snapshot();
    const again = (await provider.act({ name: 'screenshot', input: {} }, signal)).observation;
    expect(again).toMatchObject({ kind: 'screen', frameId: first.frameId, unchanged: true });

    const missing = await provider.act({ name: 'left_click', input: { coordinate: [10, 10] } }, signal);
    expect(missing.error?.code).toBe('INVALID_REQUEST');
    const clicked = await provider.act({ name: 'left_click', input: { coordinate: [10, 10], frame_id: first.frameId } }, signal);
    expect(clicked.error).toBeUndefined();
    expect(page.calls).toContain('click 10,10 left x1');

    page.hash = 'h2';
    const changed = (await provider.act({ name: 'screenshot', input: {} }, signal)).observation;
    expect(changed).toMatchObject({ kind: 'screen', base64: 'AAAA' });
    expect((changed as { frameId: string }).frameId).not.toBe(first.frameId);
  });

  it('never flies the dot or draws: the page is not on the user\'s screen', () => {
    const provider = createBrowserProvider(fakePage());
    expect(provider.locate({ name: 'click_element', input: {} })).toBeNull();
    expect(provider.elementBox('x', 'e1')).toBeNull();
    expect(provider.targetApp({ name: 'click_element', input: {} })).toBe("Buddy's browser — shop.example");
    expect(provider.targetApp({ name: 'get_window_state', input: {} })).toBeNull();
  });

  it('acts on an element named in plain words when Jev picks it, with no ref round trip', async () => {
    const page = fakePage();
    const jev: Jev = {
      async choices(state, asks) {
        expect(state).toMatchObject({ wanted: 'the Continue button' });
        const options = (asks as Record<string, { options: Record<string, string | null> }>)['pick']!.options;
        expect(Object.keys(options)).toEqual(['e2', 'e3', 'none']);
        return { pick: { choice: 'e3', confidence: 0.9 } } as Awaited<ReturnType<Jev['choices']>>;
      },
      judge: async () => null,
    };
    const provider = createBrowserProvider(page, jev);
    expect(provider.descriptor().jev).toBe(true);
    const clicked = await provider.act({ name: 'click_element', input: { element: 'the Continue button' } }, signal);
    expect(clicked.error).toBeUndefined();
    expect(clicked.text).toContain('"the Continue button" is e3');
    expect(page.calls).toEqual(['snapshot', 'locate 0:1', 'click 250,220 left x1', 'snapshot']);
  });

  it('refuses element in plain words without Jev, naming the key', async () => {
    const provider = createBrowserProvider(fakePage());
    expect(provider.descriptor().jev).toBe(false);
    const outcome = await provider.act({ name: 'click_element', input: { element: 'the Continue button' } }, signal);
    expect(outcome.error?.detail).toContain('Jev');
  });

  it('wait_for polls the page for the element text', async () => {
    vi.useFakeTimers();
    try {
      const page = fakePage();
      const provider = createBrowserProvider(page);
      const pending = provider.act({ name: 'wait_for', input: { element_text: 'continue', until: 'appears' } }, signal);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.text).toMatch(/Condition met/);
      expect(result.observation?.kind).toBe('window');
    } finally {
      vi.useRealTimers();
    }
  });
});
