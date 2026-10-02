// The text-to-speech pipeline. Feed it streaming text; it queues complete
// sentences, synthesizes up to 2 clips ahead, and plays them strictly in
// order through the hidden recorder window.

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { keyWarningKind, keyWarningText } from '../../shared/key-warning';
import { type Settings, type TtsProvider } from '../../shared/types';
import { credentials, managedCredentials, providerReady } from '../account/credentials';
import { isNetworkError } from '../ai/api-errors';
import { createLogger } from '../log';
import { getApiKey, getSettings, updateSettings } from '../settings';
import { broadcastSettings } from '../settings-view';
import { broadcast, sendToRecorder } from '../windows';
import { markersIn, stripMarkers } from './markers';
import { applyPronunciations } from './pronounce';
import { extractSentences, toSpokenText } from './sentences';
import { IpcChannels } from '../../shared/ipc';
import { errorMessage } from '../../shared/errors';

const log = createLogger('tts');

const MAX_SYNTH_AHEAD = 2;
/** A clip that never comes back must not leave the dot in `speaking`. */
const CLIP_TIMEOUT_MS = 20_000;

interface Job {
  text: string;
  /** What the caption shows when this sentence starts: as written, markers stripped. */
  caption: string;
  status: 'pending' | 'working' | 'ready' | 'done';
  audio?: Uint8Array;
  /** Container of `audio`, set with it — the recorder plays more than MP3. */
  mime?: string;
  /** Drawings waiting for this sentence: revealed the moment it starts. */
  reveals: string[];
}

/**
 * Told whenever the sentence that starts playing carries reveal markers.
 * Speech is where "the reply reached [[roof]]" becomes a moment in time, but
 * what a reveal means belongs to whoever is listening — the drawing layer.
 */
let onMarkers: (names: string[]) => void = () => undefined;

export function setMarkerListener(listener: (names: string[]) => void): void {
  onMarkers = listener;
}

let jobs: Job[] = [];
let buffer = '';
let inputDone = false;
let nextPlay = 0; // index of the job that must play next (strict order)
let playing = false; // a clip is currently at the recorder
let signal: AbortSignal | null = null;
let onDrained: (() => void) | null = null;
/**
 * Told when a sentence's turn comes, with its written form. This is how the
 * caption keeps pace with the voice instead of racing ahead of it: whoever
 * armed the pipeline shows the words at the moment they are spoken.
 */
let onSentence: ((caption: string) => void) | null = null;
/** A one-shot waiter from drainSpeech, settled however the queue empties. */
let waiting: (() => void) | null = null;
/** Waiters from waitForSpeechQueue: each settles when its target sentence has played. */
let queueWaiters: Array<{ target: number; settle: () => void }> = [];
let active = false;
let speaker: Speaker = 'system';

/** Is a response's speech pipeline armed right now? */
export function isSpeechActive(): boolean {
  return active;
}

/**
 * Arm the pipeline for one response. Returns false (with a user-facing
 * error where relevant) when speech is disabled or misconfigured — the
 * response then stays text-only.
 */
export function startSpeech(
  sessionSignal: AbortSignal,
  drained: () => void,
  sentenceSpoken?: (caption: string) => void,
): boolean {
  const settings = getSettings();
  if (!settings.speechEnabled) return false;
  const chosen = pickSpeaker(settings);
  if (!chosen) {
    // A voice that died mid-run (quota, refused key) reads as "broken"
    // without a reason; say which it is instead of the generic setup hint.
    broadcast(
      IpcChannels.sessionError,
      demoted.size > 0
        ? `The ${[...demoted].map((provider) => LABELS[provider]).join(' and ')} voice stopped working (out of credits or a refused key) — replies are text-only until it's fixed in Settings → Providers.`
        : 'Speech needs a key and voice for the chosen provider — open Settings (or switch off "Speak responses out loud" under Voice).',
    );
    return false;
  }
  speaker = chosen;

  jobs = [];
  buffer = '';
  inputDone = false;
  nextPlay = 0;
  playing = false;
  signal = sessionSignal;
  onDrained = drained;
  onSentence = sentenceSpoken ?? null;
  active = true;
  return true;
}

