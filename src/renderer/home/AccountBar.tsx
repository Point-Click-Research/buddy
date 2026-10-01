// The chat window's sidebar footer: the apps Buddy can reach, then who is
// signed in. Each row is one click into the Settings page that owns it.

import { Plus } from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { CONNECT_APPS } from '../../shared/connect-apps';
import type { AccountView } from '../../shared/types';
import { buddy } from '../buddy';
import { useAccount, useAppConnections } from '../shared/account-data';
import { formatIdentity, fullName, meterFraction, meterLine, planLabel, usageLevel } from '../shared/account-text';
import { Avatar, SiteIcon, Skeleton, cn } from '../ui';

/** App marks shown before the rest fold into "+N". */
const STACK = 3;

/**
 * Every target is 40px tall with the same inset, so the two rows share both
 * edges. Focus reads as hover: the window coming back can hand a row
 * keyboard focus, and Chromium's own ring is the macOS accent color.
 */
const TARGET =
  'app-no-drag flex h-10 w-full cursor-pointer items-center rounded-md border-0 bg-transparent px-2 text-nav outline-none transition-colors duration-150 hover:bg-wash hover:text-nav-active focus-visible:bg-wash focus-visible:text-nav-active';

export function AccountBar(): ReactElement {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 border-t border-line px-1.25 py-2">
      <AppsRow />
      <AccountRow />
    </div>
  );
}

function AppsRow(): ReactElement {
  const connections = useAppConnections();
  // Null is "not fetched for this sign-in yet". An empty list is the only
  // time the row can honestly say nothing is connected.
  if (connections === null) {
    return (
      <span className="flex h-10 items-center gap-2 px-2" aria-hidden>
        <Skeleton className="h-3 w-10" />
        <Skeleton className="ml-auto size-5 rounded-full" />
      </span>
    );
  }
  const apps = connections.flatMap((connection) =>
    connection.status === 'active' ? CONNECT_APPS.filter((app) => app.slug === connection.slug) : [],
  );
  const none = apps.length === 0;
  return (
    <button
      type="button"
      onClick={() => buddy.openSettingsWindow('apps')}
      title={apps.length ? apps.map((app) => app.label).join(', ') : undefined}
      className={cn(TARGET, 'gap-2 text-left text-[13px] font-medium')}
    >
      <span className="min-w-0 flex-1 truncate">{none ? 'Connect apps' : 'Apps'}</span>
      {none ? (
        <Coin>
          <Plus className="size-3" strokeWidth={2} aria-hidden />
        </Coin>
      ) : null}
      {apps.length ? (
        <span className="fade-in flex shrink-0">
          {apps.slice(0, STACK).map((app, index) => (
            <Coin key={app.slug} className={index > 0 ? '-ml-2' : undefined} style={{ zIndex: index + 1 }}>
              <SiteIcon host={app.host} className="size-3.5" />
            </Coin>
          ))}
          {apps.length > STACK ? (
            <Coin className="-ml-2" style={{ zIndex: STACK + 1 }}>
              <span className="px-1 text-[10px] tabular-nums text-nav">+{apps.length - STACK}</span>
            </Coin>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** A logo, the "+N" count, or the empty-state plus, raised so each reads on the canvas. */
function Coin({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <span
      className={cn(
        'relative flex h-5 min-w-5 items-center justify-center rounded-full bg-chip shadow-button-secondary',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

function AccountRow(): ReactElement {
  const account = useAccount();
  if (!account) {
    return (
      <span className="flex h-10 items-center gap-2.5 px-2" aria-hidden>
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </span>
    );
  }
  return <Identity account={account} />;
}

/** Avatar, name, plan and today's tasks. One click opens Settings on Account (API keys in a build with no account). */
function Identity({ account }: { account: AccountView }): ReactElement {
  const signedIn = account.configured && account.signedIn;
  const name = fullName(account);
  const who = !account.configured
    ? 'Your own keys'
    : !signedIn
      ? 'Sign in'
      : name || formatIdentity(account.identity) || 'Add your name';
  // Tasks are the metered thing on every plan; talk is unlimited on the paid ones.
  const tasks = signedIn ? account.meters?.tasks ?? null : null;
  const fraction = meterFraction(tasks);
  return (
    <button
      type="button"
      onClick={() => buddy.openSettingsWindow(account.configured ? 'account' : 'providers')}
      className={cn(TARGET, 'gap-2.5 text-left')}
    >
      <Avatar name={signedIn ? account.firstName : ''} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium leading-4 text-nav-active">{who}</span>
        <span className="flex items-center gap-1.5 text-[11px] leading-4 text-faint">
          {!signedIn ? (
            account.configured ? 'Free to start' : 'No account'
          ) : (
            <>
              {planLabel(account)}
              {tasks && tasks.limit ? (
                <>
                  <span aria-hidden>·</span>
                  <UsageRing fraction={fraction} />
                  <span className={cn('tabular-nums', fraction >= 1 && 'text-danger')}>{meterLine(tasks)} tasks</span>
                </>
              ) : null}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/** Today's tasks as a small ring; amber from 80%, red when used up. */
function UsageRing({ fraction }: { fraction: number }): ReactElement {
  const radius = 5;
  const around = 2 * Math.PI * radius;
  const tone = { ok: 'text-nav', warn: 'text-warn', danger: 'text-danger' }[usageLevel(fraction)];
  return (
    <svg viewBox="0 0 14 14" className={cn('size-3 shrink-0 -rotate-90', tone)} aria-hidden>
      <circle cx="7" cy="7" r={radius} fill="none" stroke="var(--secondary)" strokeWidth="2.5" />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={around}
        strokeDashoffset={around * (1 - fraction)}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
    </svg>
  );
}
