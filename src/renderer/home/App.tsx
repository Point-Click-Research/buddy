// The chat home: every conversation on the left, the open one on the right,
// and a composer for typed asks. Opening a conversation makes it the one
// voice asks continue too — what you are looking at is what Buddy is in.
// Nothing else lives here: what Buddy can do is set up in Settings, and
// Buddy opens the right page itself when an ask needs something.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { ChatIndex, ConversationView, PermissionsStatus } from '../../shared/types';
import { SignInGate } from '../account/SignInGate';
import { buddy } from '../buddy';
import { useAccount, useTourStop } from '../shared/account-data';
import { useSettingsView } from '../settings/context';
import { Button, cn } from '../ui';
import logo from './assets/logo.svg';
import { AccountBar } from './AccountBar';
import { Composer, type ComposerField } from './Composer';
import { ComposerTray } from './ComposerTray';
import { Approvals } from './Approvals';
import { EmptyChat } from './EmptyChat';
import { Onboarding } from './Onboarding';
import { exchangeLanded, getLiveTurn, releaseLiveTurn, subscribeLive } from './live';
import { TodaysIdeas, useHasIdeas, type IdeaHandlers } from './Suggestions';
import { Thread } from './Thread';
import { History, PlusIcon, Smartphone } from 'lucide-react';

