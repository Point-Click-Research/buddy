import { describe, expect, it } from 'vitest';
import { createBasicProvider, type BasicIo } from '../src/main/computer/basic-provider';
import type { DisplayFrames } from '../src/main/computer/display-capture';
import type { InputDriver } from '../src/main/computer/nut-driver';
import { computerError } from '../src/main/computer/errors';
import type { ScreenObservation } from '../src/main/computer/provider';

const FRAME_ID = 'f1';
const SHOT: ScreenObservation = {
  kind: 'screen',
  frameId: FRAME_ID,
  base64: 'shot-jpeg',
  width: 1280,
  height: 800,
};

/** Every coordinate action must name the frame it measured. */
const FRAME = { frame_id: FRAME_ID };

function fakeDriver(): InputDriver & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<void> => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    };
  return {
    calls,
    moveMouse: record('moveMouse'),
    click: record('click'),
    mouseDown: record('mouseDown'),
    mouseUp: record('mouseUp'),
    drag: record('drag'),
    scroll: record('scroll'),
    pressKeys: record('pressKeys'),
    typeText: record('typeText'),
    cursorPosition: async () => ({ x: 864, y: 558 }),
  };
}

// The test display: screenshots are 1280x800 and one image pixel is 1.35 x
// 1.4 DIP. The mapping itself is covered by the coords tests.
function fakeFrames(): DisplayFrames & { shots: number } {
  const frames = {
    shots: 0,
    async screenshot(): Promise<ScreenObservation> {
      frames.shots++;
      return SHOT;
    },
    zoom: async (): Promise<ScreenObservation> => ({ ...SHOT, base64: 'zoom-jpeg' }),
    checkFrame: (frameId: unknown) => {
      // Mirrors FrameRegistry.check: a missing id is a malformed call, a
      // wrong one is a stale measurement.
      if (typeof frameId !== 'string' || !frameId) {
        return computerError('INVALID_REQUEST', 'Coordinates need a frame_id.');
      }
      return frameId === FRAME_ID ? null : computerError('STALE_FRAME', `${frameId} is not current.`);
    },
    toScreen: (x: number, y: number) => ({ x: x * 1.35, y: y * 1.4 }),
    toImage: (point: { x: number; y: number }) => ({ x: point.x / 1.35, y: point.y / 1.4 }),
    toNative: (x: number, y: number) => ({ x: x * 2, y: y * 2 }),
  };
  return frames;
}

function setup() {
  const driver = fakeDriver();
  const frames = fakeFrames();
  const io: BasicIo = { driver, frames, settleMs: 0 };
  return { provider: createBasicProvider(io), driver, frames };
}

describe('BasicProvider descriptor', () => {
  it('advertises the screen family only', () => {
    const { provider } = setup();
    const descriptor = provider.descriptor();
    expect(descriptor.id).toBe('basic');
    expect(descriptor.families).toEqual(['screen']);
    // nut.js can hold the button, unlike the Cua driver.
    expect(descriptor.actions).toContain('left_mouse_down');
  });

  it('refuses an action outside the descriptor with UNSUPPORTED_ACTION', async () => {
    const { provider, driver } = setup();
    const outcome = await provider.act({ name: 'click_element', input: { ref: 'e1' } });
    expect(outcome.error?.code).toBe('UNSUPPORTED_ACTION');
    expect(outcome.error?.hint).toBeTruthy();
    expect(driver.calls).toEqual([]);
  });
});

