// "Test" button support: make the tiniest possible authenticated request
// per provider and report success or the error message.

import OpenAI from 'openai';
import type { KeyProvider, KeyTestResult } from '../shared/types';
import { jevClient } from './ai/jev';
import { OPENROUTER_URL } from './ai/openrouter';
import { getApiKey } from './settings';
import { errorMessage } from '../shared/errors';

export async function testApiKey(provider: KeyProvider): Promise<KeyTestResult> {
  const key = getApiKey(provider);
  if (!key) return { ok: false, message: 'No key saved yet.' };

  try {
    if (provider === 'openrouter') {
      await new OpenAI({ apiKey: key, baseURL: OPENROUTER_URL }).models.list();
    } else if (provider === 'elevenlabs') {
      const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } else {
      await jevClient(key).models.list();
    }
    return { ok: true, message: 'Key works.' };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}
