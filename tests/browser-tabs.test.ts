// browser_tabs open pacing: one per turn, one per model step, or unlimited,
// following the Showing finds choice. The rundown cap is what stops the model
// from batching every pick's open into a single reply, which would put three
// tabs on screen with nothing said between them.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beginToolBatch } from '../src/main/ai/batch';
import type { ToolRegistry } from '../src/main/ai/tools';

const mocks = vi.hoisted(() => ({
  productBrowse: 'rundown' as 'one' | 'rundown' | 'all',
  opened: [] as string[],
}));

vi.mock('../src/main/settings', () => ({
  getSettings: () => ({ productBrowse: mocks.productBrowse }),
}));
vi.mock('../src/main/apple/jxa', () => ({
  runJxa: async () => 'Safari',
  jxaErrorMessage: (error: unknown) => String(error),
}));
vi.mock('../src/main/speech/tts', () => ({ waitForSpeechQueue: async () => undefined }));
vi.mock('../src/main/payment/merchant', () => ({ noteMerchantUrl: () => undefined }));
vi.mock('child_process', () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: null, out: object) => void) => {
    mocks.opened.push(args[args.length - 1]!);
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { addBrowserTabsTool } from '../src/main/apple/browser-tabs';

const open = (registry: ToolRegistry, url: string) =>
  registry.get('browser_tabs')!.execute({ action: 'open', url }, new AbortController().signal);

function registry(mode: typeof mocks.productBrowse): ToolRegistry {
  mocks.productBrowse = mode;
  const map: ToolRegistry = new Map();
  addBrowserTabsTool(map);
  return map;
}

beforeEach(() => {
  mocks.opened = [];
  vi.stubGlobal('fetch', async () => ({ status: 200, body: null }));
});

describe('browser_tabs open pacing', () => {
  it('rundown: one open per model step, the next only after a new step', async () => {
    const tools = registry('rundown');
    beginToolBatch();
    expect((await open(tools, 'https://a.example/1')).isError).toBeUndefined();
    const second = await open(tools, 'https://a.example/2');
    expect(second.isError).toBe(true);
    expect(second.content).toMatch(/one page per step/);
    beginToolBatch();
    expect((await open(tools, 'https://a.example/2')).isError).toBeUndefined();
    expect(mocks.opened).toEqual(['https://a.example/1', 'https://a.example/2']);
  });

  it('one at a time: a second open is refused for the rest of the turn', async () => {
    const tools = registry('one');
    beginToolBatch();
    await open(tools, 'https://a.example/1');
    beginToolBatch();
    const second = await open(tools, 'https://a.example/2');
    expect(second.isError).toBe(true);
    expect(second.content).toMatch(/one per turn/);
    expect(mocks.opened).toEqual(['https://a.example/1']);
  });

  it('all at once: every open in the same step goes through', async () => {
    const tools = registry('all');
    beginToolBatch();
    await open(tools, 'https://a.example/1');
    await open(tools, 'https://a.example/2');
    expect(mocks.opened).toHaveLength(2);
  });

  it('a page that is gone is never opened, whatever the mode', async () => {
    vi.stubGlobal('fetch', async () => ({ status: 404, body: null }));
    const tools = registry('all');
    beginToolBatch();
    const gone = await open(tools, 'https://a.example/dead');
    expect(gone.isError).toBe(true);
    expect(gone.content).toMatch(/no longer exists/);
    expect(mocks.opened).toEqual([]);
  });
});
