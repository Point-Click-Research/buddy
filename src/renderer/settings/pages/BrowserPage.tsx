// Settings → Buddy's Browser: the sign-ins in Buddy's own browser. Bring them over
// from the browser the user already lives in, sign in to one site by hand
// (the browser opens expanded on it), or sign out of everything. The walk
// shows BringLogins on its own.

import { useEffect, useState, type ReactElement } from 'react';
import { errorMessage } from '../../../shared/errors';
import { typedAddressUrl } from '../../../shared/link-text';
import { SIGN_IN_SITES, type LoginSource } from '../../../shared/types';
import { buddy } from '../../buddy';
import { AppIcon, Button, Card, LinkButton, Note, SectionHeader, SiteIcon, Skeleton, Table, TableRow, TextInput } from '../../ui';
import { useSettings } from '../context';

type Outcome = { ok: boolean; message: string };

/** The green word beside a row that is already done. */
function DoneMark({ children }: { children: string }): ReactElement {
  return <span className="fade-in text-[11px] font-medium text-ok">{children}</span>;
}

export function BrowserPage(): ReactElement {
  return (
    <>
      <SectionHeader
        title="Buddy's browser"
        description="Buddy has its own local browser for getting things done on the web while you keep working. Open it to see what it sees, type an address, or sign in somewhere by hand."
      />
      <Card>
        <div className="flex items-center justify-between">
          <span className="font-medium">Show Buddy's browser</span>
          <Button variant="secondary" onClick={() => buddy.sendBrowserCommand('expand')}>
            Open
          </Button>
        </div>
      </Card>
      <SectionHeader
        title="Bring your sign-ins"
        description="Buddy's browser starts signed out. Bring the sign-ins from the browser you use, and it's signed in wherever you are. Buddy can also use your browser depending on what he's doing."
      />
      <BringLogins />
      <SignInSites />
      <ForgetLogins />
    </>
  );
}

/** One browser action at a time, and what it said. */
function useBrowserAction(): { busy: string; notice: Outcome | null; run: (id: string, action: () => Promise<Outcome>) => void } {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Outcome | null>(null);
  const run = (id: string, action: () => Promise<Outcome>): void => {
    setBusy(id);
    setNotice(null);
    action()
      .then(setNotice, (error: unknown) => setNotice({ ok: false, message: errorMessage(error) }))
      .finally(() => setBusy(''));
  };
  return { busy, notice, run };
}

function OutcomeNote({ notice }: { notice: Outcome | null }): ReactElement | null {
  return notice ? <Note tone={notice.ok ? 'ok' : 'fail'}>{notice.message}</Note> : null;
}

/** The user's browser profiles, most recently used first, each with Bring. */
export function BringLogins(): ReactElement {
  const { view } = useSettings();
  const [sources, setSources] = useState<LoginSource[] | null>(null);
  const { busy, notice, run } = useBrowserAction();
  const from = view.settings.browserLoginsFrom;
  const bringing = sources?.find((source) => source.id === busy);

  useEffect(() => {
    void buddy.listLoginSources().then(setSources, () => setSources([]));
  }, []);

  return (
    <>
      <Table
        columns={[
          { key: '#', label: '#' },
          { key: 'main', label: 'Browser' },
          { key: 'action', label: '' },
        ]}
        empty={sources === null ? <Skeleton className="h-3 w-24" /> : 'No Chrome, Arc, Dia, Brave, Edge, or Vivaldi on this Mac'}
      >
        {(sources ?? []).map((source, index) => (
          <TableRow
            key={source.id}
            index={index + 1}
            main={
              <span className="flex items-center gap-2">
                <AppIcon name={source.app} />
                {source.label}
                {from === source.label ? <DoneMark>Brought</DoneMark> : null}
              </span>
            }
            action={
              <Button
                variant="secondary"
                className="w-24"
                disabled={busy !== ''}
                onClick={() => run(source.id, () => buddy.bringLogins(source.id))}
              >
                {busy === source.id ? '…' : from === source.label ? 'Update' : 'Bring'}
              </Button>
            }
          />
        ))}
      </Table>
      {bringing ? (
        <Note>macOS asks for your Mac password to share {bringing.label}'s sign-ins with Buddy.</Note>
      ) : (
        <OutcomeNote notice={notice} />
      )}
    </>
  );
}

/** A site the user signs in to themselves, in Buddy's browser, expanded. One a brought profile already covers says so. */
function SignInSites(): ReactElement {
  const { view } = useSettings();
  const [address, setAddress] = useState('');
  const [signedIn, setSignedIn] = useState<string[]>([]);
  const { busy, notice, run } = useBrowserAction();
  const open = (id: string, url: string): void => run(id, () => buddy.openInBrowser(url));
  const from = view.settings.browserLoginsFrom;

  // Signing in happens over in Buddy's browser, so the answer changes while
  // this window is in the background: look again when it comes back, and
  // after a Bring or Start over (which change `from`).
  useEffect(() => {
    const check = (): void => {
      void buddy.listSignedInSites().then(setSignedIn, (error: unknown) => {
        console.warn(`signed-in check failed: ${errorMessage(error)}`);
        setSignedIn([]);
      });
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [from]);
  const openAddress = (): void => {
    const url = typedAddressUrl(address);
    if (url) open('address', url);
  };

  const signedSet = new Set(signedIn);
  const sites = [...SIGN_IN_SITES].toSorted((a, b) => {
    const aIn = signedSet.has(a.host);
    const bIn = signedSet.has(b.host);
    if (aIn !== bIn) return aIn ? -1 : 1;
    return SIGN_IN_SITES.indexOf(a) - SIGN_IN_SITES.indexOf(b);
  });

  return (
    <>
      <SectionHeader
        title="Sign in to a site"
        description="Opens Buddy's browser on the site. Sign in there, and it stays signed in."
      />
      <Table
        columns={[
          { key: '#', label: '#' },
          { key: 'main', label: 'Site' },
          { key: 'action', label: '' },
        ]}
      >
        {sites.map((site, index) => {
          const done = signedSet.has(site.host);
          return (
            <TableRow
              key={site.host}
              index={index + 1}
              main={
                <span className="flex items-center gap-2">
                  <SiteIcon host={site.host} />
                  {site.label}
                  {done ? <DoneMark>Signed in</DoneMark> : null}
                </span>
              }
              action={
                <Button variant="secondary" className="w-24" disabled={busy !== ''} onClick={() => open(site.host, site.url)}>
                  {done ? 'Open' : 'Sign in'}
                </Button>
              }
            />
          );
        })}
      </Table>
      <form
        className="mt-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          openAddress();
        }}
      >
        <TextInput
          label="Another site"
          placeholder="nytimes.com"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          action={{ label: 'Open', variant: 'secondary', onClick: openAddress }}
        />
      </form>
      <OutcomeNote notice={notice} />
    </>
  );
}

function ForgetLogins(): ReactElement {
  const { view } = useSettings();
  const { busy, notice, run } = useBrowserAction();
  const from = view.settings.browserLoginsFrom;
  return (
    <>
      <SectionHeader title="Start over" description="Signs Buddy's browser out of every site. Your own browser is untouched." />
      <Card>
        <div className="flex items-center justify-between">
          <span className="font-medium">{from ? `Sign-ins from ${from}` : "Buddy's sign-ins"}</span>
          <LinkButton tone="danger" disabled={busy !== ''} onClick={() => run('forget', () => buddy.forgetLogins())}>
            Sign out of everything
          </LinkButton>
        </div>
        <OutcomeNote notice={notice} />
      </Card>
    </>
  );
}
