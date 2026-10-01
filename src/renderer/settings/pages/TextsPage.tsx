// Texting Buddy from the phone: the iMessage bridge. Texting holds the switch,
// the user's number with a test that proves both directions, and approvals;
// Setup is the one-time split that gives Buddy its own thread in Messages.

import { BatteryLow, PlugZap } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { buddy } from '../../buddy';
import {
  AppIcon,
  Button,
  Card,
  LinkButton,
  cn,
  Note,
  SectionHeader,
  Skeleton,
  SwitchInput,
  TabbedView,
  Table,
  TableRow,
  TextInput,
} from '../../ui';
import { useSettings } from '../context';

/**
 * Texting yourself shows every message twice (sent, then received). Splitting
 * the two iMessage addresses, number on the phone and email on this Mac, makes
 * the thread Buddy's own. Same order as the user will do it.
 */
const SETUP_STEPS: { main: string; detail: string; action?: 'fullDisk' | 'messagesSettings' }[] = [
  {
    main: 'On your iPhone, follow these steps',
    detail: 'In Settings → Apps → Messages → Send & Receive, uncheck your Apple ID email.',
  },
  {
    main: 'On this Mac, follow these steps',
    detail: 'In Messages → Settings → iMessage, under "You can be reached for messages at," leave only your Apple ID email checked.',
    action: 'messagesSettings',
  },
  {
    main: 'Give Buddy Full Disk Access',
    detail: 'Enable access so Buddy can read texts. Restart Buddy after.',
    action: 'fullDisk',
  },
  {
    main: 'Save Buddy as a contact on your iPhone',
    detail: 'Name it Buddy, use your Apple ID email, and text it.',
  },
];

/**
 * The switch, the number, and a test send. `full` adds the approval switch;
 * the first-run walk leaves that for Settings and shows the setup steps beside this.
 */
