// Persist a thinking model the plan can actually run, so the picker and the
// next ask agree.

import { brainForPlan } from '../../shared/plan-models';
import { BRAIN_PROVIDERS } from '../../shared/types';
import { broadcastSettings } from '../settings-view';
import { getApiKey, getSettings, updateSettings } from '../settings';
import { resnapshotPersonal } from './personal';

/**
 * Point the stored cloud models at ones this plan includes. `previous` is the
 * plan before this answer, so a plan that just grew hands the starter back
 * to a brain the old plan had pushed down. No-op on an own key, or when the
 * models already fit.
 */
export function fitBrainToPlan(allowed: readonly string[], userId: string, previous: readonly string[] | null = null): void {
  if (allowed.length === 0 || getApiKey('openrouter')) return;
  const settings = getSettings();
  const next = brainForPlan(
    { brainModel: settings.brainModel, brainFastModel: settings.brainFastModel },
    BRAIN_PROVIDERS.openrouter,
    allowed,
    previous,
  );
  if (next.brainModel === settings.brainModel && next.brainFastModel === settings.brainFastModel) return;
  updateSettings(next);
  broadcastSettings();
  resnapshotPersonal(userId);
}
