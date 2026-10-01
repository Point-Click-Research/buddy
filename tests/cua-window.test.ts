// The window and element dispatch, against a fake driver: that a ref is
// checked before anything happens, that acting re-binds the refs it just
// invalidated, and that Buddy addresses the driver the way its contract
// says to.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { Jev, JevAsk, JevChoice, JevOptions, JevState } from '../src/main/ai/jev';
import type { CuaIo } from '../src/main/computer/cua-io';
import { runWindowAction, unreadWindowAt } from '../src/main/computer/cua-window';
import { ObservationRegistry } from '../src/main/computer/observations';
import type { ScreenObservation, WindowObservationView } from '../src/main/computer/provider';

const TEXT_EDIT = readFileSync(join(__dirname, 'fixtures', 'window-state-textedit.json'), 'utf8');
const RECORDED = JSON.parse(TEXT_EDIT) as { pid: number; window_id: number; snapshot_id: string };

const SHOT: ScreenObservation = { kind: 'screen', frameId: 'f1', base64: 'shot', width: 1280, height: 800 };

function window(overrides: Record<string, unknown> = {}) {
  return {
    window_id: RECORDED.window_id,
    pid: RECORDED.pid,
    app_name: 'TextEdit',
    title: 'Untitled',
    bounds: { x: 214, y: 112, width: 586, height: 488 },
    is_on_screen: true,
    z_index: 40,
    ...overrides,
  };
}

const WINDOWS = JSON.stringify({ windows: [window()] });

/** macOS says TextEdit is the app in front. */
const APPS = JSON.stringify({
  apps: [
    { pid: 900, name: 'Cursor', running: true, active: false },
    { pid: RECORDED.pid, name: 'TextEdit', running: true, active: true },
  ],
});

function setup(responses: Record<string, string | undefined> = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const claims: string[] = [];
  // The driver issues a new snapshot_id on every reading of a window, which
  // is what makes the previous refs stale.
  let snapshot = Number(RECORDED.snapshot_id.slice(1));
  const windowState = (): string =>
    TEXT_EDIT.replace(new RegExp(RECORDED.snapshot_id, 'g'), `s${String(snapshot++).padStart(8, '0')}`);

  const io: CuaIo = {
    settleMs: 0,
    observations: new ObservationRegistry(),
    async call(tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      const structured =
        tool in responses
          ? responses[tool]
          : tool === 'list_windows'
            ? WINDOWS
            : tool === 'list_apps'
              ? APPS
              : tool === 'get_window_state'
                ? windowState()
                : undefined;
      return { text: 'ok', isError: false, ...(structured ? { structuredJson: structured } : {}) };
    },
    frames: {
      screenshot: async () => SHOT,
      zoom: async () => SHOT,
      checkFrame: () => null,
      toScreen: (x: number, y: number) => ({ x, y }),
      toImage: (point: { x: number; y: number }) => point,
      toNative: (x: number, y: number) => ({ x, y }),
    },
    hooks: {
      recordKey: () => claims.push('key'),
      recordMousePosition: () => claims.push('mouse'),
      markTyping: () => claims.push('typing'),
      markMouseActivity: () => claims.push('moving'),
    },
  };
  return { io, calls, claims };
}

/** Read the window, which is how every element action starts. */
async function observe(io: CuaIo): Promise<WindowObservationView> {
  const outcome = await runWindowAction('get_window_state', {}, io);
  const observation = outcome.observation;
  if (observation?.kind !== 'window') throw new Error('expected a window observation');
  return observation;
}

