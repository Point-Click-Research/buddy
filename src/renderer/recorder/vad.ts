// Always-on listening: runs the Silero VAD model (via @ricky0123/vad-web)
// on the microphone and ships each finished utterance to main as WAV.
// All model/wasm assets load from local files (see scripts/copy-vad-assets.mjs).

import { MicVAD } from '@ricky0123/vad-web';
import type { AppState } from '../../shared/types';
import { toPcm16, wavFromPcm16 } from './audio';
import type { BuddyApi } from '../../shared/ipc';

const SAMPLE_RATE = 16_000; // vad-web always emits 16kHz mono

// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

let vad: MicVAD | null = null;
let alwaysOn = false;
let state: AppState = 'idle';
let confirmPending = false;

buddy.onVadStart(() => {
  alwaysOn = true;
  void syncVad();
});

buddy.onVadStop(() => {
  alwaysOn = false;
  void syncVad();
});

buddy.onStateChanged((next) => {
  state = next;
  void syncVad();
});

// While a tool confirmation card is up, listen for the spoken yes/no even
// though Buddy is technically busy (state = thinking).
buddy.onMcpConfirm((card) => {
  confirmPending = card !== null;
  void syncVad();
});

/**
 * VAD runs only while always-on is active AND Buddy is idle/listening (or
 * waiting on a confirmation). Pausing during transcribing/thinking/speaking
 * stops Buddy from hearing its own text-to-speech through the speakers.
 */
async function syncVad(): Promise<void> {
  const shouldListen = alwaysOn && (state === 'idle' || state === 'listening' || confirmPending);
  if (shouldListen) {
    vad ??= await createVad();
    vad.start();
  } else if (alwaysOn) {
    vad?.pause();
  } else if (vad) {
    // Fully off: release the mic so the OS indicator goes away.
    vad.destroy();
    vad = null;
  }
}

function createVad(): Promise<MicVAD> {
  return MicVAD.new({
    model: 'v5',
    // Local assets, relative to this page (out/renderer/recorder/).
    baseAssetPath: '../vad/',
    onnxWASMBasePath: '../vad/',
    onSpeechStart: () => buddy.sendVadSpeechStart(),
    onVADMisfire: () => buddy.sendVadMisfire(),
    onSpeechEnd: (audio: Float32Array) => {
      const pcm16 = toPcm16(audio);
      buddy.sendVadResult({
        bytes: wavFromPcm16(pcm16, SAMPLE_RATE),
        mimeType: 'audio/wav',
        durationMs: Math.round((audio.length / SAMPLE_RATE) * 1000),
        pcm16,
      });
    },
  });
}
