// The first-run walk, over the whole window until it is finished: a name,
// the three permissions (so the hotkey can work), the hotkey (held once),
// a voice, their story (heard, remembered, answered), apps, their browser's
// sign-ins, Text Buddy, and one drawing. Where they stand on the waitlist is
// the tour's first line, after. Each step reuses the settings page that owns the
// thing, inside the same provider the Settings window uses, so nothing about
// how a setting is saved is written twice. The step reached is saved as it is
// reached, so a quit on the way (System Settings, a restart) comes back to it.

import { ArrowUp, Check } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { typePlaceholder } from '../../shared/hotkeys';
import { SHOPPER_CATEGORIES, type AccountView, type DictationTranscript, type ShopperProfile } from '../../shared/types';
import { DEFAULT_VOICE_ID } from '../../shared/voices';
import { buddy } from '../buddy';
import { SettingsProvider, useSettings } from '../settings/context';
import { BringLogins } from '../settings/pages/BrowserPage';
import { ConnectAppsPage } from '../settings/pages/ConnectAppsPage';
import { PermissionsPage, usePermissions } from '../settings/pages/PermissionsPage';
import { AGENT_PRESETS, HOLD_PRESETS } from '../settings/pages/SummonPage';
import { TextBridgeCard, TextSetup } from '../settings/pages/TextsPage';
import { useAccount } from '../shared/account-data';
import { createBuddyStore } from '../shared/buddy-store';
import { Button, cn, HotkeyInput, TextInput } from '../ui';
import { Keycaps } from './Keycaps';
import { getLiveTurn, getLiveTurnSeq, subscribeLive } from './live';
import { VoiceSelect } from '../shared/VoiceSelect';

type StepId = 'name' | 'permissions' | 'hotkey' | 'voice' | 'story' | 'apps' | 'browser' | 'texts' | 'drawing';

interface Step {
  id: StepId;
  title: string;
  lead: string;
  body: ReactNode;
  /** Next stays off until this is true; absent means always on. */
  ready?: boolean;
  /** The step can be passed over. */
  skippable?: boolean;
}

/** Where Buddy is (idle, listening, thinking…), one subscription for the window. */
const useAppState = createBuddyStore(
  () => buddy.getState(),
  (publish) => buddy.onStateChanged(publish),
);

/** How many drawings have landed on a screen since the window opened. */
const useDrawingCount = createBuddyStore(
  async () => 0,
  (publish) => {
    let count = 0;
    buddy.onDrawings((payload) => {
      if (payload.commands.length > 0) publish(++count);
    });
  },
);

/** Shown while the walk is unfinished and someone is signed in (or this build has no account). */
export function Onboarding(): ReactElement | null {
  const account = useAccount();
  if (!account || (account.configured && !account.signedIn)) return null;
  return (
    <SettingsProvider>
      <Walk account={account} />
    </SettingsProvider>
  );
}