describe('choosing which window to read', () => {
  it('defaults to the front window, so the model need not ask twice', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    expect(calls.map((call) => call.tool)).toEqual(['list_windows', 'list_apps', 'get_window_state']);
    expect(calls[2]?.args).toMatchObject({ pid: RECORDED.pid, window_id: RECORDED.window_id });
    expect(view.title).toBe('Untitled');
  });

  it('asks macOS which app is in front instead of trusting stacking order', async () => {
    // z_index is allowed to be null, and then every window ties and the
    // first one listed wins — which once had Buddy reading a code editor
    // while the user was looking at a browser.
    const { io, calls } = setup({
      list_windows: JSON.stringify({
        windows: [
          window({ window_id: 1, pid: 900, app_name: 'Cursor', title: 'code', z_index: null }),
          window({ z_index: null }),
        ],
      }),
    });
    await observe(io);
    expect(calls.at(-1)?.args).toMatchObject({ pid: RECORDED.pid, window_id: RECORDED.window_id });
  });

  it('looks up the pid when the model sends only a window_id', async () => {
    // The driver needs both halves; a model naturally sends the one it read
    // off the list. Acting on some other window instead would be a lie.
    const { io, calls } = setup();
    await runWindowAction('get_window_state', { window_id: RECORDED.window_id }, io);
    expect(calls.at(-1)?.args).toMatchObject({ pid: RECORDED.pid, window_id: RECORDED.window_id });
  });

  it('refuses a window_id that is not open rather than acting on another window', async () => {
    const { io, calls } = setup();
    const outcome = await runWindowAction('get_window_state', { window_id: 4242 }, io);
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('4242');
    expect(calls.some((call) => call.tool === 'get_window_state')).toBe(false);
  });

  it('never offers Buddy its own windows as a target', async () => {
    const { io } = setup({
      list_windows: JSON.stringify({
        windows: [window({ window_id: 5, pid: process.pid, app_name: 'Electron', title: 'Buddy' })],
      }),
    });
    const listed = await runWindowAction('list_windows', {}, io);
    expect(listed.text).not.toContain('Buddy');
    expect((await runWindowAction('get_window_state', {}, io)).error?.code).toBe('INVALID_REQUEST');
  });

  it('takes the window the model named without listing anything', async () => {
    const { io, calls } = setup();
    await runWindowAction('get_window_state', { pid: 7, window_id: 8 }, io);
    expect(calls.map((call) => call.tool)).toEqual(['get_window_state']);
  });

  it('never asks the driver for the window image', async () => {
    // A window picture has its own pixel space; a second coordinate space is
    // a misclick waiting to happen, so pixels only ever come from the screen.
    const { io, calls } = setup();
    await observe(io);
    expect(calls.at(-1)?.args).toMatchObject({ include_screenshot: false });
  });

  it('reports what it filtered away, so the counts are not a mystery', async () => {
    const { io } = setup();
    const view = await observe(io);
    expect(view.total).toBe(189);
    expect(view.kept).toBeLessThan(25);
    expect(view.shown).toBe(view.kept);
    expect(view.observationId).toBe(RECORDED.snapshot_id);
  });

  it('passes a text filter through for windows with huge trees', async () => {
    const { io, calls } = setup();
    await runWindowAction('get_window_state', { pid: 7, window_id: 8, query: 'send' }, io);
    expect(calls[0]?.args).toMatchObject({ query: 'send' });
  });

  it('says up front when an app hides its content, instead of letting the model hunt', async () => {
    const safari = TEXT_EDIT.replace('"app_name":"TextEdit"', '"app_name":"Safari"');
    const { io } = setup({ get_window_state: safari });
    const outcome = await runWindowAction('get_window_state', { pid: 7, window_id: 8 }, io);
    const view = outcome.observation as WindowObservationView;
    expect(view.degradedReason).toContain('not the page');
  });

  it('retries with the real owner when macOS hosts the window elsewhere', async () => {
    // A sandboxed app's Save panel belongs to the panel service, not the
    // app, so the first read is refused and names who really owns it.
    const asked: unknown[] = [];
    const { io } = setup();
    const owned = io.call;
    io.call = async (tool: string, args: Record<string, unknown>) => {
      if (tool !== 'get_window_state') return owned(tool, args);
      asked.push(args['pid']);
      return asked.length === 1
        ? {
            text: 'window_owner_pid_mismatch: owner_pid 21788',
            isError: true,
            errorCode: 'window_owner_pid_mismatch',
          }
        : owned(tool, args);
    };
    const outcome = await runWindowAction('get_window_state', { pid: 21787, window_id: 8 }, io);
    expect(outcome.observation?.kind).toBe('window');
    expect(asked).toEqual([21787, 21788]);
  });

  it('attributes a click to the frontmost app, not a large window behind it', async () => {
    // Recorded run: with every z_index null, a click in the frontmost
    // browser was blamed on the Notes window behind it, and reading the
    // browser never lifted the gate — the whole task fell back to keyboard.
    const { io } = setup({
      list_windows: JSON.stringify({
        windows: [
          window({
            window_id: 9,
            pid: 555,
            app_name: 'Notes',
            title: 'Notes',
            bounds: { x: 0, y: 0, width: 1400, height: 900 },
            z_index: null,
          }),
          window({ z_index: null }),
        ],
      }),
    });
    const blocked = await unreadWindowAt(io, 300, 300);
    expect(blocked?.detail).toContain(`pid ${RECORDED.pid}`);

    await runWindowAction('get_window_state', { pid: RECORDED.pid, window_id: RECORDED.window_id }, io);
    expect(await unreadWindowAt(io, 300, 300)).toBeNull();
  });

  it('never lets an unreadable window become one that can never be clicked', async () => {
    // The Save dialog could not be read, and because nothing was recorded
    // the click was refused, so the model read it again, and looped.
    const { io } = setup({ get_window_state: undefined });
    const blocked = await unreadWindowAt(io, 300, 300);
    expect(blocked?.code).toBe('WINDOW_NOT_READ');

    await runWindowAction('get_window_state', { pid: RECORDED.pid, window_id: RECORDED.window_id }, io);
    expect(await unreadWindowAt(io, 300, 300)).toBeNull();
  });

  it('says why a window could not be read instead of swallowing the reason', async () => {
    const { io } = setup({ get_window_state: undefined });
    io.call = async () => ({ text: 'ax_window_unresolved', isError: true, errorCode: 'ax_window_unresolved' });
    const outcome = await runWindowAction('get_window_state', { pid: 1, window_id: 2 }, io);
    expect(outcome.text).toContain('ax_window_unresolved');
  });

  it('falls back to the screen when the window cannot be read', async () => {
    const { io } = setup({ get_window_state: undefined });
    const outcome = await runWindowAction('get_window_state', { pid: 7, window_id: 8 }, io);
    expect(outcome.observation?.kind).toBe('screen');
    expect(outcome.text).toContain('could not be read');
  });
});