/** Add streaming text; complete sentences are queued for synthesis. */
export function pushText(delta: string): void {
  if (!active) return;
  buffer += delta;
  const { sentences, rest } = extractSentences(buffer);
  buffer = rest;
  for (const sentence of sentences) enqueue(sentence);
}

/**
 * Speak everything pushed so far without ending the pipeline. The splitter
 * holds a buffer's trailing sentence in case more text arrives (a final
 * "2." could still grow into "2.5") — right for mid-stream, wrong once the
 * response is done talking and about to park on the user: unflushed, the
 * step's instruction would only be heard when the NEXT response's text
 * releases it, one step late.
 */
export function flushSpeech(): void {
  if (!active) return;
  const tail = buffer;
  buffer = '';
  enqueue(tail);
}

/**
 * The response stream ended: flush the tail. Returns true if clips are
 * still queued or playing (i.e. the app should be in the speaking state).
 */
export function finishText(): boolean {
  if (!active) return false;
  enqueue(buffer);
  buffer = '';
  inputDone = true;
  pump();
  return active && (playing || jobs.some((j) => j.status !== 'done'));
}

/**
 * Flush the tail and resolve once Buddy has finished saying it — at once
 * when there's nothing left to say. Use this before taking the voice away
 * from one pipeline and giving it to another, so the handover doesn't cut
 * Buddy off mid-word. Cancelling settles it too, and `timeoutMs` caps the
 * wait so a wedged clip can't strand whatever is waiting on the voice.
 */
export function drainSpeech(timeoutMs: number): Promise<void> {
  if (!finishText()) return Promise.resolve();
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    const settle = (): void => {
      clearTimeout(timer);
      waiting = null;
      resolve();
    };
    timer = setTimeout(() => {
      log.warn('speech did not finish in time; carrying on');
      settle();
    }, timeoutMs);
    waiting = settle;
  });
}

/**
 * Resolves once everything queued so far has been spoken — without ending
 * the pipeline, so more text can still arrive after it. This is how an
 * action paces itself to the voice: a tab that should appear only after the
 * sentence introducing it has been heard. Immediate when speech is off or
 * already caught up; `timeoutMs` caps the wait so a wedged clip can't
 * strand the action.
 */
export function waitForSpeechQueue(timeoutMs: number): Promise<void> {
  if (!active) return Promise.resolve();
  // The text before a tool call is complete, so the sentence the splitter is
  // still holding (its final "." might have grown) is done too. Left in the
  // buffer it would not count toward the wait, and a rundown's next tab would
  // open while the last line about the previous product was still being said.
  flushSpeech();
  const target = jobs.length;
  if (nextPlay >= target) return Promise.resolve();
  return new Promise((resolve) => {
    const waiter = { target, settle: (): void => resolve() };
    const timer = setTimeout(() => {
      queueWaiters = queueWaiters.filter((entry) => entry !== waiter);
      log.warn('speech did not catch up in time; carrying on');
      resolve();
    }, timeoutMs);
    waiter.settle = () => {
      clearTimeout(timer);
      resolve();
    };
    queueWaiters.push(waiter);
  });
}

/** Stop playback and drop everything queued. */
export function cancelSpeech(): void {
  waiting?.(); // whoever was waiting on the voice is not getting it
  for (const waiter of queueWaiters) waiter.settle();
  queueWaiters = [];
  if (!active) return;
  active = false;
  jobs = [];
  buffer = '';
  sendToRecorder(IpcChannels.ttsStop);
}

/** The recorder finished (or failed) the current clip. */
export function onPlaybackEnded(): void {
  if (!active) return;
  playing = false;
  const job = jobs[nextPlay];
  if (job) job.status = 'done';
  nextPlay++;
  pump();
}

function enqueue(text: string): void {
  const reveals = markersIn(text);
  const caption = stripMarkers(text).trim();
  // Pronunciations shape only what is said: the caption keeps "70°F" while
  // the voice reads "70 degrees Fahrenheit".
  const spoken = applyPronunciations(toSpokenText(caption), getSettings().pronunciations);
  // A sentence that was only a marker still has its moment in the queue —
  // its reveal fires in order, it just says nothing.
  if (!spoken && reveals.length === 0 && !caption) return;
  jobs.push({ text: spoken, caption, status: spoken ? 'pending' : 'ready', reveals });
  pump();
}

