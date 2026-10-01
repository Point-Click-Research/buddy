import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { CONNECT_APPS, connectAppFor } from '../../../shared/connect-apps';
import type { AppConnection } from '../../../shared/types';
import { buddy } from '../../buddy';
import { useAccount } from '../../shared/account-data';
import { Button, Note, SectionHeader, SiteIcon, Skeleton, Table, TableRow, TextInput } from '../../ui';
import { useSettings } from '../context';
import { errorMessage } from '../../../shared/errors';

/** Last list so leaving and coming back does not flash every status bone. */
let lastConnections: AppConnection[] | null = null;

export function ConnectAppsPage({ heading = true }: { heading?: boolean }): ReactElement {
  const { view } = useSettings();
  const [connections, setConnections] = useState<AppConnection[] | null>(lastConnections);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [other, setOther] = useState('');
  const account = useAccount();
  const signedIn = account?.signedIn ?? false;
  const canConnect = view.appKeys.composio || signedIn;

  const remember = (next: AppConnection[]): void => {
    lastConnections = next;
    setConnections(next);
  };

  const refresh = (): void => {
    void buddy.listAppConnections().then((next) => next && remember(next)).catch(() => remember([]));
  };

  /** Run a connect or disconnect for one app, then re-read the list. */
  const act = (slug: string, run: () => Promise<{ ok: boolean; message: string }>): void => {
    setBusy(slug);
    setNotice('');
    run().then(
      (result) => {
        setNotice(result.message);
        setBusy('');
        refresh();
      },
      (error: unknown) => {
        setNotice(errorMessage(error));
        setBusy('');
      },
    );
  };

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [canConnect]);

  const shown = useMemo(() => {
    const linked = new Set((connections ?? []).map((entry) => entry.slug));
    // A toolkit linked by slug that the catalog doesn't feature still gets a row.
    const featured = new Set(CONNECT_APPS.map((app) => app.slug));
    const extra = [...linked].filter((slug) => !featured.has(slug)).map(connectAppFor);
    // Stable sort: connected first, catalog order within each group.
    return [...CONNECT_APPS, ...extra].toSorted((a, b) => Number(linked.has(b.slug)) - Number(linked.has(a.slug)));
  }, [connections]);

  const otherSlug = other.trim().toLowerCase();
  const connectOther = (): void => {
    if (!otherSlug) return;
    act(otherSlug, async () => {
      const result = await buddy.connectApp(otherSlug);
      if (result.ok) setOther('');
      return result;
    });
  };

  return (
    <>
      {heading ? (
        <SectionHeader
          title="Apps"
          description={
            account && !account.configured
              ? 'Connect an app in the browser. Add a Composio key under Developer → API keys first.'
              : account && !signedIn
                ? 'Sign in under Account to connect apps.'
                : 'Connect an app. Buddy uses only what you link.'
          }
        />
      ) : null}

      <Table
        columns={[
          { key: '#', label: '#' },
          { key: 'main', label: 'App' },
          { key: 'action', label: '' },
        ]}
      >
        {shown.map((app, index) => {
          const status = connections?.find((entry) => entry.slug === app.slug)?.status ?? null;
          const active = status === 'active';
          return (
            <TableRow
              key={app.slug}
              index={index + 1}
              main={
                <span className="flex items-center gap-2">
                  <SiteIcon host={app.host} />
                  {app.label}
                  {connections === null ? (
                    <Skeleton className="h-3 w-16" />
                  ) : active ? (
                    <span className="fade-in text-[11px] font-medium text-ok">Connected</span>
                  ) : status === 'expired' ? (
                    <span className="fade-in text-[11px] font-medium text-warn">Needs reconnect</span>
                  ) : null}
                </span>
              }
              detail={app.blurb}
              action={
                // One width and one weight down the column; only a broken connection asks for attention.
                <Button
                  variant={status === 'expired' ? 'primary' : 'secondary'}
                  className="w-24"
                  disabled={!canConnect || busy === app.slug}
                  onClick={() =>
                    act(app.slug, () => (active ? buddy.disconnectApp(app.slug) : buddy.connectApp(app.slug)))
                  }
                >
                  {busy === app.slug ? '…' : active ? 'Disconnect' : status === 'expired' ? 'Reconnect' : 'Connect'}
                </Button>
              }
            />
          );
        })}
      </Table>
      <div className="pt-6">
        <TextInput
          label="Connect another"
          subtitle="Any Composio toolkit by its slug, as composio.dev spells it."
          placeholder="google_calendar"
          value={other}
          disabled={!canConnect}
          onChange={(event) => setOther(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && connectOther()}
          action={{ label: otherSlug && busy === otherSlug ? '…' : 'Connect', onClick: connectOther }}
        />
      </div>
      {notice ? <Note>{notice}</Note> : null}
    </>
  );
}