describe('acting on an element', () => {
  it('sends the driver the token the ref stands for', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    await runWindowAction('click_element', { observation_id: view.observationId, ref: 'e3' }, io);

    const click = calls.find((call) => call.tool === 'click');
    expect(click?.args).toMatchObject({
      pid: RECORDED.pid,
      window_id: RECORDED.window_id,
      element_token: `${RECORDED.snapshot_id}:18`,
    });
    // No coordinate, and so no pointer move: the user keeps their cursor.
    expect(click?.args['x']).toBeUndefined();
  });

  it('reads the window again afterwards, because the action replaced the refs', async () => {
    const { io, calls } = setup();
    const before = await observe(io);
    const after = await runWindowAction(
      'click_element',
      { observation_id: before.observationId, ref: 'e3' },
      io,
    );
    const view = after.observation as WindowObservationView;
    expect(view.kind).toBe('window');
    expect(view.observationId).not.toBe(before.observationId);
    expect(calls.filter((call) => call.tool === 'get_window_state').length).toBe(2);
  });

  it('refuses a ref from a superseded observation before touching the driver', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    await runWindowAction('get_window_state', { pid: RECORDED.pid, window_id: RECORDED.window_id }, io);
    const before = calls.length;

    const outcome = await runWindowAction('click_element', { observation_id: view.observationId, ref: 'e3' }, io);
    expect(outcome.error?.code).toBe('STALE_OBSERVATION');
    expect(calls.length).toBe(before);
  });

  it('refuses to press something that cannot be pressed, and says what to do instead', async () => {
    // The driver's own failure here is a raw AX error code. The element said
    // which actions it takes when it was read, so this is knowable earlier.
    const { io, calls } = setup();
    const view = await observe(io);
    const before = calls.length;
    const outcome = await runWindowAction(
      'click_element',
      { observation_id: view.observationId, ref: 'e2' },
      io,
    );
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('set_value');
    expect(calls.length).toBe(before);
  });

  it('refuses an element action with no observation_id', async () => {
    const { io } = setup();
    const view = await observe(io);
    expect((await runWindowAction('click_element', { ref: 'e3' }, io)).error?.code).toBe('INVALID_REQUEST');
    expect(
      (await runWindowAction('click_element', { observation_id: view.observationId }, io)).error?.code,
    ).toBe('INVALID_REQUEST');
  });

  it('fills a field with set_value rather than keystrokes', async () => {
    const { io, calls, claims } = setup();
    const view = await observe(io);
    await runWindowAction('set_value', { observation_id: view.observationId, ref: 'e9', value: 'Georgia' }, io);
    expect(calls.find((call) => call.tool === 'set_value')?.args).toMatchObject({ value: 'Georgia' });
    // Nothing was typed, so nothing needed claiming from the safety rails.
    expect(claims).toEqual([]);
  });

  it('types into an element in pieces, and stops between them when asked', async () => {
    const { io, calls, claims } = setup();
    const view = await observe(io);
    const stop = new AbortController();
    stop.abort();
    await runWindowAction(
      'type_into',
      { observation_id: view.observationId, ref: 'e2', text: 'x'.repeat(200) },
      io,
      stop.signal,
    );
    const typed = calls.filter((call) => call.tool === 'type_text');
    expect(typed.length).toBe(1);
    expect(String(typed[0]?.args['text']).length).toBe(40);
    // Synthetic keystrokes are claimed, or they read as the user taking over.
    expect(claims).toContain('typing');
  });

  it('types the whole value when nothing interrupts', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    await runWindowAction(
      'type_into',
      { observation_id: view.observationId, ref: 'e2', text: 'x'.repeat(100) },
      io,
    );
    expect(calls.filter((call) => call.tool === 'type_text').length).toBe(3);
  });
});