function Walk({ account }: { account: AccountView }): ReactElement | null {
  const { view, patch } = useSettings();
  const [firstName, setFirstName] = useState(account.firstName);
  const [lastName, setLastName] = useState('');
  const { settings } = view;
  const step = stepId(settings.onboardingStep);
  const state = useAppState();
  const listening = state === 'listening';
  const heardHotkey = useTurnStartedHere(step === 'hotkey');
  // The hotkey listener only starts in a process launched with Accessibility
  // already allowed: until a restart, the chord cannot be heard.
  const accessibility = usePermissions(step === 'hotkey').status?.accessibility;
  const [storyText, setStoryText] = useState(settings.onboardingStory);
  const [storyHeard, setStoryHeard] = useState(settings.onboardingStorySaved);
  /** Sent counts as done: whether Buddy found something to save is its call, never a wall. */
  const [storySent, setStorySent] = useState(false);
  const storyRef = useRef({ text: settings.onboardingStory, heard: settings.onboardingStorySaved });
  const patchRef = useRef(patch);
  storyRef.current = { text: storyText, heard: storyHeard };
  patchRef.current = patch;
  useEffect(() => {
    if (settings.onboardingStep) return;
    setStoryText('');
    setStoryHeard(false);
    if (settings.onboardingStory || settings.onboardingStorySaved) {
      void patch({ onboardingStory: '', onboardingStorySaved: false });
    }
  }, [settings.onboardingStep]);
  useEffect(() => {
    if (storyText === settings.onboardingStory && storyHeard === settings.onboardingStorySaved) return;
    const timer = setTimeout(() => {
      void patchRef.current({ onboardingStory: storyText, onboardingStorySaved: storyHeard });
    }, 300);
    return () => clearTimeout(timer);
  }, [storyText, storyHeard, settings.onboardingStory, settings.onboardingStorySaved]);
  useEffect(() => {
    const flush = (): void => {
      const current = storyRef.current;
      void patchRef.current({ onboardingStory: current.text, onboardingStorySaved: current.heard });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
  const drawn = useDrawn(step === 'drawing');
  usePermissionsWalk(step === 'permissions');
  const [travel, setTravel] = useState<null | { from: number; to: number; dir: 1 | -1; phase: 'leave' | 'enter' }>(null);
  useEffect(() => {
    if (travel?.phase !== 'leave') return;
    const timer = setTimeout(() => setTravel((current) => (current ? { ...current, phase: 'enter' } : null)), 150);
    return () => clearTimeout(timer);
  }, [travel?.phase]);
  useEffect(() => {
    if (travel?.phase !== 'enter') return;
    const timer = setTimeout(() => setTravel(null), 320);
    return () => clearTimeout(timer);
  }, [travel?.phase]);
  useEffect(() => {
    if (step !== 'voice') return;
    if (settings.ttsProvider === 'elevenlabs' && settings.speechEnabled) return;
    void patch({ ttsProvider: 'elevenlabs', speechEnabled: true });
  }, [step]);

  if (settings.onboardingDone) return null;

  const saveName = (): void => {
    const shoppers: ShopperProfile[] = [{ ...settings.shoppers[0]!, name: firstName.trim() || 'Me' }, ...settings.shoppers.slice(1)];
    void patch({ shoppers });
    if (account.configured) void buddy.setAccountName(firstName, lastName);
  };

  const steps: Step[] = [
    {
      id: 'name',
      title: "What's your name?",
      lead: 'Buddy greets you by it, and what it learns about you is filed under it.',
      ready: firstName.trim().length > 0,
      body: (
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="First name" autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <TextInput label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      ),
    },
    {
      id: 'permissions',
      title: 'Let Buddy hear, see, and click',
      lead: 'Required to hear, see, and control the Mac. Grant opens the system prompt or Settings.',
      skippable: true,
      body: <PermissionsPage />,
    },
    {
      id: 'hotkey',
      title: 'Hold the keys, talk, let go',
      lead: 'This is how you talk to Buddy with your voice.',
      ready: heardHotkey,
      body: (
        <>
          <Keycaps chord={settings.hotkey} pressed={listening} say={`Hi Buddy, my name is ${firstName.trim()}`} />
          <HotkeyInput
            label="Hotkey"
            value={settings.hotkey}
            onChange={(hotkey) => {
              // New here, they have never seen the agent's hotkey: when the talk chord
              // they picked is it, the agent moves to a free chord instead of refusing.
              const taken = [settings.alwaysOnHotkey, settings.quickAskHotkey, hotkey];
              const agentHotkey =
                settings.agentHotkey === hotkey
                  ? AGENT_PRESETS.find((preset) => !taken.includes(preset.value))?.value
                  : undefined;
              void patch(agentHotkey ? { hotkey, agentHotkey } : { hotkey });
            }}
            presets={HOLD_PRESETS}
          />
          {accessibility === 'denied' && !heardHotkey ? (
            <p className="m-0 flex items-center justify-between gap-3 text-[13px] leading-5 text-muted">
              <span>Accessibility takes on the next launch. Once it is on in System Settings, restart Buddy to hear the keys.</span>
              <Button variant="secondary" onClick={() => buddy.relaunch()}>
                Restart Buddy
              </Button>
            </p>
          ) : (
            <Done done={heardHotkey}>{heardHotkey ? 'Heard you.' : 'Waiting for you…'}</Done>
          )}
        </>
      ),
    },
    {
      id: 'voice',
      title: 'Pick a voice',
      lead: "How Buddy sounds when it talks back. You can change it later under Settings → Voice.",
      body: (
        <VoiceSelect
          value={settings.elevenLabsVoiceId || DEFAULT_VOICE_ID}
          onSelect={(elevenLabsVoiceId) =>
            void patch({ elevenLabsVoiceId, ttsProvider: 'elevenlabs', speechEnabled: true })
          }
        />
      ),
    },
    {
      id: 'story',
      title: 'Tell Buddy about yourself',
      lead: 'Whatever you want Buddy to know about you. Hold the hotkey and talk, or type, then edit and send. Buddy remembers it.',
      ready: storyHeard || storySent,
      skippable: true,
      body: (
        <StoryStep
          hotkey={settings.hotkey}
          text={storyText}
          saved={storyHeard}
          sent={storySent}
          onText={setStoryText}
          onSent={() => setStorySent(true)}
          onHeard={() => setStoryHeard(true)}
        />
      ),
    },
    {
      id: 'apps',
      title: 'Connect your apps',
      lead: 'The accounts Buddy can reach for you. Skip any of it; the chat window keeps offering.',
      skippable: true,
      body: <ConnectAppsPage heading={false} />,
    },
    {
      id: 'browser',
      title: 'Bring your sign-ins',
      lead: "Buddy has its own browser for getting things done on the web while you keep working. Bring the sign-ins from the browser you use, and it's signed in wherever you are.",
      skippable: true,
      body: <BringLogins />,
    },
    {
      id: 'texts',
      title: 'Text Buddy from your phone',
      lead: 'Give Buddy its own thread, then send a test. A reply means it works, and you can text it from your phone.',
      skippable: true,
      body: (
        <>
          <TextSetup />
          <TextBridgeCard />
        </>
      ),
    },
    {
      id: 'drawing',
      title: 'Buddy draws on your screen',
      lead: 'Buddy circles something on your screen and says what it is. Ask where anything is and it does the same. Then the tour starts.',
      body: <Done done={drawn}>{drawn ? 'There it is.' : 'Watch your screen…'}</Done>,
    },
  ];

  const at = Math.max(0, steps.findIndex((candidate) => candidate.id === step));
  const visibleAt = travel?.phase === 'leave' ? travel.from : travel?.phase === 'enter' ? travel.to : at;
  const shown = steps[visibleAt] ?? steps[at]!;
  // The last step (drawing) ends itself: main finishes the walk once the ring is up and spoken.
  const shownLast = visibleAt >= steps.length - 1;
  const commit = (index: number): void => {
    if (steps[at]?.id === 'name' && index > at) saveName();
    void patch({
      onboardingStep: steps[index]!.id,
      ...(steps[at]?.id === 'story' ? { onboardingStory: storyText, onboardingStorySaved: storyHeard } : {}),
    });
  };
  const move = (index: number): void => {
    if (travel || index === at || index < 0 || index >= steps.length) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) setTravel({ from: at, to: index, dir: index > at ? 1 : -1, phase: 'leave' });
    commit(index);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <div className="app-drag h-11.25 shrink-0" />
      <div className="app-no-drag min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6 pb-28 pt-20">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          <div
            key={shown.id}
            data-motion={travel?.phase ?? 'settle'}
            data-dir={travel?.dir ?? 1}
            className="step-pane flex flex-col gap-5"
          >
            <div className="flex flex-col gap-1">
              <h1 className="m-0 text-[20px] font-medium">{shown.title}</h1>
              <p className="m-0 text-[13px] leading-5 text-muted">{shown.lead}</p>
            </div>
            <div className="flex flex-col gap-3.5">{shown.body}</div>
          </div>
        </div>
      </div>
      <nav className="app-no-drag fixed inset-x-0 bottom-0 flex items-center gap-2 border-t border-line bg-canvas/70 px-6 py-4 backdrop-blur-md">
        {steps.length > 1 ? <Dots count={steps.length} at={at} /> : null}
        <span className="flex-1" />
        {visibleAt > 0 ? (
          <Button variant="secondary" disabled={travel !== null} onClick={() => move(at - 1)}>
            Back
          </Button>
        ) : null}
        {shown.skippable ? (
          <Button variant="secondary" disabled={travel !== null} onClick={() => move(at + 1)}>
            Skip
          </Button>
        ) : null}
        {shownLast ? null : (
          <Button disabled={travel !== null || shown.ready === false} onClick={() => move(at + 1)}>
            Next
          </Button>
        )}
      </nav>
    </div>
  );
}

const STEP_IDS: readonly StepId[] = ['name', 'permissions', 'hotkey', 'voice', 'story', 'apps', 'browser', 'texts', 'drawing'];

/** The saved step, or the first one when nothing (or something unknown) is saved. The retired waitlist step resumes on the last one. */
function stepId(saved: string): StepId {
  if (saved === 'waitlist') return 'drawing';
  return STEP_IDS.find((id) => id === saved) ?? 'name';
}

/** A line under a step with a check once the thing has happened. */
function Done({ done, children }: { done: boolean; children: ReactNode }): ReactElement {
  return (
    <p className={cn('m-0 flex items-center gap-2 text-[13px] leading-5', done ? 'text-ok' : 'text-muted')}>
      {done ? <Check className="size-4" strokeWidth={2} aria-hidden /> : null}
      {children}
    </p>
  );
}

function Dots({ count, at }: { count: number; at: number }): ReactElement {
  return (
    <span className="flex items-center gap-1.5" aria-label={`Step ${at + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} data-on={i === at} className="step-dot size-1.5 rounded-full" />
      ))}
    </span>
  );
}

/** The story box: type, or hold the hotkey and the words land here to edit, then send. */
function StoryStep({
  hotkey,
  text,
  saved,
  sent,
  onText,
  onSent,
  onHeard,
}: {
  hotkey: string;
  text: string;
  saved: boolean;
  sent: boolean;
  onText: (text: string) => void;
  onSent: () => void;
  onHeard: () => void;
}): ReactElement {
  const { view } = useSettings();
  const state = useAppState();
  const textRef = useRef(text);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const sentRef = useRef(false);
  const factsAtSend = useRef<number | null>(null);
  const busy = state === 'listening' || state === 'transcribing' || state === 'thinking' || state === 'speaking';
  textRef.current = text;
  const facts = factCount(view.settings.shoppers);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    buddy.setDictationField(true);
    return () => {
      buddy.setDictationField(false);
      if (!sentRef.current) buddy.setOnboardingStory(false);
    };
  }, []);

  useEffect(
    () =>
      subscribeDictation(({ kind, text: spoken }) => {
        if (kind !== 'final' || !spoken.trim()) return;
        const next = spoken.trim();
        const current = textRef.current;
        onText(!current.trim() ? next : /\s$/.test(current) ? `${current}${next}` : `${current} ${next}`);
      }),
    [onText],
  );

  useEffect(() => {
    if (saved || factsAtSend.current === null || facts <= factsAtSend.current) return;
    onHeard();
  }, [facts, saved, onHeard]);

  const send = (): void => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sentRef.current = true;
    factsAtSend.current = facts;
    buddy.setOnboardingStory(true);
    buddy.sendChatMessage(trimmed, null);
    onSent();
  };

  return (
    <>
      <div className="w-full rounded-base border border-line bg-raised shadow-card">
        <textarea
          ref={fieldRef}
          autoFocus
          value={text}
          rows={4}
          placeholder={typePlaceholder(hotkey)}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            send();
          }}
          className="block w-full min-h-[6.5rem] resize-none overflow-hidden border-0 bg-transparent px-3.5 py-3 text-[13px] leading-5 text-ink outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
          <span className="text-[11px] text-faint">
            {state === 'listening' || state === 'transcribing' ? 'Listening…' : '⏎ to send · ⇧⏎ for new line'}
          </span>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={!text.trim() || busy}
            className="flex size-7 cursor-pointer items-center justify-center rounded-xs border-0 bg-ink text-on-ink hover:bg-ink-hover disabled:cursor-default disabled:opacity-40"
          >
            <ArrowUp className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <Done done={saved || sent}>{saved ? 'Saved to Memory.' : sent ? 'Sent. Buddy has it.' : 'Edit it, then send.'}</Done>
    </>
  );
}

function factCount(shoppers: ShopperProfile[]): number {
  let count = 0;
  for (const shopper of shoppers) {
    for (const { key } of SHOPPER_CATEGORIES) count += shopper[key].length;
  }
  return count;
}

const dictationListeners = new Set<(event: DictationTranscript) => void>();
let dictationWired = false;

function subscribeDictation(listener: (event: DictationTranscript) => void): () => void {
  if (!dictationWired) {
    dictationWired = true;
    buddy.onDictation((event) => {
      for (const current of dictationListeners) current(event);
    });
  }
  dictationListeners.add(listener);
  return () => dictationListeners.delete(listener);
}

/** True once this step receives a transcript that started here, with words in it.
 * The live line is cleared once the saved transcript has it, so the fact of
 * hearing stays until the step is left.
 */
function useTurnStartedHere(active: boolean): boolean {
  const seq = useSyncExternalStore(subscribeLive, getLiveTurnSeq);
  const live = useSyncExternalStore(subscribeLive, getLiveTurn);
  const from = useRef<number | null>(null);
  const heard = useRef(false);
  if (!active) {
    from.current = null;
    heard.current = false;
  } else if (from.current === null) from.current = seq;
  if (!heard.current && from.current !== null && seq > from.current && live.user.trim().length > 0) {
    heard.current = true;
  }
  return heard.current;
}

/** A drawing has landed on some screen while the drawing step was showing. */
function useDrawn(active: boolean): boolean {
  const count = useDrawingCount() ?? 0;
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    if (active) setSeen((current) => current ?? count);
  }, [active, count]);
  return active && seen !== null && count > seen;
}

/** While the permissions step shows, main opens each missing pane in turn and floats the drag card. */
function usePermissionsWalk(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    buddy.setPermissionsWalk(true);
    return () => buddy.setPermissionsWalk(false);
  }, [active]);
}
