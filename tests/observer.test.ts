// Guide mode's window reader. It exists so that "circle this tab" lands on
// the tab, and it must never grow the ability to act.

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }],
    getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }),
  },
  // windows.ts registers a theme listener at module scope.
  nativeTheme: { on: () => {} },
}));

const started: string[] = [];
const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];

vi.mock('../src/main/computer/driver', () => ({
  openSession: async (label: string) => {
    started.push(label);
    return {
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        return { text: 'ok', isError: false, ...stub(tool, args) };
      },
      end: async () => undefined,
    };
  },
}));

function stub(tool: string, args: Record<string, unknown>): { structuredJson?: string } {
  if (tool === 'list_windows') {
    return {
      structuredJson: JSON.stringify({
        windows: [
          {
            window_id: 7,
            pid: 99,
            app_name: 'Cursor',
            title: 'prompt.ts — buddy',
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            is_on_screen: true,
            z_index: 3,
          },
        ],
      }),
    };
  }
  if (tool === 'list_apps') {
    return { structuredJson: JSON.stringify({ apps: [{ pid: 99, name: 'Cursor', running: true, active: true }] }) };
  }
  if (tool === 'get_window_state') {
    return {
      structuredJson: JSON.stringify({
        pid: args['pid'],
        window_id: args['window_id'],
        snapshot_id: 's0000001a',
        app_name: 'Cursor',
        window_title: 'prompt.ts — buddy',
        total_element_count: 2,
        elements: [
          { element_index: 0, role: 'AXWindow', depth: 0, label: 'buddy', frame: { x: 0, y: 0, w: 1440, h: 900 } },
          {
            element_index: 1,
            role: 'AXRadioButton',
            depth: 1,
            label: 'prompt.ts',
            element_token: 's0000001a:1',
            actions: ['AXPress'],
            frame: { x: 220, y: 33, w: 96, h: 28 },
          },
        ],
      }),
    };
  }
  return {};
}

const { guideElementBox, observeForGuide } = await import('../src/main/computer/observer');

describe('reading a window in guide mode', () => {
  it('gives every element a ref, with the box it really occupies', async () => {
    const outcome = await observeForGuide('get_window_state', {}, 1);
    const observation = outcome.observation;
    if (observation?.kind !== 'window') throw new Error('expected a window observation');
    expect(observation.tree).toContain('prompt.ts');

    // e2 is the tab: 96 by 28, which is far smaller than anything that could
    // be estimated off a downscaled screenshot.
    expect(guideElementBox(observation.observationId, 'e2')).toEqual({
      displayId: 1,
      rect: { x: 220, y: 33, width: 96, height: 28 },
    });
  });

  it('opens its own read-only session, not the agent\'s', async () => {
    await observeForGuide('list_windows', {}, 1);
    expect(started).toEqual(['guide']);
  });

  it('reuses that session instead of starting one per question', async () => {
    await observeForGuide('list_windows', {}, 1);
    await observeForGuide('list_windows', {}, 1);
    expect(started).toHaveLength(1);
  });

  it('refuses anything that would touch the computer', async () => {
    for (const action of ['click_element', 'set_value', 'type_into', 'bring_to_front', 'invoke_menu']) {
      await expect(observeForGuide(action, {}, 1)).rejects.toThrow('cannot act');
    }
    // And none of them reached the driver.
    expect(calls.every((call) => call.tool !== 'click' && call.tool !== 'set_value')).toBe(true);
  });

  it('has no box for a ref it never issued', () => {
    expect(guideElementBox('made-up', 'e1')).toBeNull();
    expect(guideElementBox(undefined, undefined)).toBeNull();
  });
});
