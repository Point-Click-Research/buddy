// The Buddy account: sign in with Google, then who you are, the plan and
// today's talk and tasks, and signing out. Keys are never mentioned here;
// bringing your own lives under Developer → API keys.

import { isPaidPlan, nextPlanUp, type Meter, type UpgradePlan } from '../../../shared/contracts';
import { useState, type ReactElement } from 'react';
import type { AccountView, UpdateStatus } from '../../../shared/types';
import { MyReferralCode, ReferralCode } from '../../account/ReferralCode';
import { SignInForm } from '../../account/SignInForm';
import { buddy } from '../../buddy';
import { useAccount, useUpdateStatus } from '../../shared/account-data';
import {
  formatIdentity,
  fullName,
  meterFraction,
  meterLine,
  planIncludes,
  planLabel,
  planName,
  poolFraction,
  poolLine,
  usageLevel,
} from '../../shared/account-text';
import { BUDDY_FEEDBACK_EMAIL } from '../../../shared/site';
import { Avatar, Button, Card, cn, Note, SectionHeader, Skeleton, SwitchInput, TextInput } from '../../ui';

export function AccountPage(): ReactElement {
  const view = useAccount();
  if (!view) return <AccountSkeleton />;
  if (!view.configured) {
    return (
      <>
        <Profile view={view} />
        <SectionHeader title="Account" />
        <Note>
          This build has no Buddy account service, so there is nothing to sign in to. Buddy runs on your own keys under
          Developer → API keys, and your name stays on this Mac.
        </Note>
        <Updates />
        <Feedback />
      </>
    );
  }
  if (!view.signedIn) {
    return (
      <>
        <SectionHeader title="Account" description="Sign in and Buddy works, no API keys to paste. Free to start." />
        <Card>
          <SignInForm />
        </Card>
        <Updates />
        <Feedback />
      </>
    );
  }
  return (
    <>
      <Profile view={view} />
      <Plan view={view} />
      <SectionHeader title="Signed in" />
      <Card>
        <div className="flex items-center justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Sign out of Buddy</span>
            <span className="truncate text-[13px] leading-5 text-muted">
              Signed in as {formatIdentity(view.identity)}
            </span>
          </span>
          <Button variant="secondary" onClick={() => void buddy.signOut({ showSignIn: true })}>
            Sign out
          </Button>
        </div>
      </Card>
      <Updates />
      <Feedback />
    </>
  );
}

