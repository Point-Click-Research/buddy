// The Cua provider's dispatch, against a fake driver: that it claims its own
// input with the safety rails, that coordinates are checked against the frame
// they were measured in, and that driver failures become Buddy's typed errors.

import { describe, expect, it } from 'vitest';
import type { CuaIo } from '../src/main/computer/cua-io';
import { runCuaAction } from '../src/main/computer/cua-provider';
import { runWindowAction } from '../src/main/computer/cua-window';
import { computerError } from '../src/main/computer/errors';
import { uiohookCodeFor } from '../src/main/computer/keycodes';
import { ObservationRegistry } from '../src/main/computer/observations';
import type { ScreenObservation } from '../src/main/computer/provider';
import { SyntheticKeyFilter, AgentMouseTracker } from '../src/main/agent/synthetic';

const FRAME_ID = 'f1';
const SHOT: ScreenObservation = {
  kind: 'screen',
  frameId: FRAME_ID,
  base64: 'shot',
  width: 1280,
  height: 800,
};

/** Every coordinate action must name the frame it measured. */
const FRAME = { frame_id: FRAME_ID };

interface FakeResult {
  isError?: boolean;
  errorCode?: string;
  text?: string;
  effect?: number;
  /** Per-tool structuredContent, for the tools that return some. */
  structured?: Record<string, string>;
}

/** Just enough of a window reading for the look-first rule to be satisfied. */
function windowState(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool !== 'get_window_state') return undefined;
  return JSON.stringify({
    pid: args['pid'],
    window_id: args['window_id'],
    snapshot_id: 's00000001',
    app_name: 'Dia',
    window_title: 'New Tab',
    total_element_count: 1,
    elements: [
      { element_index: 0, role: 'AXWindow', depth: 0, label: 'New Tab', frame: { x: 0, y: 0, w: 2000, h: 1200 } },
    ],
  });
}

function setup(result: FakeResult = {}) {
  const claims: string[] = [];
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const keyFilter = new SyntheticKeyFilter();
  const mouseTracker = new AgentMouseTracker();

  const io: CuaIo = {
    settleMs: 0,
    observations: new ObservationRegistry(),
    async call(tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      const structured = result.structured?.[tool] ?? windowState(tool, args);
      return {
        text: result.text ?? 'ok',
        isError: result.isError ?? false,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        ...(structured ? { structuredJson: structured } : {}),
        action: { effect: result.effect ?? 0 },
      };
    },
    frames: {
      screenshot: async () => SHOT,
      zoom: async () => SHOT,
      checkFrame: (frameId: unknown) => {
        // Mirrors FrameRegistry.check: a missing id is a malformed call, a
        // wrong one is a stale measurement.
        if (typeof frameId !== 'string' || !frameId) {
          return computerError('INVALID_REQUEST', 'Coordinates need a frame_id.');
        }
        return frameId === FRAME_ID ? null : computerError('STALE_FRAME', `${frameId} is not current.`);
      },
      // One frame pixel is 2 DIP across, 2 down, and 2 native pixels.
      toScreen: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
      toImage: (point: { x: number; y: number }) => ({ x: point.x / 2, y: point.y / 2 }),
      toNative: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
    },
    hooks: {
      recordKey: (keycode: number, direction: 'down' | 'up') => {
        claims.push(`key(${keycode},${direction})`);
        keyFilter.record(keycode, direction, Date.now());
      },
      recordMousePosition: (x: number, y: number) => {
        claims.push(`mouse(${x},${y})`);
        mouseTracker.recordPosition(x, y);
      },
      markTyping: (ms: number) => {
        claims.push('typing');
        keyFilter.markTyping(Date.now() + ms);
      },
      markMouseActivity: (ms: number) => {
        claims.push('moving');
        mouseTracker.markActivity(Date.now() + ms);
      },
    },
  };
  return { io, claims, calls, keyFilter, mouseTracker };
}