describe('BasicProvider actions', () => {
  it('left_click moves then clicks, and observes the result', async () => {
    const { provider, driver, frames } = setup();
    const outcome = await provider.act({ name: 'left_click', input: { coordinate: [100, 200], ...FRAME } });
    expect(driver.calls).toEqual(['moveMouse(135,280)', 'click("left",1)']);
    expect(outcome.observation).toEqual(SHOT);
    expect(frames.shots).toBe(1);
  });

  it('maps double and triple clicks to click counts, and clicks in place without a coordinate', async () => {
    const { provider, driver } = setup();
    await provider.act({ name: 'double_click', input: { coordinate: [10, 10], ...FRAME } });
    await provider.act({ name: 'triple_click', input: {} });
    expect(driver.calls).toContain('click("left",2)');
    expect(driver.calls).toContain('click("left",3)');
    expect(driver.calls.filter((call) => call.startsWith('moveMouse')).length).toBe(1);
  });

  it('observes without acting for screenshot and zoom', async () => {
    const { provider, driver } = setup();
    expect((await provider.act({ name: 'screenshot', input: {} })).observation).toEqual(SHOT);
    const zoomed = await provider.act({ name: 'zoom', input: { region: [0, 0, 100, 100], ...FRAME } });
    expect(zoomed.observation).toMatchObject({ kind: 'screen', base64: 'zoom-jpeg' });
    expect(driver.calls).toEqual([]);
  });

  it('maps scroll direction to signed driver units and honours the coordinate', async () => {
    const { provider, driver } = setup();
    await provider.act({
      name: 'scroll',
      input: { coordinate: [100, 100], ...FRAME, scroll_direction: 'down', scroll_amount: 3 },
    });
    await provider.act({ name: 'scroll', input: { scroll_direction: 'up', scroll_amount: 2 } });
    expect(driver.calls).toEqual(['moveMouse(135,140)', 'scroll(0,300)', 'scroll(0,-200)']);
  });

  it('types text and presses translated key combos, repeated', async () => {
    const { provider, driver } = setup();
    await provider.act({ name: 'type', input: { text: 'hello' } });
    await provider.act({ name: 'key', input: { text: 'ctrl+Return', repeat: 2 } });
    expect(driver.calls).toEqual(['typeText("hello")', 'pressKeys("ctrl+enter")', 'pressKeys("ctrl+enter")']);
  });

  it('reports the cursor position in screenshot pixels', async () => {
    const { provider } = setup();
    const outcome = await provider.act({ name: 'cursor_position', input: {} });
    expect(outcome.text).toBe('X=640, Y=399'); // 864/1.35, 558/1.4 rounded
    expect(outcome.observation).toBeUndefined();
  });

  it('drags between two mapped points', async () => {
    const { provider, driver } = setup();
    await provider.act({
      name: 'left_click_drag',
      input: { start_coordinate: [10, 10], coordinate: [20, 20], ...FRAME },
    });
    expect(driver.calls).toEqual(['drag({"x":13.5,"y":14},{"x":27,"y":28})']);
  });

  it('rejects modifier-held clicks as unsupported', async () => {
    const { provider, driver } = setup();
    const click = await provider.act({
      name: 'left_click',
      input: { coordinate: [1, 1], ...FRAME, modifiers: ['shift'] },
    });
    expect(click.error?.code).toBe('UNSUPPORTED_ACTION');
    expect(driver.calls).toEqual([]);
  });

  it('refuses a field that belongs to another action instead of dropping it', async () => {
    // One flat schema serves every action, so nothing stops a ref being sent
    // to a click. Acting anyway would click somewhere the model never named.
    const { provider, driver } = setup();
    const outcome = await provider.act({
      name: 'left_click',
      input: { coordinate: [1, 1], ...FRAME, ref: 'e2', observation_id: 's1' },
    });
    expect(outcome.error?.code).toBe('INVALID_REQUEST');
    expect(outcome.error?.detail).toContain('click_element');
    expect(driver.calls).toEqual([]);
  });

  it('returns INVALID_REQUEST for malformed arguments instead of throwing', async () => {
    const { provider } = setup();
    const cases = [
      { name: 'mouse_move', input: {} },
      { name: 'zoom', input: { region: [1, 2, 3], ...FRAME } },
      { name: 'zoom', input: { region: [100, 100, 50, 200], ...FRAME } },
      { name: 'type', input: {} },
      { name: 'key', input: { text: 'cmd' } },
      { name: 'scroll', input: { scroll_direction: 'sideways' } },
    ];
    for (const action of cases) {
      expect((await provider.act(action)).error?.code, action.name).toBe('INVALID_REQUEST');
    }
  });

  it('surfaces a thrown driver failure as DRIVER_UNAVAILABLE', async () => {
    const driver = fakeDriver();
    driver.click = async () => {
      throw new Error('nut.js exploded');
    };
    const provider = createBasicProvider({ driver, frames: fakeFrames(), settleMs: 0 });
    const outcome = await provider.act({ name: 'left_click', input: {} });
    expect(outcome.error?.code).toBe('DRIVER_UNAVAILABLE');
    expect(outcome.error?.detail).toContain('nut.js exploded');
  });
});