/** The signed-in page's shape while the account loads: the same headers and cards, with bones for the words. */
function AccountSkeleton(): ReactElement {
  return (
    <div className="fade-in" aria-busy aria-label="Loading account">
      <SkeletonHeader width="w-16" />
      <Card>
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <SkeletonLines title="w-32" detail="w-48" />
        </div>
      </Card>
      <SkeletonHeader width="w-10" />
      <Card>
        <SkeletonRow title="w-24" detail="w-56" />
        {['w-16', 'w-20'].map((label) => (
          <div key={label} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Skeleton className={`h-2.5 ${label} rounded-full`} />
              <Skeleton className="h-2.5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </Card>
      <SkeletonHeader width="w-20" />
      <Card>
        <SkeletonRow title="w-28" detail="w-52" />
      </Card>
    </div>
  );
}

function SkeletonHeader({ width }: { width: string }): ReactElement {
  return (
    <div className="mb-3.5 mt-6.5 first:mt-1">
      <Skeleton className={`h-3 ${width} rounded-full`} />
    </div>
  );
}

function SkeletonLines({ title, detail }: { title: string; detail: string }): ReactElement {
  return (
    <span className="flex min-w-0 flex-col gap-2">
      <Skeleton className={`h-3 ${title} rounded-full`} />
      <Skeleton className={`h-2.5 ${detail} rounded-full`} />
    </span>
  );
}

/** A card row's bones: two lines of text, and a button on the right. */
function SkeletonRow({ title, detail }: { title: string; detail: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <SkeletonLines title={title} detail={detail} />
      <Skeleton className="h-7 w-20 shrink-0 rounded-xs" />
    </div>
  );
}

/** Opens the default mail app to send product feedback. */
function Feedback(): ReactElement {
  const status = useUpdateStatus();
  const open = (): void => {
    const version = status?.version ?? 'unknown';
    const params = new URLSearchParams({
      subject: 'Buddy feedback',
      body: `\n\n---\nBuddy ${version}\n`,
    });
    void buddy.openMailto(`mailto:${BUDDY_FEEDBACK_EMAIL}?${params.toString()}`);
  };
  return (
    <>
      <SectionHeader title="Feedback" description="Tell us what works, what doesn't, and what you'd like next." />
      <Card>
        <div className="flex items-center justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Send feedback</span>
            <span className="truncate text-[13px] leading-5 text-muted">{BUDDY_FEEDBACK_EMAIL}</span>
          </span>
          <Button variant="secondary" onClick={open}>
            Email us
          </Button>
        </div>
      </Card>
    </>
  );
}

/** What the update status reads as, under the version. */
function updateLine(status: UpdateStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading ${status.available ?? 'the update'}${status.percent ? ` · ${status.percent}%` : ''}`;
    case 'ready':
      return `${status.available ?? 'An update'} is ready. It installs when Buddy restarts.`;
    case 'error':
      return status.message ?? 'The update check failed.';
    default:
      return status.message ?? "You're up to date.";
  }
}

/** The running version, with the check and the restart the updater needs a person for. */
function Updates(): ReactElement {
  const status = useUpdateStatus();
  if (!status) {
    return (
      <>
        <SectionHeader title="Version" />
        <Card className="fade-in">
          <SkeletonRow title="w-20" detail="w-44" />
        </Card>
      </>
    );
  }
  return (
    <>
      <SectionHeader title="Version" />
      <Card>
        <div className="flex items-center justify-between gap-4">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Buddy {status.version}</span>
            <span className="truncate text-[13px] leading-5 text-muted">{updateLine(status)}</span>
          </span>
          {status.state === 'ready' ? (
            <Button onClick={() => void buddy.installUpdate()}>Restart to update</Button>
          ) : (
            <Button
              variant="secondary"
              disabled={status.state === 'checking' || status.state === 'downloading'}
              onClick={() => void buddy.checkForUpdates()}
            >
              Check for updates
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}

/** Who you are: the avatar and name the chat window shows, and the fields that set them. Saved on blur. */
function Profile({ view }: { view: AccountView }): ReactElement {
  const [firstName, setFirstName] = useState(view.firstName);
  const [lastName, setLastName] = useState(view.lastName);
  const [error, setError] = useState('');
  const save = (): void => {
    if (firstName.trim() === view.firstName && lastName.trim() === view.lastName) return;
    void buddy.setAccountName(firstName, lastName).then((result) => setError(result.ok ? '' : result.message));
  };
  const identity = view.configured ? formatIdentity(view.identity) : 'Saved on this Mac';
  return (
    <>
      <SectionHeader title="Profile" />
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={view.firstName} size="lg" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[15px] font-medium">{fullName(view) || 'Add your name'}</span>
            <span className="truncate text-[13px] text-muted">{identity}</span>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="First name"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            onBlur={save}
          />
          <TextInput
            label="Last name"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            onBlur={save}
          />
        </div>
        <Note tone="fail">{error}</Note>
      </Card>
    </>
  );
}

const BAR = { ok: 'bg-ink', warn: 'bg-warn', danger: 'bg-danger' } as const;

/**
 * The plan, what it includes, how much of it is used, and the way to change
 * it. A daily plan shows today's talk and tasks; a paid plan shows the
 * month's pool of model use and the switch for going past it.
 */
function Plan({ view }: { view: AccountView }): ReactElement {
  const [billingError, setBillingError] = useState('');
  const meters = view.meters;
  const paid = isPaidPlan(view.plan);
  // The next plan up that Stripe sells here; none on Max, or when Stripe is off.
  const next = nextPlanUp(view.plan, view.upgrades);
  const openBilling = (kind: 'checkout' | 'portal', plan?: UpgradePlan): void => {
    void buddy.openBilling(kind, plan).then((result) => setBillingError(result.ok ? '' : result.message));
  };
  const setOnDemand = (on: boolean): void => {
    void buddy.setOnDemand(on).then((result) => setBillingError(result.ok ? '' : result.message));
  };

  return (
    <>
      <SectionHeader title="Plan" />
      <Card>
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">You're on the {planLabel(view)} plan</span>
            <span className="text-[13px] leading-5 text-muted">{planIncludes(view)}</span>
          </span>
          <span className="flex shrink-0 gap-2">
            {paid && view.billing ? (
              <Button variant="secondary" onClick={() => openBilling('portal')}>
                Manage billing
              </Button>
            ) : null}
            {next ? (
              <Button variant={paid ? 'secondary' : 'primary'} onClick={() => openBilling('checkout', next)}>
                Upgrade to {planName(next)}
              </Button>
            ) : null}
          </span>
        </div>
        {paid && view.usage ? (
          <Bar label="Model use this month" line={poolLine(view.usage)} fraction={poolFraction(view.usage)} />
        ) : meters ? (
          <div className="flex flex-col gap-3">
            <MeterBar label="Talk today" meter={meters.talk} />
            <MeterBar label="Tasks today" meter={meters.tasks} />
          </div>
        ) : null}
        {view.onDemand !== null ? (
          <SwitchInput
            label="Extra usage past the included amount"
            subtitle="Billed at the end of the month at model cost, on your Buddy invoice. Off means Buddy asks before going past."
            checked={view.onDemand}
            onChange={setOnDemand}
          />
        ) : null}
        {view.plan === 'waitlist' ? <ReferralCode /> : null}
        {view.referral ? <MyReferralCode code={view.referral.code} uses={view.referral.uses} /> : null}
        <Note tone="fail">{billingError}</Note>
      </Card>
    </>
  );
}

/** One day's meter: the count against its limit, and a bar when there is one. */
function MeterBar({ label, meter }: { label: string; meter: Meter }): ReactElement {
  return <Bar label={label} line={meterLine(meter)} fraction={meter.limit === null ? null : meterFraction(meter)} />;
}

/** A label, the reading, and a bar; no bar when there is no limit to fill. */
function Bar({ label, line, fraction }: { label: string; line: string; fraction: number | null }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-muted">{label}</span>
        <span className={cn('font-medium tabular-nums', fraction !== null && fraction >= 1 && 'text-danger')}>{line}</span>
      </div>
      {fraction !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-wash" aria-label={label}>
          <div
            className={cn('h-full rounded-full transition-[width] duration-700 ease-out', BAR[usageLevel(fraction)])}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
