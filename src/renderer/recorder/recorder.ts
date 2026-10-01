// The recorder: captures microphone audio while the user holds the hotkey,
// reports a live level for the UI, streams the audio to main as it arrives
// (for streaming speech-to-text), and ships the finished bytes at the end
// (for the batch fallback).

import { SPEECH_WPM, type RecordingResult, type SettingsView } from '../../shared/types';
import { concatPcm, toPcm16 } from './audio';
import type { BuddyApi } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';
import './sfx'; // UI sound effects (side-effect module)
import './vad'; // always-on voice activity detection (side-effect module)

// Injected by src/preload/index.ts.
const buddy = (window as unknown as { buddy: BuddyApi }).buddy;

const LEVEL_INTERVAL_MS = 33; // ~30 updates/second

/** What speech-to-text wants, and what the audio graph is resampled to. */
const SAMPLE_RATE = 16_000;
/** 128ms per chunk: small enough that letting go doesn't strand much audio. */
const CHUNK_SAMPLES = 2048;

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
/** The recording's own copy of the streamed PCM, for the local ear. */
let pcmChunks: Uint8Array[] = [];
let audioContext: AudioContext | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let discardRequested = false;
let startedAt = 0;

buddy.onRecorderStart(() => void startRecording());
buddy.onRecorderStop((discard) => stopRecording(discard));

async function startRecording(): Promise<void> {
  if (mediaRecorder) return; // already recording
  try {
    // Acquire the mic per recording so the OS mic indicator matches reality.
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    buddy.sendRecorderError(errorMessage(error));
    return;
  }

  listenToMic(stream);

  const chunks: Blob[] = [];
  pcmChunks = [];
  discardRequested = false;
  startedAt = Date.now();
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
  mediaRecorder.onstop = () => void finishRecording(chunks);
  mediaRecorder.start();
}

function stopRecording(discard: boolean): void {
  if (!mediaRecorder) return;
  discardRequested = discard;
  mediaRecorder.stop();
}

async function finishRecording(chunks: Blob[]): Promise<void> {
  const durationMs = Date.now() - startedAt;
  stopListening();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  mediaRecorder = null;

  if (discardRequested) return;

  const blob = new Blob(chunks, { type: 'audio/webm' });
  const result: RecordingResult = {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: 'audio/webm',
    durationMs,
    pcm16: concatPcm(pcmChunks),
  };
  pcmChunks = [];
  buddy.sendRecorderResult(result);
}

// --- Level meter and live audio ---------------------------------------------
// One graph, resampled to what speech-to-text wants, feeding two consumers:
// the meter the UI draws, and the chunks main streams to the transcriber.

function listenToMic(micStream: MediaStream): void {
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(micStream);

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  levelTimer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    // RMS of the waveform, scaled so normal speech lands around 0.5..1.
    let sumSquares = 0;
    for (const sample of samples) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    buddy.sendMicLevel(Math.min(1, rms * 4));
  }, LEVEL_INTERVAL_MS);

  // ScriptProcessor rather than an AudioWorklet: a worklet needs its own
  // module file and message plumbing to do exactly this much.
  const tap = audioContext.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
  tap.onaudioprocess = (event) => {
    pcmChunks.push(toPcm16(event.inputBuffer.getChannelData(0)));
  };
  source.connect(tap);
  // A ScriptProcessor only runs while it reaches the destination; a zero-gain
  // node keeps the graph pulling without playing the microphone back.
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  tap.connect(mute).connect(audioContext.destination);
}

function stopListening(): void {
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  void audioContext?.close();
  audioContext = null;
  buddy.sendMicLevel(0);
}

// --- TTS playback -------------------------------------------------------
// Main sends one clip at a time and waits for our "ended" before the next,
// so ordering is guaranteed on that side.

let ttsAudio: HTMLAudioElement | null = null;

// The speaking-pace setting, applied as a pitch-preserving playback rate so
// one knob works identically for every TTS provider. Also applied to the
// clip already playing, so a settings change is heard at once.
let ttsRate = 1;
const applyPace = ({ settings }: SettingsView): void => {
  ttsRate = settings.speechWpm / SPEECH_WPM.natural;
  if (ttsAudio) ttsAudio.playbackRate = ttsRate;
};
void buddy.getSettings().then(applyPace);
buddy.onSettingsChanged(applyPace);

buddy.onTtsPlay((bytes, mime) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  ttsAudio = new Audio(url);
  ttsAudio.playbackRate = ttsRate;
  const done = (): void => {
    URL.revokeObjectURL(url);
    ttsAudio = null;
    buddy.sendTtsEnded();
  };
  ttsAudio.onended = done;
  ttsAudio.onerror = done;
  void ttsAudio.play().catch(done); // report failures too, or the queue stalls
});

buddy.onTtsStop(() => {
  if (!ttsAudio) return;
  ttsAudio.onended = null;
  ttsAudio.onerror = null;
  ttsAudio.pause();
  ttsAudio.src = '';
  ttsAudio = null;
});