export function App(): ReactElement | null {
  const [index, setIndex] = useState<ChatIndex | null>(null);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  // The draft lives here because the composer sits in the empty view's column
  // and, once a thread exists, over the bottom of that thread.
  const [draft, setDraft] = useState('');
  const area = useRef<ComposerField>(null);
  const live = useSyncExternalStore(subscribeLive, getLiveTurn);
  const account = useAccount();
  const settingsView = useSettingsView();
  const hasIdeas = useHasIdeas();
  // The tour's "chats" stop points at the list; a fixed callout, no drawing.
  const tourStop = useTourStop();

  useEffect(() => {
    void buddy.getChatIndex().then((next) => {
      // A window a notification opened boots straight onto its thread.
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash.startsWith('conversation-')) {
        const id = hash.slice('conversation-'.length);
        setViewedId(id);
        void buddy.setActiveConversation(id).then(setIndex);
        return;
      }
      // Reopen on the conversation an exchange landed in this run. One that
      // was merely viewed opens on New Chat instead — and main starts fresh
      // too, so the next ask matches what the window shows.
      const focus = next.activeId !== null && next.activeId === next.engagedId ? next.activeId : null;
      setViewedId(focus);
      if (focus === null && next.activeId !== null) {
        void buddy.setActiveConversation(null).then(setIndex);
      } else {
        setIndex(next);
      }
    });
    buddy.onChatChanged(setIndex);
    // A notification click: land on its thread, or New Chat (suggestions).
    buddy.onHomeShow((target) => {
      const id = target.conversationId ?? null;
      setViewedId(id);
      void buddy.setActiveConversation(id).then(setIndex);
    });
  }, []);

  // Buddy's own threads (the work log, the texts) are read, not written to:
  // no composer, and an ask made while one is open starts a fresh chat.
  const viewed = index?.conversations.find((entry) => entry.id === viewedId);
  const log = Boolean(viewed?.background || viewed?.texts);

  // On the new-chat view (or the log), follow the conversation the first ask creates.
  const activeId = index?.activeId ?? null;
  useEffect(() => {
    if ((viewedId === null || log) && activeId) setViewedId(activeId);
  }, [activeId]);

  // A thread that left with the previous account should not stay open.
  useEffect(() => {
    if (!index || viewedId === null) return;
    if (index.conversations.some((conversation) => conversation.id === viewedId)) return;
    setViewedId(null);
  }, [index, viewedId]);

  // (Re)fetch the open conversation whenever it gains messages.
  useEffect(() => {
    if (!viewedId) {
      setConversation(null);
      return;
    }
    let stale = false;
    void buddy.getConversation(viewedId).then((view) => {
      if (!stale) setConversation(view);
    });
    return () => {
      stale = true;
    };
  }, [viewedId, index]);

  // The live exchange shows only in the thread it started in. (Comparing to
  // activeId would pass everywhere: opening a thread makes it active.)
  // A first message has no thread yet: it belongs here while its conversation
  // id is still null, and for the beat after the id arrives but before the
  // pane follows it.
  const opening =
    viewedId === null && (live.conversationId === null || live.conversationId === activeId);
  const belongs = live.conversationId === viewedId || opening;
  const turn =
    belongs && (live.running || live.user.trim() !== '' || Boolean(live.error)) ? live : null;
  const messages = conversation?.messages ?? [];
  const empty = turn === null && !log && (viewedId === null || messages.length === 0);

  // The finished exchange stays in the live tail until this conversation has
  // the saved copy, so the first message does not vanish between the two.
  useEffect(() => {
    if (turn && exchangeLanded(messages, turn)) releaseLiveTurn();
  }, [turn, messages]);

  // The walk covers this window. Painting the empty chat while account and
  // settings are still on the way is what flashes it, then jumps to the step.
  // The window stays hidden until this shell has actually painted.
  const signedOut = Boolean(account?.configured && !account.signedIn);
  const shellReady = Boolean(index && (signedOut || (account && settingsView)));
  useEffect(() => {
    if (!shellReady) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => buddy.homeReady());
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [shellReady]);
  if (!shellReady || !index) {
    return <div className="fixed inset-0 bg-canvas" />;
  }

  const open = (id: string | null): void => {
    setViewedId(id);
    void buddy.setActiveConversation(id).then(setIndex);
    // Already on New Chat: take the caret back from the sidebar click. A
    // switch from a thread remounts the field, and autoFocus lands it.
    if (id === null) area.current?.focus();
  };

  // A suggested ask lands in the composer on New Chat, to send or rewrite.
  const draftAsk = (prompt: string): void => {
    open(null);
    setDraft(prompt);
  };

  const remove = (id: string): void => {
    void buddy.deleteConversation(id).then((next) => {
      setIndex(next);
      if (viewedId === id) setViewedId(null);
    });
  };

  const composer = (
    <Composer
      draft={draft}
      onDraft={setDraft}
      area={area}
      conversationId={viewedId}
      busy={live.running}
      autoFocus={empty}
      glow={empty}
    />
  );

  // What a suggestion in the New Chat space does.
  const ideaHandlers: IdeaHandlers = {
    onAdjust: draftAsk,
    // Run now: the same pipeline as any typed ask, streamed live.
    onRun: (prompt) => {
      open(null);
      buddy.sendChatMessage(prompt, null);
    },
  };

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-55 shrink-0 flex-col border-r border-line bg-canvas">
        <div className="shrink-0 border-b border-line">
          {/* The title strip sits beside the traffic lights. app-region is not
              inherited, so this element has to be a drag region itself. */}
          <div className="app-drag h-10.5" />
          <div
            className="app-drag flex flex-row items-center justify-between px-4"
            onClick={() => open(null)}
          >
            <img
              src={logo}
              alt="Buddy"
              draggable={false}
              className="app-no-drag size-14 cursor-pointer dark:invert"
            />
            <PlusIcon className="app-no-drag size-5 cursor-pointer" strokeWidth={1.5} />
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.25 py-2 outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tourStop === 'chats' ? (
            <p className="fade-in m-0 mx-1.75 mb-2 rounded-md border border-line bg-raised px-3 py-2 text-[12px] leading-4 text-ink shadow-card">
              Your conversations live here.
            </p>
          ) : null}
          {index.conversations.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {index.conversations.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => open(entry.id)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.75',
                    viewedId === entry.id ? 'bg-wash' : 'hover:bg-wash',
                  )}
                >
                  {/* Buddy's own threads wear an icon: not chats of theirs. */}
                  {entry.background ? (
                    <History className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
                  ) : entry.texts ? (
                    <Smartphone className="size-3.5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden />
                  ) : null}
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-left text-[13px]',
                      entry.unread ? 'font-medium' : 'font-regular',
                      viewedId === entry.id || entry.unread ? 'text-nav-active' : 'text-nav',
                    )}
                  >
                    {entry.title}
                  </span>
                  {entry.unread ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-link group-hover:hidden" aria-label="Unread" />
                  ) : null}
                  <span className="shrink-0 text-[11px] text-faint group-hover:hidden">
                    {when(entry.updatedAt)}
                  </span>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove(entry.id);
                    }}
                    className="hidden shrink-0 cursor-pointer rounded-[4px] border-0 bg-transparent px-1 text-[13px] leading-none text-muted hover:text-danger group-hover:block"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </nav>
        <AccountBar />
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Floats over the thread instead of sitting above it, so scrolled
            content runs to the window edge and the pane still drags. */}
        <div className="app-drag absolute inset-x-0 top-0 z-10 h-11.25" />
        <PermissionsBanner />
        <SignInGate />
        <Onboarding />
        {empty ? (
          <EmptyChat composer={<ComposerTray>{composer}</ComposerTray>} centered={!hasIdeas}>
            <TodaysIdeas {...ideaHandlers} />
          </EmptyChat>
        ) : (
          <>
            <Thread messages={messages} live={turn} />
            {/* Floats over the thread so messages scroll under the solid input. */}
            <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 py-3">
              <div className="pointer-events-auto mx-auto max-w-2xl">
                <Approvals conversationId={viewedId} />
                {log ? (
                  <p className="m-0 text-center text-[12px] text-faint">
                    {viewed?.texts ? 'Reply from your phone, or ask in a new chat.' : 'Buddy reports here. Ask in a new chat.'}
                  </p>
                ) : (
                  composer
                )}
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * Shown while any macOS permission is missing — the onboarding path for a
 * fresh install. Polls so granting in System Settings clears it live.
 */
function PermissionsBanner(): ReactElement | null {
  const [status, setStatus] = useState<PermissionsStatus | null>(null);

  useEffect(() => {
    const refresh = (): void => void buddy.getPermissions().then(setStatus);
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  if (!status || Object.values(status).every((state) => state === 'granted')) return null;

  return (
    // app-no-drag: the banner sits under the pane's drag overlay, and its
    // button must win the click.
    <div className="app-no-drag relative z-20 flex items-center gap-3 border-b border-line bg-wash px-6 py-2.5 text-[13px]">
      <span className="flex-1">
        Buddy needs a few macOS permissions before it can hear you and see your screen.
      </span>
      <Button variant="secondary" onClick={() => buddy.openSettingsWindow('permissions')}>
        Grant permissions
      </Button>
    </div>
  );
}

/** A sidebar-sized timestamp: time today, date otherwise. */
function when(epochMs: number): string {
  const date = new Date(epochMs);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