export function TextBridgeCard({ full = false }: { full?: boolean }): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;
  const enabled = settings.textBridgeEnabled;
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const runTest = (): void => {
    if (testing) return;
    setTesting(true);
    void buddy
      .testTextBridge()
      .then(setTest)
      .finally(() => setTesting(false));
  };

  return (
    <Card>
      <SwitchInput
        icon={<AppIcon name="Messages" className="size-9" />}
        label="Answer my iMessages"
        subtitle="Buddy can use your Mac and connected apps from a text."
        checked={enabled}
        onChange={(checked) => void patch({ textBridgeEnabled: checked })}
      />
      {enabled ? (
        <div className="fade-in flex flex-col gap-[18px] border-t border-line pt-[18px]">
          <TextInput
            label="Your iPhone number"
            subtitle="Buddy answers this number and no one else."
            placeholder="+1 555 123 4567"
            value={settings.textBridgeHandle}
            onChange={(event) => {
              setTest(null);
              void patch({ textBridgeHandle: event.target.value });
            }}
            action={{ label: testing ? 'Sending…' : 'Send test', onClick: runTest, variant: 'secondary' }}
            info={test?.ok ? test.message : undefined}
            error={test && !test.ok ? test.message : undefined}
          />
          {full ? (
            <SwitchInput
              label="Ask before acting"
              subtitle="Buddy texts you for a YES before it sends, buys, or changes anything."
              checked={settings.textBridgeConfirm}
              onChange={(checked) => void patch({ textBridgeConfirm: checked })}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** The one-time split that gives Buddy its own thread, including Full Disk Access. */
export function TextSetup(): ReactElement {
  const [readable, setReadable] = useState<boolean | null>(null);
  const refreshAccess = (): void => {
    void buddy.canReadMessages().then(setReadable);
  };
  useEffect(() => {
    if (readable) return;
    if (readable === null) refreshAccess();
    const timer = setInterval(refreshAccess, 3000);
    return () => clearInterval(timer);
  }, [readable]);
  return (
    <Table columns={[{ key: '#', label: '#' }, { key: 'main', label: 'Step' }, { key: 'action', label: '' }]}>
      {SETUP_STEPS.map(({ main, detail, action }, index) => {
        const disk = action === 'fullDisk';
        return (
          <TableRow
            key={main}
            index={index + 1}
            main={
              disk && readable ? (
                <span className="flex items-center gap-2">
                  {main}
                  <span className="fade-in text-[11px] font-medium text-ok">Granted</span>
                </span>
              ) : (
                main
              )
            }
            detail={disk && readable ? 'Buddy can read your texts.' : detail}
            action={
              disk && readable === null ? (
                <Skeleton className="h-7 w-16" />
              ) : disk && !readable ? (
                <Button onClick={() => void buddy.requestPermission('fullDisk').then(refreshAccess)}>Grant</Button>
              ) : action === 'messagesSettings' ? (
                <Button variant="secondary" onClick={() => void buddy.openMessagesSettings()}>
                  Open Messages
                </Button>
              ) : null
            }
          />
        );
      })}
    </Table>
  );
}

export function TextsPage(): ReactElement {
  const { view } = useSettings();
  const enabled = view.settings.textBridgeEnabled;
  const [readable, setReadable] = useState<boolean | null>(null);

  const refreshAccess = (): void => {
    void buddy.canReadMessages().then(setReadable);
  };

  // Each check opens the database; once it opens, there is nothing left to watch.
  useEffect(() => {
    if (readable) return;
    if (readable === null) refreshAccess();
    const timer = setInterval(refreshAccess, 3000);
    return () => clearInterval(timer);
  }, [readable]);

  const texting = (
    <>
      <SectionHeader
        title="Text Buddy over iMessage"
        description="Text Buddy from Messages on your iPhone. It answers from this Mac, so nothing passes through a Buddy server."
      />
      <TextBridgeCard full />
      {enabled && readable === false ? (
        <Note tone="warn">Buddy can't read your texts yet. Give it Full Disk Access under Stop double texts.</Note>
      ) : null}
      {enabled ? <StayReachable /> : null}
    </>
  );

  const setup = (
    <>
      <SectionHeader
        title="Give Buddy its own thread"
        description="Your number stays on your iPhone and your Apple ID email moves to this Mac, so Buddy's replies arrive like anyone else's."
      />
      <TextSetup />
      <Note>Still seeing every text twice? Turn off Messages in iCloud on both devices.</Note>
    </>
  );

  return (
    <TabbedView
      tabs={[
        { id: 'texting', label: 'Texting', panel: texting },
        { id: 'setup', label: 'Stop double texts', panel: setup },
      ]}
    />
  );
}

/** Whether a text gets answered right now, from the Mac's power source; checked while the page is open. */
function StayReachable(): ReactElement {
  const [onBattery, setOnBattery] = useState<boolean | null>(null);
  useEffect(() => {
    const check = (): void => void buddy.isOnBattery().then(setOnBattery);
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, []);
  const plugged = onBattery === false;
  return (
    <>
      <SectionHeader title="Stay reachable" description="Buddy can only answer while your Mac is awake." />
      <Card>
        {onBattery === null ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div key={String(plugged)} className="fade-in flex items-start gap-3">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md',
                plugged ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn',
              )}
            >
              {plugged ? (
                <PlugZap className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <BatteryLow className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {plugged ? 'Plugged in: Buddy can answer anytime' : 'Not plugged in: texts wait while your Mac sleeps'}
              </span>
              <span className="text-[13px] leading-5 text-muted">
                {plugged ? (
                  "Buddy keeps your Mac awake while it's on power. The screen still turns off and locks. Keep the lid open, or connect a display if it's closed."
                ) : (
                  <>
                    Your Mac is running on battery, so it can fall asleep, and Buddy answers once it wakes. To stay
                    reachable, plug it in with the lid open or on a display. Or keep it awake on battery: in{' '}
                    <LinkButton
                      className="text-[13px] leading-5 underline decoration-muted/40 underline-offset-2"
                      onClick={() => void buddy.openLockScreenSettings()}
                    >
                      System Settings → Lock Screen
                    </LinkButton>
                    , set “Turn display off on battery when inactive” to Never (the battery drains faster). For Buddy
                    around the clock, a dedicated Mac that stays plugged in works best.
                  </>
                )}
              </span>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