describe('Cua actions claim their input before synthesizing it', () => {
  it('covers typed text with a typing window, so it is not read as a takeover', async () => {
    const { io, keyFilter } = setup();
    await runCuaAction('type', { text: 'hello there' }, io);
    // This is the check that failed in practice: uiohook sees the driver's
    // keystrokes, and without the window they pause the task.
    expect(keyFilter.isTyping(Date.now())).toBe(true);
  });

  // The real events arrive while the driver is pressing the key, not after
  // the post-action settle delay, so they are matched at that moment.
  it('records the exact keycodes of a combo, so the agent never trips the kill switch', async () => {
    const { io, keyFilter } = setup();
    const arrival = Date.now();
    await runCuaAction('key', { text: 'cmd+s' }, io);

    const cmd = uiohookCodeFor('cmd')!;
    const s = uiohookCodeFor('s')!;
    // shouldIgnore consumes one recording per observed event, exactly as the
    // uiohook tap does when these events arrive.
    expect(keyFilter.shouldIgnore(cmd, 'down', arrival)).toBe(true);
    expect(keyFilter.shouldIgnore(s, 'down', arrival)).toBe(true);
    expect(keyFilter.shouldIgnore(s, 'up', arrival)).toBe(true);
    // A key the agent did not press is still the user's.
    expect(keyFilter.shouldIgnore(uiohookCodeFor('q')!, 'down', arrival)).toBe(false);
  });

  it('claims its own Escape, while a second Escape still reaches the kill switch', async () => {
    const { io, keyFilter } = setup();
    const arrival = Date.now();
    await runCuaAction('key', { text: 'Escape' }, io);
    const escape = uiohookCodeFor('escape')!;
    expect(keyFilter.shouldIgnore(escape, 'down', arrival)).toBe(true);
    expect(keyFilter.shouldIgnore(escape, 'down', arrival)).toBe(false);
  });

  it('claims each repeat of a repeated key', async () => {
    const { io, claims } = setup();
    await runCuaAction('key', { text: 'down', repeat: 3 }, io);
    const code = uiohookCodeFor('down')!;
    expect(claims.filter((c) => c === `key(${code},down)`).length).toBe(3);
  });

  it('claims the pointer destination in screen DIP for clicks, moves, drags and scrolls', async () => {
    for (const action of [
      { name: 'left_click', input: { coordinate: [100, 200], ...FRAME } },
      { name: 'mouse_move', input: { coordinate: [100, 200], ...FRAME } },
      { name: 'scroll', input: { coordinate: [100, 200], ...FRAME, scroll_direction: 'down' } },
      {
        name: 'left_click_drag',
        input: { start_coordinate: [10, 10], coordinate: [100, 200], ...FRAME },
      },
    ]) {
      const { io, claims, mouseTracker } = setup();
      await runCuaAction(action.name, action.input as Record<string, unknown>, io);
      // toScreen doubles, so the frame point [100, 200] is DIP (200, 400).
      expect(claims, action.name).toContain('mouse(200,400)');
      expect(claims, action.name).toContain('moving');
      // The agent's own cursor sitting on the target is not a takeover.
      expect(mouseTracker.isUserMove(200, 400, Date.now()), action.name).toBe(false);
    }
  });

  it('leaves a real takeover detectable once the movement window closes', async () => {
    const { io, mouseTracker } = setup();
    await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    // Far from where the agent left the pointer, after the window expires.
    expect(mouseTracker.isUserMove(900, 900, Date.now() + 10_000)).toBe(true);
  });

  it('claims nothing for observation-only actions', async () => {
    const { io, claims } = setup();
    await runCuaAction('screenshot', {}, io);
    await runCuaAction('zoom', { region: [0, 0, 10, 10], ...FRAME }, io);
    expect(claims).toEqual([]);
  });

  it('does not claim a pointer move for a click without a coordinate', async () => {
    const { io, claims } = setup();
    await runCuaAction('left_click', {}, io);
    expect(claims).toEqual([]);
  });
});

describe('Cua actions check coordinates against their frame', () => {
  it('refuses a stale frame_id without touching the driver or the pointer', async () => {
    const { io, calls, claims } = setup();
    const outcome = await runCuaAction('left_click', { coordinate: [10, 10], frame_id: 'f0' }, io);
    expect(outcome.error?.code).toBe('STALE_FRAME');
    expect(calls).toEqual([]);
    // Nothing was claimed, so the rails aren't blinded for an action that
    // never happened.
    expect(claims).toEqual([]);
  });

  it('refuses a coordinate sent without a frame_id', async () => {
    const { io, calls } = setup();
    const outcome = await runCuaAction('mouse_move', { coordinate: [10, 10] }, io);
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(calls).toEqual([]);
  });

  it('checks both ends of a drag', async () => {
    const { io, calls } = setup();
    const outcome = await runCuaAction(
      'left_click_drag',
      { start_coordinate: [1, 1], coordinate: [2, 2], frame_id: 'f0' },
      io,
    );
    expect(outcome.error?.code).toBe('STALE_FRAME');
    expect(calls).toEqual([]);
  });

  it('checks the zoom region too', async () => {
    const { io } = setup();
    const outcome = await runCuaAction('zoom', { region: [0, 0, 10, 10], frame_id: 'f0' }, io);
    expect(outcome.error?.code).toBe('STALE_FRAME');
  });

  it('converts a valid coordinate to the driver\'s native pixels', async () => {
    const { io, calls } = setup();
    await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    // toNative doubles the frame pixels.
    expect(calls.find((call) => call.tool === 'click')?.args).toMatchObject({ x: 200, y: 400 });
  });
});

