// Picking the provider for one task. The user chooses in Settings and the
// Cua driver is the default; Buddy falls back to the basic provider only
// when Cua can't drive this task at all (it addresses the primary display
// only, and needs its native package for this platform). Coding rule: the
// choice is made once, before the task starts — never per action.

import { jev } from '../ai/jev';
import { createLogger } from '../log';
import { getSettings } from '../settings';
import type { AgentTaskMode } from '../../shared/types';
import { PageSession } from '../browser/page';
import { basicIoForDisplay, createBasicProvider } from './basic-provider';
import { createBrowserProvider } from './browser-provider';
import type { DriverSafetyHooks } from './claim';
import { createCuaProvider } from './cua-provider';
import { isPrimaryDisplay } from './display-capture';
import type { ComputerProvider } from './provider';
import { errorMessage } from '../../shared/errors';

const log = createLogger('computer');

export interface ProviderChoice {
  provider: ComputerProvider;
  /** Why the chosen provider isn't the preferred one, for the log and plan card. */
  note?: string;
}

export async function createComputerProvider(
  displayId: number,
  hooks: DriverSafetyHooks,
  mode: { current: AgentTaskMode } = { current: 'watch' },
): Promise<ProviderChoice> {
  const basic = (note?: string): ProviderChoice => {
    if (note) log.warn(`using the basic provider: ${note}`);
    return { provider: createBasicProvider(basicIoForDisplay(displayId, hooks)), note };
  };

  // Buddy's own browser needs no display, driver, or Accessibility: the page
  // is driven from the inside.
  if (mode.current === 'browser') {
    log.info("using Buddy's browser");
    return { provider: createBrowserProvider(new PageSession(), (await jev()) ?? undefined) };
  }
  if (getSettings().computerProvider === 'basic') return basic();
  if (!isPrimaryDisplay(displayId)) {
    return basic('the Cua driver only drives the primary display, and this task is on another one');
  }

  try {
    const provider = await createCuaProvider(displayId, hooks);
    log.info('using the Cua driver');
    return { provider };
  } catch (error) {
    const detail = errorMessage(error);
    return basic(`the Cua driver could not start (${detail})`);
  }
}
