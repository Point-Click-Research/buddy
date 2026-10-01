// The media_control tool: sound and playback, handled natively.
//
// "Turn it down" and "skip this song" should be one call, not a proposed
// agent task. Playback and mute go through the keyboard's media keys (via
// nut-driver, so whatever is playing responds — Music, Spotify, a browser
// tab). Volume goes through AppleScript's `set volume`, which needs no
// permission at all and can land on an exact level.

import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { jxaErrorMessage, runJxa } from './apple/jxa';
import { type ToolOutcome, type ToolRegistry, toolArgs } from './ai/tools';
import { tapMediaKey, type MediaKey } from './computer/nut-driver';
import { createLogger } from './log';
import { getPermissions, requestPermission } from './permissions';
import { errorMessage } from '../shared/errors';

const execFileAsync = promisify(execFile);
const log = createLogger('media');

/** One "turn it up" should be audible, not one of sixteen bezel ticks. */
const VOLUME_STEP = 10;

/** The actions that are a media-key press; the rest are volume scripts. */
const TRANSPORT: Partial<Record<string, MediaKey>> = {
  play_pause: 'play_pause',
  next_track: 'next_track',
  previous_track: 'previous_track',
  mute: 'mute',
};

const MEDIA_CONTROL: Tool = {
  name: 'media_control',
  description:
    "Control the Mac's sound and whatever is playing: pause or resume, skip tracks, change " +
    'the volume, or ask what is playing. Works on the system player — Music, Spotify, a browser ' +
    'tab. mute toggles. now_playing only looks at apps that are already running.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'play_pause',
          'next_track',
          'previous_track',
          'volume_up',
          'volume_down',
          'set_volume',
          'mute',
          'now_playing',
        ],
      },
      level: { type: 'integer', description: 'Output volume 0-100, for set_volume only.' },
    },
    required: ['action'],
  },
};

/** Register media_control. A no-op off macOS. */
export function addMediaControlTool(registry: ToolRegistry): void {
  if (process.platform !== 'darwin') return;
  registry.set('media_control', { definition: MEDIA_CONTROL, execute: mediaControl });
}

async function mediaControl(input: unknown): Promise<ToolOutcome> {
  const args = toolArgs(input);
  const action = typeof args['action'] === 'string' ? args['action'] : '';
  try {
    const transport = TRANSPORT[action];
    if (transport) {
      // Media keys are synthesized input, which macOS gates on Accessibility.
      if (getPermissions().accessibility !== 'granted') {
        void requestPermission('accessibility');
        return {
          content:
            'Buddy needs the Accessibility permission to press media keys. I opened System ' +
            'Settings — the user must grant it there, then ask again.',
          isError: true,
        };
      }
      await tapMediaKey(transport);
      return { content: 'done' };
    }

    if (action === 'volume_up' || action === 'volume_down') {
      const landed = await nudgeVolume(action === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP);
      return { content: `Output volume is now ${landed}%.` };
    }
    if (action === 'set_volume') {
      const level = args['level'];
      if (typeof level !== 'number' || !Number.isFinite(level)) {
        return { content: 'set_volume needs level, a number from 0 to 100.', isError: true };
      }
      const landed = await setVolume(Math.round(Math.min(100, Math.max(0, level))));
      return { content: `Output volume is now ${landed}%.` };
    }
    if (action === 'now_playing') return nowPlaying();
    return { content: `Unknown media action "${action}".`, isError: true };
  } catch (error) {
    const detail = errorMessage(error);
    log.warn(`media_control ${action} failed: ${detail}`);
    return { content: `That didn't work: ${detail}`, isError: true };
  }
}

/** Move the output volume by a step. Returns where it landed (macOS clamps). */
async function nudgeVolume(delta: number): Promise<number> {
  return runVolumeScript(
    `set current to output volume of (get volume settings)
     set volume output volume (current + ${delta})
     return output volume of (get volume settings)`,
  );
}

/** Set the output volume to an exact level. Returns where it landed. */
async function setVolume(level: number): Promise<number> {
  return runVolumeScript(
    `set volume output volume ${level}
     return output volume of (get volume settings)`,
  );
}

async function runVolumeScript(source: string): Promise<number> {
  const { stdout } = await execFileAsync('osascript', ['-e', source], { timeout: 5_000 });
  const landed = Number.parseInt(stdout.trim(), 10);
  if (Number.isNaN(landed)) throw new Error('macOS did not report the volume back.');
  return landed;
}

/** Only apps that are already running — scripting a closed player would launch it. */
async function nowPlaying(): Promise<ToolOutcome> {
  try {
    const raw = await runJxa(
      `(() => {
        const players = ['Music', 'Spotify'];
        const out = [];
        for (const name of players) {
          const app = Application(name);
          if (!app.running()) continue;
          try {
            const track = app.currentTrack;
            out.push({
              app: name,
              state: String(app.playerState()),
              title: track.name(),
              artist: track.artist(),
              album: track.album() || '',
            });
          } catch (e) {
            out.push({ app: name, state: 'stopped', title: '', artist: '', album: '' });
          }
        }
        return JSON.stringify(out);
      })()`,
      8_000,
    );
    const tracks = JSON.parse(raw) as Array<{
      app: string;
      state: string;
      title: string;
      artist: string;
      album: string;
    }>;
    const playing = tracks.filter((t) => t.title && t.state !== 'stopped');
    if (playing.length === 0) return { content: 'Nothing is playing in Music or Spotify.' };
    const lines = playing.map((t) => {
      const album = t.album ? ` — ${t.album}` : '';
      return `${t.app} (${t.state}): ${t.title} by ${t.artist}${album}`;
    });
    return { content: lines.join('\n') };
  } catch (error) {
    log.warn(`now_playing failed: ${error instanceof Error ? error.message : error}`);
    return { content: jxaErrorMessage(error, 'Music or Spotify'), isError: true };
  }
}