describe('looking at a window before clicking in it', () => {
  /** A window the model has not read, covering the point it wants to click. */
  const covering = JSON.stringify({
    windows: [
      {
        window_id: 77,
        pid: 12,
        app_name: 'Dia',
        title: 'New Tab',
        bounds: { x: 0, y: 0, width: 2000, height: 1200 },
        is_on_screen: true,
        z_index: 5,
      },
    ],
  });

  it('refuses the click and names the window to read', async () => {
    const { io, claims, calls } = setup({ structured: { list_windows: covering } });
    const outcome = await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    expect(outcome.error?.code).toBe('WINDOW_NOT_READ');
    expect(outcome.error?.detail).toContain('window_id 77');
    // Refused before anything moved, and before the rails were told it did.
    expect(calls.some((call) => call.tool === 'click')).toBe(false);
    expect(claims).toEqual([]);
  });

  it('lets the same coordinate through once that window has been read', async () => {
    // The rule is "look first", not "never use pixels": canvases, games and
    // apps that hide their content still need the coordinate to work.
    const { io, calls } = setup({ structured: { list_windows: covering } });
    await runWindowAction('get_window_state', { pid: 12, window_id: 77 }, io);
    const outcome = await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    expect(outcome.error).toBeUndefined();
    expect(calls.some((call) => call.tool === 'click')).toBe(true);
  });

  it('asks the driver nothing when a window already read covers the point', async () => {
    const { io, calls } = setup({ structured: { list_windows: covering } });
    await runWindowAction('get_window_state', { pid: 12, window_id: 77 }, io);
    const before = calls.length;
    await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    // One call: the click itself. The bounds came from the observation.
    expect(calls.length - before).toBe(1);
  });

  it('allows a click that is not over any window, like the menu bar', async () => {
    const { io } = setup({ structured: { list_windows: JSON.stringify({ windows: [] }) } });
    expect((await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io)).error).toBeUndefined();
  });

  it('does not stand in the way of hovering or scrolling', async () => {
    const { io } = setup({ structured: { list_windows: covering } });
    for (const action of [
      { name: 'mouse_move', input: { coordinate: [100, 200], ...FRAME } },
      { name: 'scroll', input: { coordinate: [100, 200], ...FRAME, scroll_direction: 'down' } },
    ]) {
      const outcome = await runCuaAction(action.name, action.input as Record<string, unknown>, io);
      expect(outcome.error, action.name).toBeUndefined();
    }
  });

  it('gets out of the way when the driver cannot say what is there', async () => {
    const { io } = setup({ isError: true, errorCode: 'unavailable' });
    // list_windows failing must not become a wall the task cannot pass.
    const outcome = await runCuaAction('left_click', { coordinate: [100, 200], ...FRAME }, io);
    expect(outcome.error?.code).not.toBe('WINDOW_NOT_READ');
  });
});

describe('Cua driver failures become typed errors', () => {
  it('maps the driver error code onto one of Buddy\'s own', async () => {
    const cases: Array<[string, string]> = [
      ['permission_denied', 'PERMISSION_MISSING'],
      ['stale_snapshot', 'STALE_OBSERVATION'],
      ['unsupported_display', 'UNSUPPORTED_DISPLAY'],
      ['unsupported_action', 'UNSUPPORTED_ACTION'],
      ['invalid_arguments', 'INVALID_REQUEST'],
      ['background_unavailable', 'REFUSED'],
      ['something_unrecognised', 'REFUSED'],
    ];
    for (const [errorCode, expected] of cases) {
      const { io } = setup({ isError: true, errorCode, text: 'the driver said no' });
      const outcome = await runCuaAction('type', { text: 'hi' }, io);
      expect(outcome.error?.code, errorCode).toBe(expected);
      // The driver's own reason is passed on, per the recovery hint.
      expect(outcome.error?.detail, errorCode).toContain('the driver said no');
      expect(outcome.error?.hint, errorCode).toBeTruthy();
    }
  });

  it('treats a refused effect as a failure even without an error flag', async () => {
    // ActionEffect.Refused is 4.
    const { io } = setup({ effect: 4, text: 'window would not accept it' });
    const outcome = await runCuaAction('type', { text: 'hi' }, io);
    expect(outcome.error?.code).toBe('REFUSED');
  });

  it('passes on an unverified effect as a note rather than an error', async () => {
    // An acknowledged action is not proof it worked: the model is told so and
    // asked to verify, instead of being handed a failure it cannot act on.
    const { io } = setup({ effect: 3 }); // SuspectedNoop
    const outcome = await runCuaAction('type', { text: 'hi' }, io);
    expect(outcome.error).toBeUndefined();
    expect(outcome.text).toContain('did nothing');
    expect(outcome.observation).toBeDefined();
  });

  it('says nothing extra when the driver confirms the effect', async () => {
    const { io } = setup({ effect: 0 }); // Confirmed
    const outcome = await runCuaAction('type', { text: 'hi' }, io);
    expect(outcome.text).toBeUndefined();
    expect(outcome.observation).toBeDefined();
  });

  it('stays quiet about "unverifiable", which desktop input always is', async () => {
    // Every click, keystroke and drag posts an OS event with nothing to read
    // back, so this verdict arrived on all of them. Repeating it each time
    // taught the model to distrust actions that had in fact worked.
    const { io } = setup({ effect: 2 }); // Unverifiable
    for (const action of [
      { name: 'type', input: { text: 'hi' } },
      { name: 'left_click', input: { coordinate: [10, 10], ...FRAME } },
      { name: 'key', input: { text: 'Return' } },
    ]) {
      const outcome = await runCuaAction(action.name, action.input as Record<string, unknown>, io);
      expect(outcome.text, action.name).toBeUndefined();
      expect(outcome.observation, action.name).toBeDefined();
    }
  });
});