describe('right-clicking an element', () => {
  it('sends the driver a right button with the token, and no coordinate', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    await runWindowAction('right_click_element', { observation_id: view.observationId, ref: 'e2' }, io);
    const click = calls.find((call) => call.tool === 'click');
    expect(click?.args).toMatchObject({ button: 'right' });
    expect(click?.args['element_token']).toBeDefined();
    expect(click?.args['x']).toBeUndefined();
  });
});

describe('waiting for a window predicate', () => {
  it('returns the fresh window the moment the element is there', async () => {
    const { io, calls } = setup();
    const outcome = await runWindowAction(
      'wait_for',
      { pid: RECORDED.pid, window_id: RECORDED.window_id, element_text: 'bold' },
      io,
    );
    expect(outcome.text).toContain('Condition met');
    expect(outcome.observation?.kind).toBe('window');
    // One poll that matched, then the recorded read the fresh refs come from.
    expect(calls.filter((call) => call.tool === 'get_window_state').length).toBe(2);
  });

  it('says so when time runs out, and still shows the window', async () => {
    const { io } = setup();
    const outcome = await runWindowAction(
      'wait_for',
      { pid: RECORDED.pid, window_id: RECORDED.window_id, element_text: 'no such thing', duration: 1 },
      io,
    );
    expect(outcome.text).toContain('Timed out');
    expect(outcome.observation?.kind).toBe('window');
  });

  it('needs element_text or condition, and a known until', async () => {
    const { io } = setup();
    expect((await runWindowAction('wait_for', { pid: 7, window_id: 8 }, io)).error?.code).toBe('INVALID_REQUEST');
    expect(
      (await runWindowAction('wait_for', { pid: 7, window_id: 8, element_text: 'x', until: 'blinks' }, io)).error
        ?.code,
    ).toBe('INVALID_REQUEST');
  });

  it('refuses a plain-language condition without Jev', async () => {
    const { io } = setup();
    const outcome = await runWindowAction('wait_for', { pid: 7, window_id: 8, condition: 'the file is saved' }, io);
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('Jev');
  });

  it('judges a plain-language condition by Jev when it is configured', async () => {
    const { io } = setup();
    io.jev = jevOf(
      () => null,
      async (state, question) => {
        expect(JSON.stringify(state)).toContain('TextEdit');
        expect(question).toContain('the document is open');
        return 0.95;
      },
    );
    const outcome = await runWindowAction(
      'wait_for',
      { pid: RECORDED.pid, window_id: RECORDED.window_id, condition: 'the document is open' },
      io,
    );
    expect(outcome.text).toContain('Condition met');
  });
});

