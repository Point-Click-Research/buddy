// One conversation's messages, with the in-progress exchange at the tail.

import { Phone, Repeat, Sparkles } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { Attachment } from '../../shared/attachments';
import { linkHost } from '../../shared/link-text';
import { callCardLines, type CallStatus, type ChatMessage, type MessageSource } from '../../shared/types';
import { AttachmentChips } from './AttachmentChips';
import { buddy } from '../buddy';
import { renderCaptionMarkdown } from '../overlay/caption-markdown';
import { withoutEmDash } from '../shared/markdown';
import { buildSourceChip } from '../shared/source-chip';
import { LinkText, Markdown, Note } from '../ui';
import { mountSiteIcon } from '../ui/SiteIcon';
import { useBrowserStatus } from './browser-data';
import { exchangeLanded, type LiveTurn } from './live';

/** How many sources a reply shows before the rest go behind "N more". */
const COLLAPSED_SOURCES = 5;

export function Thread({
  messages,
  live,
}: {
  messages: ChatMessage[];
  /** The in-progress exchange, when it belongs to this conversation. */
  live: LiveTurn | null;
}): ReactElement {
  const scroller = useRef<HTMLDivElement>(null);
  const liveUser = withoutEmDash(live?.user.trim() ?? '');
  const liveAssistant = withoutEmDash(live?.assistant.trim() ?? '');
  // Once the exchange is saved, the transcript above is the copy to show.
  const landed = live ? exchangeLanded(messages, live) : false;
  const responding = Boolean(live?.running && !liveAssistant && !landed);
  const status = live?.activity ?? (responding ? 'Thinking…' : null);

  // Pin to the real bottom of this pane. Bottom padding keeps the latest
  // lines above the overlay composer; older ones still scroll under it.
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const pin = (): void => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-6 pt-14 pb-32">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {messages.map((message, i) =>
          message.agent ? (
            <AgentTask key={`${message.at}-${i}`} message={message} />
          ) : (
            <Bubble
              key={`${message.at}-${i}`}
              role={message.role}
              text={withoutEmDash(message.text)}
              links={message.links}
              source={message.source}
              attachments={message.attachments}
              at={message.at}
            />
          ),
        )}
        {liveUser && !landed && <Bubble role="user" text={liveUser} attachments={live?.attachments} />}
        {!landed && (liveAssistant || (live?.links.length ?? 0) > 0) && (
          <Bubble role="assistant" text={liveAssistant} links={live?.links} streaming />
        )}
        {live?.call && !landed && <CallCard call={live.call} />}
        {status && (
          <p className="m-0 animate-pulse text-[13px] text-muted">{withoutEmDash(status)}</p>
        )}
        <Note tone="fail">{live?.error ? withoutEmDash(live.error) : null}</Note>
      </div>
    </div>
  );
}

/**
 * The "Started an agent task" line. Closed, it's that one line. Open, it's
 * Buddy's reasoning from the first step to the last, then the message Buddy
 * sent when the task ended.
 */