/**
 * A job's turn has come, however it ends: its drawings appear and its words
 * reach the caption now — spoken, skipped or silent alike, so nothing the
 * model wrote is lost when a clip fails.
 */
function moment(job: Job): void {
  if (job.caption) {
    onSentence?.(job.caption);
    job.caption = '';
  }
  if (job.reveals.length === 0) return;
  onMarkers(job.reveals);
  job.reveals = [];
}

/** Drive synthesis and playback forward. Safe to call any time. */
function pump(): void {
  if (!active) return;

  // Skip clips whose synthesis failed, and silent jobs that only carried
  // markers. Either way their moment fires: a failed sentence must not
  // leave its drawing hidden or its words off the caption until the end.
  while (true) {
    const job = jobs[nextPlay];
    if (!job) break;
    if (job.status === 'done') {
      moment(job);
      nextPlay++;
    } else if (job.status === 'ready' && !job.audio) {
      moment(job);
      job.status = 'done';
      nextPlay++;
    } else {
      break;
    }
  }

  // Keep up to MAX_SYNTH_AHEAD syntheses in flight, in order.
  let inFlight = jobs.filter((j) => j.status === 'working').length;
  for (const job of jobs) {
    if (inFlight >= MAX_SYNTH_AHEAD) break;
    if (job.status !== 'pending') continue;
    job.status = 'working';
    inFlight++;
    void synthesize(job);
  }

  // Play strictly in order, one clip at a time. The sentence starting is
  // the moment its drawings appear and its words reach the caption.
  const next = jobs[nextPlay];
  if (!playing && next?.status === 'ready') {
    playing = true;
    moment(next);
    sendToRecorder(IpcChannels.ttsPlay, next.audio, next.mime ?? 'audio/mpeg');
  }

  // Anyone pacing themselves to the voice whose sentences have now played.
  const caughtUp = queueWaiters.filter((waiter) => nextPlay >= waiter.target);
  if (caughtUp.length > 0) {
    queueWaiters = queueWaiters.filter((waiter) => nextPlay < waiter.target);
    for (const waiter of caughtUp) waiter.settle();
  }

  // Drained: everything queued has played and no more text is coming.
  if (inputDone && !playing && nextPlay >= jobs.length) {
    active = false;
    onDrained?.();
    waiting?.();
  }
}

async function synthesize(job: Job): Promise<void> {
  // Capture who is speaking now: a parallel sentence's fatal failure can
  // switch the voice while this request is in flight. `mine` is this
  // pipeline: a newer line replaces `signal`, and this request must not
  // touch that one when it lands.
  const by = speaker;
  const mine = signal;
  try {
    const audio = await SPEAKERS[by].say(job.text, getSettings());
    if (!active || signal !== mine || job.status !== 'working') return;
    job.audio = audio;
    job.mime = SPEAKERS[by].mime;
    job.status = 'ready';
  } catch (error) {
    if (!active || signal !== mine || mine?.aborted || job.status !== 'working') return;
    const detail = errorMessage(error);
    // The system voice has no key to die; its failures are always one-offs.
    if (by !== 'system' && isFatalKeyFailure(detail)) {
      demote(job, by, detail);
    } else if (by !== 'system' && (isNetworkError(error) || timedOut(error)) && SPEAKERS.system.ready(getSettings())) {
      // Offline: the voice is unreachable, not broken. Finish this reply
      // with the built-in macOS voice; the next response retries the paid
      // one (startSpeech re-picks), so no demotion and nothing persisted.
      // Parallel sentences fail together — only the first switches and says so.
      if (speaker !== 'system') {
        log.warn(`${by} unreachable (${detail}); using the macOS voice for this reply`);
        broadcast(
          IpcChannels.sessionError,
          `The ${LABELS[by]} voice couldn't be reached. Using the built-in macOS voice for this reply.`,
        );
        speaker = 'system';
      }
      job.status = 'pending'; // re-say this sentence with the offline voice
    } else {
      // One bad sentence shouldn't silence the rest: skip it and move on.
      log.warn(`synthesis failed, skipping sentence: ${detail}`);
      job.status = 'done';
    }
  }
  if (signal !== mine) return;
  pump();
}