/** A Jev whose choice is decided by the test, and whose yes/no is fixed. */
function jevOf(
  pick: (state: JevState, question: string, options: JevOptions) => JevChoice | null,
  judge: Jev['judge'] = async () => null,
): Jev {
  return {
    async choices(state, asks) {
      return Object.fromEntries(
        Object.entries(asks).map(([name, ask]) => [name, pick(state, (ask as JevAsk).question, (ask as JevAsk).options)]),
      ) as Awaited<ReturnType<Jev['choices']>>;
    },
    judge,
  };
}

describe('acting on an element named in plain words', () => {
  it('reads the window, lets Jev pick the ref, and acts on it in one call', async () => {
    const { io, calls } = setup();
    io.jev = jevOf((state, _question, options) => {
      expect(state).toMatchObject({ wanted: 'the ruler' });
      // Every candidate is one row keyed by its ref, plus the way out.
      expect(options['none']).toBeDefined();
      expect(options['e3']).toMatch(/^e3 \| /);
      return { choice: 'e3', confidence: 0.92 };
    });
    const outcome = await runWindowAction('click_element', { element: 'the ruler' }, io);
    expect(outcome.error).toBeUndefined();
    expect(outcome.text).toContain('"the ruler" is e3');
    // No ref was ever sent: the read, the pick, the click, then the re-read.
    expect(calls.map((call) => call.tool)).toEqual([
      'list_windows',
      'list_apps',
      'get_window_state',
      'click',
      'get_window_state',
    ]);
    expect(String(calls.find((call) => call.tool === 'click')?.args['element_token'])).toMatch(/^s\d+:/);
  });

  it('refuses rather than guesses when nothing matches confidently', async () => {
    const { io, calls } = setup();
    io.jev = jevOf(() => ({ choice: 'none', confidence: 0.99 }));
    const outcome = await runWindowAction('click_element', { element: 'the purchase button' }, io);
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('the purchase button');
    expect(calls.some((call) => call.tool === 'click')).toBe(false);
  });

  it('says a key is needed when Jev is not configured', async () => {
    const { io, calls } = setup();
    const outcome = await runWindowAction('set_value', { element: 'the name field', value: 'Zach' }, io);
    expect(outcome.error?.detail).toContain('Jev');
    expect(calls).toHaveLength(0);
  });
});

describe('re-binding a stale ref by Jev', () => {
  /** Observe twice, so the first observation's refs are dead. */
  async function staleSetup() {
    const bound = setup();
    const before = await observe(bound.io);
    await runWindowAction('get_window_state', { pid: RECORDED.pid, window_id: RECORDED.window_id }, bound.io);
    return { ...bound, before };
  }

  it('matches the old element to the fresh rows and proceeds there', async () => {
    const { io, calls, before } = await staleSetup();
    io.jev = jevOf((state, _question, options) => {
      // The stale element's own line is what is wanted; the same control
      // renders identically among the fresh observation's candidates.
      const wanted = (state as { wanted: string }).wanted;
      const match = Object.entries(options).find(([label, line]) => label !== 'none' && wanted.endsWith(line!));
      expect(match).toBeDefined();
      return { choice: match![0], confidence: 0.9 };
    });
    const outcome = await runWindowAction(
      'click_element',
      { observation_id: before.observationId, ref: 'e3' },
      io,
    );
    expect(outcome.error).toBeUndefined();
    expect(outcome.text).toContain('stale');
    const click = calls.find((call) => call.tool === 'click');
    // The token acted on belongs to the fresh observation, not the dead one.
    expect(String(click?.args['element_token']).startsWith('s00000005:')).toBe(true);
  });

  it('keeps the refusal when the answer is not confident', async () => {
    const { io, calls, before } = await staleSetup();
    io.jev = jevOf(() => ({ choice: 'e3', confidence: 0.5 }));
    const outcome = await runWindowAction(
      'click_element',
      { observation_id: before.observationId, ref: 'e3' },
      io,
    );
    expect(outcome.error?.code).toBe('STALE_OBSERVATION');
    expect(calls.some((call) => call.tool === 'click')).toBe(false);
  });

  it('keeps the refusal without Jev, exactly as before', async () => {
    const { io, calls, before } = await staleSetup();
    const outcome = await runWindowAction(
      'click_element',
      { observation_id: before.observationId, ref: 'e3' },
      io,
    );
    expect(outcome.error?.code).toBe('STALE_OBSERVATION');
    expect(calls.some((call) => call.tool === 'click')).toBe(false);
  });
});

