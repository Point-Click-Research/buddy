// The local ear: Whisper running inside Buddy via transformers.js (ONNX on
// the CPU). No server and no terminal — the model is a one-click ~90 MB
// download into userData, and after that transcription works offline.
//
// The library is ESM and pulls in the ONNX runtime, so it is loaded lazily
// with a dynamic import the first time the ear is downloaded or used.

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { type KeyTestResult } from '../../shared/types';
import { createLogger } from '../log';
import { broadcast } from '../windows';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('whisper');

/** Multilingual base: the accuracy/size sweet spot for a fallback ear. */
const MODEL = 'Xenova/whisper-base';
/** The recorder captures at this rate, which is also what Whisper expects. */
const SAMPLE_RATE = 16_000;

const cacheDir = (): string => join(app.getPath('userData'), 'whisper');
/** Written after a successful load; deleting the folder resets the ear. */
const markerPath = (): string => join(cacheDir(), 'ready');

/** Is the model downloaded? Cheap enough to call from IPC on every ask. */
export function isLocalWhisperReady(): boolean {
  return existsSync(markerPath());
}

let loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/** Load (downloading if needed) once; concurrent callers share the promise. */
function getAsr(report?: (percent: number) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  loading ??= load(report).catch((error: unknown) => {
    loading = null; // a failed download may be retried
    throw error;
  });
  return loading;
}

async function load(report?: (percent: number) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir();
  // The model is several files; progress is bytes done over bytes expected
  // across every file seen so far.
  const files = new Map<string, { loaded: number; total: number }>();
  const onProgress = (info: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (info.status !== 'progress' || !info.file || !info.total) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    report?.(Math.floor((loaded / total) * 100));
  };
  return pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    ...(report ? { progress_callback: onProgress } : {}),
  });
}

/** Download the model (a no-op when cached), broadcasting whole percents. */
export async function downloadLocalWhisper(): Promise<KeyTestResult> {
  try {
    let last = -1;
    await getAsr((percent) => {
      if (percent === last) return;
      last = percent;
      broadcast(IpcChannels.sttLocalProgress, percent);
    });
    mkdirSync(cacheDir(), { recursive: true });
    writeFileSync(markerPath(), MODEL);
    log.info(`${MODEL} is ready`);
    return { ok: true, message: 'The local ear is ready.' };
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`download failed: ${detail}`);
    return { ok: false, message: `Download failed: ${detail}` };
  }
}

/** PCM16 mono 16 kHz in, transcript out. Every failure names its fix. */
export async function transcribeLocal(pcm16: Uint8Array): Promise<string> {
  if (!isLocalWhisperReady()) {
    throw new Error('The local ear is not downloaded. Get it in Settings → Ears.');
  }
  try {
    const pipe = await getAsr();
    const output = await pipe(pcm16ToFloat32(pcm16), { chunk_length_s: 30 });
    const text = (Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text).trim();
    log.info(`transcribed ${(pcm16.length / 2 / SAMPLE_RATE).toFixed(1)}s locally`);
    return text;
  } catch (error) {
    // Downloaded but broken (a half-written cache, a failed model load):
    // surface something actionable, not an ONNX stack trace.
    const detail = errorMessage(error);
    log.warn(`local transcription failed: ${detail}`);
    throw new Error(
      `The local ear failed (${detail.slice(0, 120)}). Deleting the whisper folder in Buddy's data and re-downloading it in Settings → Ears may fix it.`,
    );
  }
}

function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const out = new Float32Array(Math.floor(pcm.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}
