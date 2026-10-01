// The model menu in Settings: whatever OpenRouter currently offers, filtered
// to models that write text. The list is public, so a key only personalizes it.

import type { ModelListResult, ProviderModel } from '../shared/types';
import { OPENROUTER_URL } from './ai/openrouter';
import { getApiKey } from './settings';
import { errorMessage } from '../shared/errors';

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; models: ProviderModel[] } | null = null;

export async function listProviderModels(provider: string): Promise<ModelListResult> {
  if (provider !== 'openrouter') return { models: [], error: 'No model list for this provider.' };
  if (cache && Date.now() - cache.at < CACHE_MS) return { models: cache.models, error: '' };
  try {
    const models = await listOpenRouter();
    cache = { at: Date.now(), models };
    return { models, error: '' };
  } catch (error) {
    return { models: [], error: errorMessage(error).replace(/\s+/g, ' ').slice(0, 160) };
  }
}

interface OrRow {
  id?: string;
  name?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

async function listOpenRouter(): Promise<ProviderModel[]> {
  const apiKey = getApiKey('openrouter');
  const res = await fetch(`${OPENROUTER_URL}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const body = (await res.json()) as { data?: OrRow[] };
  const seen = new Set<string>();
  const models = (body.data ?? []).flatMap((row) => {
    const id = row.id?.trim();
    // Batch rows are the same models on OpenRouter's async Batch API: cheaper,
    // answered later, no use in a live turn.
    if (!id || seen.has(id) || /embed/i.test(id) || /:batch$/i.test(id) || /\(batch\)/i.test(row.name ?? '')) return [];
    const output = outputModalities(row);
    if (!(output.includes('text') || output.length === 0)) return [];
    seen.add(id);
    return [{ id, label: row.name?.trim() || id }];
  });
  return models.sort((a, b) => a.label.localeCompare(b.label));
}

function outputModalities(row: OrRow): string[] {
  const arch = row.architecture ?? {};
  if (arch.output_modalities?.length) return arch.output_modalities;
  const output = (arch.modality ?? '').split('->')[1];
  return output ? output.split('+').filter(Boolean) : [];
}
