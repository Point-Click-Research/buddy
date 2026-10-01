// The brain router: OpenRouter first, the local model as the honest
// fallback. These pin the safety rule (never fall back once content has
// streamed), the demotion rule (only a dead key retires the cloud for the
// run), and the unknown-model and effort retries.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelStreamHandlers } from '../src/main/ai/loop';

const mocks = vi.hoisted(() => ({
  streamOpenRouter: vi.fn(),
  streamOllama: vi.fn(),
  broadcast: vi.fn(),
  getApiKey: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  managedModels: vi.fn<() => string[] | null>(() => null),
}));

vi.mock('../src/main/account/api', () => ({ managedModels: mocks.managedModels }));
vi.mock('../src/main/account/credentials', () => ({
  // A pasted key, or Buddy's keys (a plan with a model list) can serve the cloud.
  providerReady: () => Boolean(mocks.getApiKey()) || mocks.managedModels() !== null,
  signInRequired: () => false,
  SIGN_IN_MESSAGE: 'sign in',
}));
vi.mock('../src/main/settings', () => ({
  getApiKey: mocks.getApiKey,
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  getKeyStatus: () => ({}),
}));
vi.mock('../src/main/windows', () => ({ broadcast: mocks.broadcast }));
vi.mock('../src/main/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));
vi.mock('../src/main/ai/openrouter', () => ({ streamOpenRouter: mocks.streamOpenRouter }));
vi.mock('../src/main/ai/ollama', () => ({ streamOllama: mocks.streamOllama }));

import { reviveBrain, streamBrain } from '../src/main/ai/brain';

const handlers: ModelStreamHandlers = { onTextDelta: vi.fn(), onToolUse: vi.fn() };
const call = (): ReturnType<typeof streamBrain> =>
  streamBrain([], 'sys', [], handlers, new AbortController().signal);

/** The positional arguments streamOpenRouter takes after the handlers and signal. */
const sent = (model: string, effort: string | undefined) => [
  expect.anything(),
  'sys',
  [],
  expect.anything(),
  expect.anything(),
  model,
  expect.any(Number),
  effort,
];

beforeEach(() => {
  vi.clearAllMocks();
  reviveBrain();
  mocks.managedModels.mockReturnValue(null);
  mocks.getApiKey.mockReturnValue('sk-test');
  mocks.getSettings.mockReturnValue({
    brainProvider: 'openrouter',
    brainModel: 'anthropic/claude-sonnet-5',
    ollamaModel: 'qwen3-vl:8b',
    airplaneMode: false,
    keyWarnings: {},
  });
  mocks.streamOpenRouter.mockResolvedValue([{ type: 'text', text: 'cloud answer' }]);
  mocks.streamOllama.mockResolvedValue([{ type: 'text', text: 'local answer' }]);
});

describe('streamBrain', () => {
  it('answers through OpenRouter when the key works', async () => {
    await expect(call()).resolves.toEqual([{ type: 'text', text: 'cloud answer' }]);
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('anthropic/claude-sonnet-5', undefined));
    expect(mocks.streamOllama).not.toHaveBeenCalled();
  });

  it('retries with the fallback model when the wanted one is unknown', async () => {
    mocks.streamOpenRouter.mockRejectedValueOnce(
      Object.assign(new Error('404 model: anthropic/claude-typo not found'), { status: 404 }),
    );
    await expect(
      streamBrain([], 'sys', [], handlers, new AbortController().signal, {
        model: 'anthropic/claude-typo',
        fallbackModel: 'anthropic/claude-sonnet-5',
      }),
    ).resolves.toEqual([{ type: 'text', text: 'cloud answer' }]);
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('anthropic/claude-sonnet-5', undefined));
  });

  it('falls back to the local model with a spoken reason when the cloud fails cold', async () => {
    mocks.streamOpenRouter.mockRejectedValue(new Error('fetch failed'));
    await expect(call()).resolves.toEqual([{ type: 'text', text: 'local answer' }]);
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/no internet.*local model/is),
    );
  });

  it('never falls back once text has already streamed', async () => {
    mocks.streamOpenRouter.mockImplementation((_m, _s, _t, h: ModelStreamHandlers) => {
      h.onTextDelta('Half an ans');
      return Promise.reject(new Error('fetch failed'));
    });
    await expect(call()).rejects.toThrow('fetch failed');
    expect(mocks.streamOllama).not.toHaveBeenCalled();
  });

  it('retires the cloud for the run only on a dead key, and remembers it on Providers', async () => {
    mocks.streamOpenRouter.mockRejectedValue(new Error('401 authentication_error'));
    await call();
    mocks.streamOpenRouter.mockClear();
    await call();
    expect(mocks.streamOpenRouter).not.toHaveBeenCalled(); // demoted: straight to local
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      keyWarnings: { openrouter: expect.stringMatching(/refused/) },
    });

    reviveBrain();
    mocks.updateSettings.mockClear();
    mocks.streamOpenRouter.mockRejectedValue(new Error('fetch failed'));
    await call();
    expect(mocks.updateSettings).not.toHaveBeenCalled(); // transient: nothing to warn about
    mocks.streamOpenRouter.mockClear();
    mocks.streamOpenRouter.mockResolvedValue([{ type: 'text', text: 'cloud answer' }]);
    await expect(call()).resolves.toEqual([{ type: 'text', text: 'cloud answer' }]); // network blip: retried
  });

  it('reads an out-of-credits 429 as a dead key, not a rate limit', async () => {
    mocks.getSettings.mockReturnValue({
      brainProvider: 'openrouter',
      brainModel: 'openai/gpt-5',
      ollamaModel: '',
      airplaneMode: false,
      keyWarnings: {},
    });
    mocks.streamOpenRouter.mockRejectedValue(new Error('429 You have no credits remaining. Add credits to continue.'));
    await expect(call()).rejects.toThrow('no credits');
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      keyWarnings: { openrouter: expect.stringMatching(/Out of credits/) },
    });
  });

  it('forwards a resolved effort, and retries without it when the model refuses the parameter', async () => {
    await streamBrain([], 'sys', [], handlers, new AbortController().signal, { effort: 'low' });
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('anthropic/claude-sonnet-5', 'low'));

    mocks.streamOpenRouter
      .mockRejectedValueOnce(Object.assign(new Error('reasoning is not supported for this model'), { status: 400 }))
      .mockResolvedValueOnce([{ type: 'text', text: 'cloud answer' }]);
    mocks.streamOpenRouter.mockClear();
    await expect(
      streamBrain([], 'sys', [], handlers, new AbortController().signal, { effort: 'low' }),
    ).resolves.toEqual([{ type: 'text', text: 'cloud answer' }]);
    expect(mocks.streamOpenRouter).toHaveBeenCalledTimes(2);
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('anthropic/claude-sonnet-5', undefined));

    // Remembered: the next call goes out once, without the field.
    mocks.streamOpenRouter.mockClear();
    await streamBrain([], 'sys', [], handlers, new AbortController().signal, { effort: 'low' });
    expect(mocks.streamOpenRouter).toHaveBeenCalledTimes(1);
    expect(mocks.streamOpenRouter.mock.calls[0]![7]).toBeUndefined();
  });

  // A Think hard model set to one of OpenRouter's "latest" aliases ran every
  // turn on Haiku: the alias's leading tilde matched no plan prefix, and the
  // plan gate swapped it for the fallback without the user's model ever being asked.
  it("keeps a tilde alias the plan's vendor list covers, on Buddy's keys", async () => {
    mocks.getApiKey.mockReturnValue(null);
    mocks.managedModels.mockReturnValue(['anthropic/', 'openai/']);
    await streamBrain([], 'sys', [], handlers, new AbortController().signal, { model: '~openai/gpt-sol-latest' });
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('~openai/gpt-sol-latest', undefined));

    mocks.managedModels.mockReturnValue(['anthropic/claude-haiku']);
    await streamBrain([], 'sys', [], handlers, new AbortController().signal, { model: '~openai/gpt-sol-latest' });
    expect(mocks.streamOpenRouter).toHaveBeenLastCalledWith(...sent('anthropic/claude-haiku-4.5', undefined));
  });

  it('uses the local model by choice when Ollama is the picked provider, key or not', async () => {
    mocks.getSettings.mockReturnValue({
      brainProvider: 'ollama',
      brainModel: '',
      ollamaModel: 'qwen3-vl:8b',
      airplaneMode: false,
    });
    await expect(call()).resolves.toEqual([{ type: 'text', text: 'local answer' }]);
    expect(mocks.streamOpenRouter).not.toHaveBeenCalled();
  });

  it('skips the cloud entirely in airplane mode', async () => {
    mocks.getSettings.mockReturnValue({
      brainProvider: 'openrouter',
      brainModel: 'anthropic/claude-sonnet-5',
      ollamaModel: 'qwen3-vl:8b',
      airplaneMode: true,
    });
    await expect(call()).resolves.toEqual([{ type: 'text', text: 'local answer' }]);
    expect(mocks.streamOpenRouter).not.toHaveBeenCalled();
  });

  it('explains itself when no brain is available at all', async () => {
    mocks.getApiKey.mockReturnValue(null);
    mocks.getSettings.mockReturnValue({
      brainProvider: 'openrouter',
      brainModel: 'anthropic/claude-sonnet-5',
      ollamaModel: '',
      airplaneMode: false,
    });
    await expect(call()).rejects.toThrow(/OpenRouter API key missing/);
    mocks.getSettings.mockReturnValue({
      brainProvider: 'openrouter',
      brainModel: 'anthropic/claude-sonnet-5',
      ollamaModel: '',
      airplaneMode: true,
    });
    await expect(call()).rejects.toThrow(/Airplane mode is on/);
    mocks.getSettings.mockReturnValue({
      brainProvider: 'ollama',
      brainModel: '',
      ollamaModel: '',
      airplaneMode: false,
    });
    await expect(call()).rejects.toThrow(/local brain is selected/);
  });
});