function AgentTask({ message }: { message: ChatMessage }): ReactElement {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const agent = message.agent!;
  const thought = agent.thought.trim();
  const said = agent.said?.trim() ?? '';
  // A task running in Buddy's browser can be watched from here.
  const browser = useBrowserStatus();
  const inBrowser = Boolean(agent.pending && browser?.active);

  useEffect(() => {
    if (open) body.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <div className="max-w-[85%] self-start text-[13px] leading-5 text-ink">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="-mx-1.5 flex w-full cursor-pointer items-start gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left text-[13px] leading-5 text-ink hover:bg-wash"
      >
        <Chevron open={open} />
        <span className="min-w-0">{withoutEmDash(message.text)}</span>
      </button>
      {inBrowser && (
        <span className="ml-5 mt-1 flex gap-1.5">
          <button
            type="button"
            onClick={() => buddy.sendBrowserCommand('expand')}
            className="cursor-pointer rounded-md border border-line bg-wash px-2.5 py-1 text-[12px] font-medium text-ink hover:border-faint"
          >
            {browser?.activity ? `Show browser · ${browser.activity}` : 'Show browser'}
          </button>
          <button
            type="button"
            onClick={() => buddy.sendBrowserCommand('stop')}
            className="cursor-pointer rounded-md border border-line bg-wash px-2.5 py-1 text-[12px] font-medium text-danger hover:border-danger"
          >
            Stop
          </button>
        </span>
      )}
      {open && (
        <div ref={body} className="mt-1.5 ml-5 flex flex-col gap-2.5 border-l border-line pl-3">
          {thought ? (
            <p className="m-0 whitespace-pre-wrap italic text-muted">{withoutEmDash(thought)}</p>
          ) : (
            agent.pending && <p className="m-0 italic text-muted">Thinking…</p>
          )}
          {said && (
            <div className={thought ? 'border-t border-line pt-2.5' : undefined}>
              <Markdown text={withoutEmDash(said)} onLink={(url) => void buddy.openExternal(url)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The color of each call state's dot. */
const CALL_DOTS: Record<CallStatus['state'], string> = {
  dialing: 'bg-faint animate-pulse',
  started: 'bg-ok animate-pulse',
  failed: 'bg-danger',
  ended: 'bg-faint',
};

/**
 * The phone call this turn is placing through Bland: who is being dialed
 * (the contact when known, else the number) and how it's going. Lives with
 * the turn — it clears when the reply lands.
 */
function CallCard({ call }: { call: CallStatus }): ReactElement {
  const { who, status } = callCardLines(call);
  return (
    <div className="flex items-center gap-3 self-start rounded-base border border-line bg-raised px-3.5 py-2.5 shadow-card">
      <Phone className="size-4 shrink-0 text-muted" strokeWidth={1.6} aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium leading-tight text-ink">{who}</span>
        <span className="flex items-center gap-1.5 text-[12px] leading-tight text-muted">
          <span className={`size-1.5 rounded-full ${CALL_DOTS[call.state]}`} aria-hidden />
          {status}
        </span>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={`mt-0.5 size-3.5 shrink-0 text-faint motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M6 3.5 11 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The in-progress reply. Words append in place and each new one fades into
 * focus; a finished message switches back to Markdown once it's stored.
 */
function StreamingMarkdown({ text }: { text: string }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (host.current) renderCaptionMarkdown(host.current, text, { animate: true, chat: true, link: messageLink });
  }, [text]);
  // contents: the words participate in the bubble's shrink-to-fit width the
  // same way Markdown's own spans do. A wrapping block would stretch to 85%.
  return <div ref={host} className="contents whitespace-pre-wrap" />;
}

function messageLink(url: string, label: string): HTMLElement {
  const link = document.createElement('a');
  link.href = url;
  link.className = 'cursor-pointer whitespace-normal text-link wrap-break-word';
  link.addEventListener('click', (event) => {
    event.preventDefault();
    void buddy.openExternal(url);
  });
  link.append(mountSiteIcon(linkHost(url), 'mr-1.5 align-middle'), label);
  return link;
}

function Bubble({
  role,
  text,
  links,
  source,
  attachments,
  at,
  streaming,
}: {
  role: ChatMessage['role'];
  text: string;
  links?: string[];
  /** Background work wrote this: the job or suggestion, tagged over the line. */
  source?: MessageSource;
  /** The files the user sent with this message. */
  attachments?: Attachment[];
  at?: number;
  /** The reply is still arriving: each new word fades into focus. */
  streaming?: boolean;
}): ReactElement {
  if (role === 'user') {
    return (
      <div className="flex max-w-[85%] flex-col items-end self-end">
        {attachments && attachments.length > 0 && <AttachmentChips attachments={attachments} />}
        <div className="whitespace-pre-wrap rounded-base bg-wash px-3.5 py-2 text-[13px] leading-5 wrap-break-word">
          <LinkText text={text} onLink={(url) => void buddy.openExternal(url)} />
        </div>
      </div>
    );
  }
  // Sources sit above the reply: they appear first while the searches run,
  // and staying put means the reply streams in beneath them instead of
  // shoving them around.
  return (
    <div className="max-w-[85%] self-start text-[13px] leading-5 text-ink">
      {source && <SourceTag source={source} at={at} />}
      {links && links.length > 0 && <SourceChips links={links} />}
      {text ? (
        streaming ? (
          <StreamingMarkdown text={text} />
        ) : (
          <Markdown text={text} onLink={(url) => void buddy.openExternal(url)} />
        )
      ) : null}
    </div>
  );
}

/** Which job, or which suggestion, wrote the line below, and when it ran. Its own row, so the report's first line keeps its height. */
function SourceTag({ source, at }: { source: MessageSource; at?: number }): ReactElement {
  const Icon = source.kind === 'job' ? Repeat : Sparkles;
  const when = at ? new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return (
    <span className="mb-1.5 flex w-fit max-w-full items-center gap-1.5 rounded-full bg-chip py-1 pl-2 pr-2.5 text-[11px] font-medium leading-4 text-muted shadow-button-secondary">
      <Icon className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="truncate text-ink">{withoutEmDash(source.name)}</span>
      {when && <span className="shrink-0 text-faint">· {when}</span>}
    </span>
  );
}

/**
 * The reply's sources, as the same chips the overlay and panel show. A
 * thorough search can surface dozens; past a handful the grid grows taller
 * than the answer, so the rest wait behind one more chip.
 * buildSourceChip is imperative DOM, so a ref hosts its output.
 */
function SourceChips({ links }: { links: string[] }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const shown = expanded ? links : links.slice(0, COLLAPSED_SOURCES);

  useEffect(() => {
    host.current?.replaceChildren(...shown.map((url) => buildSourceChip(buddy, url, linkHost(url))));
  }, [shown.join('\n')]);

  return (
    <div className="chat-sources">
      <div ref={host} className="contents" />
      {links.length > COLLAPSED_SOURCES && (
        <button type="button" className="source" onClick={() => setExpanded(!expanded)}>
          <span className="source-label">
            {expanded ? 'Show fewer' : `${links.length - COLLAPSED_SOURCES} more`}
          </span>
        </button>
      )}
    </div>
  );
}
