// ElevenLabs hosts a short sample for each voice. Playing that file does not
// spend speech credits; only text-to-speech does. Voices saved on the account
// expose it on GET /v1/voices/:id. Library voices that are not on the account
// (a 400) expose the same file on the public voice library.

import { credentials, managedCredentials } from '../account/credentials';
import { getSettings } from '../settings';
import { ELEVENLABS_URL } from './tts';

const cache = new Map<string, string>();
const VOICE_ID = /^[A-Za-z0-9]{8,40}$/;

interface VoiceBody {
  preview_url?: unknown;
  verified_languages?: { preview_url?: unknown }[] | null;
}

function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') ? value : null;
}

/** This voice's own sample. A url that names the id wins; otherwise the voice's preview. */
function ownedPreview(id: string, body: VoiceBody): string | null {
  const urls = [body.preview_url, ...(body.verified_languages ?? []).map((lang) => lang.preview_url)].flatMap((url) => {
    const https = httpsUrl(url);
    return https ? [https] : [];
  });
  return urls.find((url) => url.includes(`/${id}/`)) ?? urls[0] ?? null;
}

/** The public library sample, when the voice is not saved on the account. */
async function libraryPreview(base: string, apiKey: string, id: string): Promise<string | null> {
  const url = new URL(`${base}/v1/shared-voices`);
  url.searchParams.set('page_size', '10');
  url.searchParams.set('search', id);
  const res = await fetch(url, { headers: { 'xi-api-key': apiKey, accept: 'application/json' } });
  if (!res.ok) return null;
  const body = (await res.json()) as { voices?: { voice_id?: unknown; preview_url?: unknown }[] };
  const match = body.voices?.find((voice) => voice.voice_id === id);
  return httpsUrl(match?.preview_url);
}

/** Public sample URLs for these voice ids. Missing ones are omitted. */
export async function voicePreviewUrls(ids: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.map((id) => String(id ?? '')))].filter((id) => VOICE_ID.test(id));
  const missing = wanted.filter((id) => !cache.has(id));
  if (missing.length > 0) {
    const settings = getSettings();
    const auth = settings.onboardingDone
      ? await credentials('elevenlabs')
      : (await managedCredentials('elevenlabs')) ?? (await credentials('elevenlabs'));
    if (auth) {
      const base = auth.baseURL ?? ELEVENLABS_URL;
      const headers = { 'xi-api-key': auth.apiKey, accept: 'application/json' };
      await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await fetch(`${base}/v1/voices/${id}`, { headers });
            const owned = res.ok ? ownedPreview(id, (await res.json()) as VoiceBody) : null;
            const preview = owned ?? (await libraryPreview(base, auth.apiKey, id));
            if (preview) cache.set(id, preview);
          } catch {
            // The next time the menu opens can try again.
          }
        }),
      );
    }
  }
  const out: Record<string, string> = {};
  for (const id of wanted) {
    const url = cache.get(id);
    if (url) out[id] = url;
  }
  return out;
}