describe('expanding part of a tree', () => {
  it('shows what is inside an element without re-reading the window', async () => {
    const { io, calls } = setup();
    const view = await observe(io);
    const before = calls.length;
    const outcome = await runWindowAction(
      'expand_element',
      { observation_id: view.observationId, ref: 'e11' },
      io,
    );
    expect(calls.length).toBe(before);
    // The combo box's own stepper button is the element inside it.
    expect(outcome.text).toContain('e12');
  });

  it('says so when there is nothing inside', async () => {
    const { io } = setup();
    const view = await observe(io);
    const outcome = await runWindowAction('expand_element', { observation_id: view.observationId, ref: 'e3' }, io);
    expect(outcome.text).toContain('no elements inside');
  });
});

describe('windows and menus', () => {
  it('lists windows and apps as text, not as another screenshot', async () => {
    const { io } = setup();
    const windows = await runWindowAction('list_windows', {}, io);
    expect(windows.text).toContain(`pid ${RECORDED.pid} window_id ${RECORDED.window_id}`);
    expect(windows.observation).toBeUndefined();
  });

  it('invokes a menu by path against the front window', async () => {
    const { io, calls } = setup();
    const outcome = await runWindowAction('invoke_menu', { path: ['Format', 'Font', 'Bold'] }, io);
    expect(calls.find((call) => call.tool === 'invoke_menu')?.args).toMatchObject({
      pid: RECORDED.pid,
      window_id: RECORDED.window_id,
      path: ['Format', 'Font', 'Bold'],
    });
    // A menu can change anything on screen, so the screen is what comes back.
    expect(outcome.observation?.kind).toBe('screen');
  });

  it('refuses a menu path that is not a list of labels', async () => {
    const { io, calls } = setup();
    for (const path of [undefined, [], 'File', ['File', 7]]) {
      const outcome = await runWindowAction('invoke_menu', { path }, io);
      expect(outcome.error?.code, String(path)).toBe('INVALID_REQUEST');
    }
    expect(calls).toEqual([]);
  });

  it('still reports "unverifiable" where the driver really does check', async () => {
    // bring_to_front verifies the window actually became frontmost, so this
    // verdict is news — unlike on a desktop click, where it is the norm.
    const { io } = setup();
    io.call = async () => ({ text: 'ok', isError: false, action: { effect: 2 } });
    const outcome = await runWindowAction('bring_to_front', { pid: 3, window_id: 4 }, io);
    expect(outcome.text).toContain('could not verify');
  });

  it('brings a window to the front and shows the result', async () => {
    const { io, calls } = setup();
    const outcome = await runWindowAction('bring_to_front', { pid: 3, window_id: 4 }, io);
    expect(calls[0]).toMatchObject({ tool: 'bring_to_front', args: { pid: 3, window_id: 4 } });
    expect(outcome.observation?.kind).toBe('screen');
  });

  it('says what to do when no window matches', async () => {
    const { io } = setup({ list_windows: JSON.stringify({ windows: [] }) });
    const outcome = await runWindowAction('get_window_state', {}, io);
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('list_windows');
  });
});