/**
 * A failure every sentence will repeat: out of credits, or a dead/refused
 * key (ElevenLabs reports exhausted quota as HTTP 401). Unlike a one-off
 * synthesis hiccup, retrying these only produces more silence.
 */
function isFatalKeyFailure(detail: string): boolean {
  return /quota|credit|billing|insufficient|payment|\b40[123]\b/i.test(detail);
}

/** AbortSignal.timeout, as opposed to the script ending the line on purpose. */
function timedOut(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || /timeout/i.test(error.message));
}

/** The script's signal, plus a deadline so a hung voice request cannot pin `speaking`. */
function clipSignal(): AbortSignal {
  const deadline = AbortSignal.timeout(CLIP_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * Providers whose key failed hard this run. In memory only, so a mid-response
 * retry doesn't keep hitting a dead key. The Settings switch is persisted
 * separately; a Test or a new key (or picking this voice again) calls
 * reviveSpeaker so the next turn can retry.
 */
const demoted = new Set<Speaker>();

const LABELS: Record<Speaker, string> = {
  elevenlabs: 'ElevenLabs',
  system: 'the built-in macOS voice',
};

/** ElevenLabs' own host; the user's key goes here, Buddy's through the API. */
export const ELEVENLABS_URL = 'https://api.elevenlabs.io';

/**
 * The voice's key is dead — every sentence would fail the same way, which
 * the user hears as "voice is broken" with no explanation. Switch the
 * saved provider to a working voice, pin a warning on the failed key, and
 * either finish this response with the fallback or let the captions carry
 * it silently.
 */
function demote(job: Job, by: ApiSpeaker, detail: string): void {
  const first = !demoted.has(by);
  if (first) {
    demoted.add(by);
    log.warn(`${by} voice retired: ${detail}`);
  }
  const fallback = pickSpeaker(getSettings());
  if (first) persistFailure(by, fallback, detail);
  if (fallback) {
    speaker = fallback;
    job.status = 'pending'; // re-say this sentence with the working voice
    if (first) {
      broadcast(
        IpcChannels.sessionError,
        `${LABELS[by]} is out of credits or its key was refused — switched to ${LABELS[fallback]}.`,
      );
    }
  } else {
    // No voice left: this sentence and everything queued go silent, but
    // their moments still fire so the caption keeps carrying the words.
    job.status = 'done';
    for (const queued of jobs) {
      if (queued.status === 'pending') queued.status = 'done';
    }
    if (first) {
      broadcast(
        IpcChannels.sessionError,
        `${LABELS[by]} is out of credits or its key was refused, and no other voice is set up — replies are text-only.`,
      );
    }
  }
}

/** Write the switch and the Providers-page warning so they survive a relaunch. */
function persistFailure(by: ApiSpeaker, fallback: Speaker | null, detail: string): void {
  // A failure through the Buddy proxy says nothing about a key the user never pasted.
  const ownKey = Boolean(getApiKey(by));
  updateSettings({
    ...(ownKey
      ? {
          keyWarnings: {
            ...getSettings().keyWarnings,
            [by]: keyWarningText(getSettings(), by, keyWarningKind(detail)),
          },
        }
      : {}),
    ...(fallback ? { ttsProvider: fallback } : {}),
  });
  broadcastSettings();
}

/** A Test, a new key, or picking this voice again means retry it next turn. */
export function reviveSpeaker(provider: string): void {
  if (provider === 'elevenlabs') demoted.delete(provider);
}

// --- The providers ----------------------------------------------------------
// Each one says a sentence as audio bytes and knows whether it is set up. The
// recorder plays whatever comes back, so only the container varies by provider.

type Speaker = TtsProvider;
/** The speakers with an API key that can die; the system voice has none. */
type ApiSpeaker = Exclude<Speaker, 'system'>;

interface SpeakerImpl {
  ready(settings: Settings): boolean;
  say(text: string, settings: Settings): Promise<Uint8Array>;
  mime: string;
}

const SPEAKERS: Record<Speaker, SpeakerImpl> = {
  elevenlabs: {
    ready: (s) => providerReady('elevenlabs') && Boolean(s.elevenLabsVoiceId),
    say: synthesizeElevenLabs,
    mime: 'audio/mpeg',
  },
  system: {
    ready: () => process.platform === 'darwin',
    say: synthesizeSystem,
    mime: 'audio/wav',
  },
};

/**
 * Who speaks this response: the chosen provider when it's set up and its key
 * hasn't died this run, otherwise the free macOS voice — silence only on a
 * platform without one.
 */
function pickSpeaker(settings: Settings): Speaker | null {
  // Airplane mode: the offline system voice, or nothing.
  if (settings.airplaneMode) {
    return SPEAKERS.system.ready(settings) ? 'system' : null;
  }
  // The walk speaks with ElevenLabs on Buddy's key, whatever was picked before it.
  if (!settings.onboardingDone && !demoted.has('elevenlabs') && SPEAKERS.elevenlabs.ready(settings)) return 'elevenlabs';
  const wanted = settings.ttsProvider;
  if (!demoted.has(wanted) && SPEAKERS[wanted].ready(settings)) return wanted;
  return SPEAKERS.system.ready(settings) ? 'system' : null;
}

/**
 * The built-in macOS voice, via `say`: free, offline, and always available,
 * so Buddy talks out of the box (and keeps talking when every key is dead).
 * Robotic next to the paid voices — the last resort, not the default.
 */
async function synthesizeSystem(text: string, settings: Settings): Promise<Uint8Array> {
  const file = join(tmpdir(), `buddy-say-${randomUUID()}.wav`);
  const args = ['-o', file, '--data-format=LEI16@22050'];
  if (settings.systemVoice) args.push('-v', settings.systemVoice);
  // Text goes over stdin (-f -): a sentence starting with "-" is not a flag.
  args.push('-f', '-');
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile('say', args, { signal: clipSignal() }, (error) =>
        error ? reject(error) : resolve(),
      );
      child.stdin?.end(text);
    });
    return new Uint8Array(await readFile(file));
  } finally {
    void rm(file, { force: true });
  }
}

