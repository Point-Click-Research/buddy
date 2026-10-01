// What a job template needs, checked live: the settings view plus the MCP
// servers and connected apps, each fetched once per session and refreshed
// when the window regains focus. A missing row jumps to the page that turns
// it on.

import { useEffect, useState, type ReactElement } from 'react';
import type { CheckItem, UseCaseSnap } from '../../../shared/use-cases';
import { buddy } from '../../buddy';
import { Button, Skeleton, TableRow } from '../../ui';
import { useSettings } from '../context';

// Last fetch stays put so a remount does not flash a status bone on rows
// that were already known. null means this session hasn't loaded yet.
let lastServers: UseCaseSnap['servers'] | null = null;
let lastApps: string[] | null = null;
let lastSignins: string[] | null = null;

export function useSnap(): {
  snap: UseCaseSnap;
  pendingServers: boolean;
  pendingApps: boolean;
  pendingSignins: boolean;
} {
  const { view } = useSettings();
  const [servers, setServers] = useState(lastServers);
  const [connectedApps, setConnectedApps] = useState(lastApps);
  const [signedInHosts, setSignedInHosts] = useState(lastSignins);

  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void buddy.getMcpServers().then(
        (next) => {
          if (!alive) return;
          lastServers = next.map(({ name, url, enabled, status }) => ({ name, url, enabled, status }));
          setServers(lastServers);
        },
        () => alive && setServers([]),
      );
      void buddy.listAppConnections().then(
        (next) => {
          if (!alive || !next) return;
          lastApps = next.filter((entry) => entry.status === 'active').map((entry) => entry.slug);
          setConnectedApps(lastApps);
        },
        () => alive && setConnectedApps([]),
      );
      void buddy.listSignedInSites().then(
        (next) => {
          if (!alive) return;
          lastSignins = next;
          setSignedInHosts(next);
        },
        () => alive && setSignedInHosts([]),
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('focus', refresh);
    };
  }, [view.appKeys.composio, view.settings.browserLoginsFrom]);

  return {
    snap: {
      disabledBuiltinTools: view.settings.disabledBuiltinTools,
      screenAwareness: view.settings.screenAwareness,
      marksEnabled: view.settings.marksEnabled,
      agentModeEnabled: view.settings.agentModeEnabled,
      servers: servers ?? [],
      hasCard: Boolean(view.appKeys.card),
      shopifyKey: view.appKeys.shopify,
      shipping: view.settings.buddyShipping,
      connectedApps: connectedApps ?? [],
      signedInHosts: signedInHosts ?? [],
    },
    pendingServers: servers === null,
    pendingApps: connectedApps === null,
    pendingSignins: signedInHosts === null,
  };
}

export function ReadinessRow({
  item,
  index,
  pending,
}: {
  item: CheckItem;
  index: number;
  pending: boolean;
}): ReactElement {
  const fix = item.fix;
  return (
    <TableRow
      index={index}
      main={
        <span className="flex items-center gap-2">
          {item.label}
          {pending ? (
            <Skeleton className="h-3 w-16" />
          ) : item.ok ? (
            <span className="font-medium text-[11px] text-ok"> · Ready</span>
          ) : item.required ? null : (
            <span className="font-medium text-[11px] text-faint"> · Recommended</span>
          )}
        </span>
      }
      detail={pending ? <Skeleton className="h-3 w-40" /> : item.detail}
      action={
        pending || !fix ? null : (
          <Button onClick={() => buddy.openSettingsWindow(fix.page)}>{fix.label.replace(/^\+\s/, '')}</Button>
        )
      }
    />
  );
}
