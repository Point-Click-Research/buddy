import { useEffect, useState, type ReactElement } from 'react';
import { Tabs } from '../../ui';
import { buddy } from '../../buddy';
import { ConnectAppsPage } from './ConnectAppsPage';
import { NativeToolsPage } from './HandsPage';

const INTEGRATION_TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'native', label: 'Built-in' },
] as const;

type IntegrationTab = (typeof INTEGRATION_TABS)[number]['id'];

/** Sidebar aliases and deep links that open Apps on the matching tab. MCP is its own page. */
export const INTEGRATION_ROUTES = new Set(['integrations', 'apps', 'native', 'hands']);

/** Which Apps tab a jump (`native`, `hands`, `integrations:native`) asked for. */
function consumeIntegrationsTab(): IntegrationTab {
  return tabFromRoute(window.location.hash.slice(1));
}

function tabFromRoute(raw: string): IntegrationTab {
  const [id, nested] = raw.split(':');
  if (id === 'native' || nested === 'native' || id === 'hands') return 'native';
  return 'apps';
}

export function IntegrationsPage(): ReactElement {
  const [tab, setTab] = useState<IntegrationTab>(consumeIntegrationsTab);
  useEffect(() => {
    let alive = true;
    buddy.onSettingsShowPage((next) => {
      if (!alive) return;
      if (!INTEGRATION_ROUTES.has(next.split(':')[0] ?? '')) return;
      setTab(tabFromRoute(next));
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Tabs tabs={INTEGRATION_TABS} active={tab} onSelect={setTab} />
      {/* Its own box, so the tab's first header sits under the tabs, not a section's height below. */}
      <div>{tab === 'apps' ? <ConnectAppsPage /> : <NativeToolsPage />}</div>
    </>
  );
}