// Prefer the low-latency model so speech starts quickly; if the account's
// plan rejects it, drop to multilingual_v2 (available everywhere) and stay
// there for the rest of the run.
let elevenLabsModel = 'eleven_flash_v2_5';

async function synthesizeElevenLabs(text: string, settings: Settings): Promise<Uint8Array> {
  return requestElevenLabs(settings.elevenLabsVoiceId, text);
}

/** Held on every reply, so two voices don't collapse into one. */
const VOICE_SETTINGS = { stability: 0.35, similarity_boost: 0.9, use_speaker_boost: true };

async function requestElevenLabs(voiceId: string, text: string): Promise<Uint8Array> {
  const abort = clipSignal();
  const settings = getSettings();
  // During the walk the voice ids are ones on Buddy's account, so the call
  // uses that key even when a personal ElevenLabs key is saved.
  const auth = settings.onboardingDone
    ? await credentials('elevenlabs')
    : (await managedCredentials('elevenlabs')) ?? (await credentials('elevenlabs'));
  if (!auth) throw new Error('No way to reach ElevenLabs for speech.');
  const attempt = (model: string): Promise<Response> =>
    fetch(
      `${auth.baseURL ?? ELEVENLABS_URL}/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': auth.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: model, voice_settings: VOICE_SETTINGS }),
        signal: abort,
      },
    );

  let response = await attempt(elevenLabsModel);
  if (response.status === 409) {
    // Transient "already_running" conflict when two sentences synthesize in
    // parallel on the same voice: wait briefly and retry once.
    await sleep(750);
    response = await attempt(elevenLabsModel);
  }
  if ([400, 402, 403].includes(response.status) && elevenLabsModel !== 'eleven_multilingual_v2') {
    log.warn(`${elevenLabsModel} rejected (HTTP ${response.status}); falling back to eleven_multilingual_v2`);
    elevenLabsModel = 'eleven_multilingual_v2';
    response = await attempt(elevenLabsModel);
  }
  if (!response.ok) {
    // The body carries the real reason (quota, plan, bad voice ID, …).
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`ElevenLabs HTTP ${response.status}: ${detail}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
