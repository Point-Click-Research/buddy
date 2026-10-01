// Suggestions on New Chat: a short, quiet list in the space above the
// composer, one line per idea from the morning run. A row shows
// its actions only when the pointer or keyboard is on it. No thanks
// dismisses it, Adjust drops the prompt into the composer to rewrite, and the
// main action either runs it now (a fresh conversation, streamed like any
// ask) or installs a recurring one as a job. Whether they come at all is
// under Settings → Suggestions.

import { Repeat, X } from 'lucide-react';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { CONNECT_APPS, type ConnectApp } from '../../shared/connect-apps';
import { scheduleLabel, type Idea, type IdeaProduct } from '../../shared/jobs';
import { IDEAS_COUNT } from '../../shared/types';
import { linkHost } from '../../shared/link-text';
import { USE_CASES } from '../../shared/use-cases';
import { buddy } from '../buddy';
import { useIdeasView } from '../shared/jobs-data';
import { withoutEmDash } from '../shared/markdown';
import { USE_CASE_ICONS } from '../shared/use-case-icons';
import { Button, LinkButton, Modal, SiteIcon, TableFrame } from '../ui';
import { useSettingsView } from './settings-data';

/** What every row's buttons do. */
export interface IdeaHandlers {
  /** Put this prompt in the composer on New Chat, to rewrite before sending. */
  onAdjust: (prompt: string) => void;
  /** Send this prompt now, in a fresh conversation. */
  onRun: (prompt: string) => void;
}

/** Rows shown before "Show more": a full default batch. More than that folds. */
const VISIBLE = IDEAS_COUNT.natural;

/** A row of the panel, split from the one above by a hairline like a settings table row. */
const ROW = 'border-line not-first:border-t';

/** Placeholder rows while the first batch is found, shaped like the real ones. */
const BONES = [48, 36, 40].map((width) => (
  <li key={width} className={`${ROW} flex items-center gap-3 px-3 py-2.5`} aria-hidden>
    <span className="skeleton size-8 shrink-0 rounded-[6px]" />
    <span className="flex flex-col gap-1.5">
      <span className="skeleton h-3" style={{ width: width * 4 }} />
      <span className="skeleton h-2.5" style={{ width: width * 3 }} />
    </span>
  </li>
));

/** A moment Buddy noticed comes first; then use-case order, so like sits next to like; jobs after the one-offs. */
const ORDER = USE_CASES.map((useCase) => useCase.id);
const rank = (idea: Idea): number =>
  idea.moment ? -1 : (idea.schedule ? ORDER.length : 0) + ORDER.indexOf(idea.kind);

/** Whether the list shows at all: suggestions are on, and there are rows or a run finding them. */
export function useHasIdeas(): boolean {
  const view = useIdeasView();
  const enabled = useSettingsView()?.settings.ideasEnabled ?? false;
  return enabled && ((view?.ideas.length ?? 0) > 0 || (view?.running ?? false));
}

/** Today's batch, when suggestions are on. A run in flight keeps the previous rows, faded, until the new ones land. */
export function TodaysIdeas(handlers: IdeaHandlers): ReactElement | null {
  const view = useIdeasView();
  const ideas = view?.ideas ?? [];
  const running = view?.running ?? false;
  const hasIdeas = useHasIdeas();
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!hasIdeas) return null;
  const sorted = ideas.toSorted((a, b) => rank(a) - rank(b));
  const shown = expanded ? sorted : sorted.slice(0, VISIBLE);
  const hidden = sorted.length - shown.length;
  // Yesterday's rows stay up while the new batch is found, but they must not
  // read as today's, and they can't be acted on until the run finishes.
  const pending = running && ideas.length > 0;
  const opened = ideas.find((idea) => idea.id === openId) ?? null;
  return (
    <>
      <section
        aria-label="Suggestions"
        aria-busy={running || undefined}
        className={`ideas w-full${pending ? ' ideas-pending' : ''}`}
      >
        <TableFrame
          header={
            <h2 className="m-0 flex-1 text-center text-[13px] font-medium text-ink">
              {suggestionsHeading(running, view?.checkedAt ?? 0)}
            </h2>
          }
        >
          {/* Rounded to the panel's inner corner so a hovered first or last row stays inside it. */}
          <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[11px] p-0">
            {ideas.length === 0
              ? BONES
              : shown.map((idea, index) => (
                  <SuggestionRow
                    key={idea.id}
                    idea={idea}
                    index={index}
                    onOpen={() => setOpenId(idea.id)}
                    {...handlers}
                  />
                ))}
            {hidden > 0 && !running ? (
              <li className={ROW}>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="w-full cursor-pointer border-0 bg-transparent py-2.5 text-[12px] font-medium text-muted transition-colors duration-200 ease-out hover:bg-row-hover hover:text-ink"
                >
                  Show {hidden} more
                </button>
              </li>
            ) : null}
          </ul>
        </TableFrame>
      </section>
      {opened ? <SuggestionDetail idea={opened} onClose={() => setOpenId(null)} {...handlers} /> : null}
    </>
  );
}

/** "For today" only once this calendar day's run has landed. */
function suggestionsHeading(running: boolean, checkedAt: number): string {
  if (running) return 'Finding suggestions';
  const today = checkedAt > 0 && new Date(checkedAt).toDateString() === new Date().toDateString();
  return today ? 'Suggestions for today' : 'Previous suggestions';
}

/** One idea on one line. The text opens the full explanation; the actions slide in on hover. */
function SuggestionRow({
  idea,
  index,
  onOpen,
  onAdjust,
  onRun,
}: IdeaHandlers & { idea: Idea; index: number; onOpen: () => void }): ReactElement {
  const title = withoutEmDash(idea.title);
  return (
    <li
      className={`${ROW} idea-in group flex items-center gap-3 transition-colors duration-200 ease-out hover:bg-row-hover focus-within:bg-row-hover`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 self-stretch border-0 bg-transparent py-2.5 pl-3 text-left"
      >
        <Mark idea={idea} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5 text-ink">{title}</span>
          <span className="block truncate text-[12px] leading-4 text-muted">{detail(idea)}</span>
        </span>
      </button>
      <div className="pointer-events-none mr-3 flex shrink-0 translate-x-1 overflow-hidden rounded-[6px] border border-line bg-chip opacity-0 transition-[opacity,translate] duration-200 ease-out group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100">
        <QuickAction onClick={() => onAdjust(withoutEmDash(idea.prompt))}>Adjust</QuickAction>
        <QuickAction onClick={() => accept(idea, onRun)}>
          {idea.schedule ? <Repeat className="size-3.5" strokeWidth={1.6} aria-hidden /> : null}
          {yesLabel(idea)}
        </QuickAction>
        <QuickAction aria-label={`No thanks: ${title}`} title="No thanks" onClick={() => void buddy.dismissIdea(idea.id)}>
          <X className="size-3.5" strokeWidth={1.75} />
        </QuickAction>
      </div>
    </li>
  );
}

/** One segment of the row's action bar: same height, type, and hover as its neighbors, split by a hairline. */
function QuickAction({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      className={`flex h-7 cursor-pointer items-center gap-1.5 border-l border-line bg-transparent px-2.5 text-[12px] font-medium text-ink transition-colors duration-150 first:border-l-0 hover:bg-chip-hover ${className ?? ''}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** The explanation the row cuts off, with the same actions as the hover. */
function SuggestionDetail({
  idea,
  onClose,
  onAdjust,
  onRun,
}: IdeaHandlers & { idea: Idea; onClose: () => void }): ReactElement {
  const title = withoutEmDash(idea.title);
  const blurb = withoutEmDash(idea.blurb);
  const prompt = withoutEmDash(idea.prompt);
  const meta = detail(idea);
  return (
    <Modal
      title={title}
      subtitle={meta !== blurb ? meta : undefined}
      mark={<Mark idea={idea} />}
      onClose={onClose}
      footer={
        <>
          <LinkButton className="mr-auto text-[13px]" tone="danger" onClick={() => void buddy.dismissIdea(idea.id)}>
            No thanks
          </LinkButton>
          <Button
            variant="secondary"
            onClick={() => {
              onAdjust(prompt);
              onClose();
            }}
          >
            Adjust
          </Button>
          <Button
            className="inline-flex items-center gap-1.5"
            onClick={() => {
              accept(idea, onRun);
              onClose();
            }}
          >
            {idea.schedule ? <Repeat className="size-3.5" strokeWidth={1.6} aria-hidden /> : null}
            {yesLabel(idea)}
          </Button>
        </>
      }
    >
      <p className="m-0 text-[13px] leading-5">{blurb}</p>
      {prompt && prompt !== blurb ? (
        <p className="m-0 text-[13px] leading-5 text-muted">
          <span className="font-medium text-ink">What Buddy will do: </span>
          {prompt}
        </p>
      ) : null}
    </Modal>
  );
}

function accept(idea: Idea, onRun: (prompt: string) => void): void {
  if (idea.schedule) {
    void buddy.installIdea(idea.id);
    return;
  }
  void buddy.dismissIdea(idea.id, 'yes');
  onRun(withoutEmDash(idea.prompt));
}

function yesLabel(idea: Idea): string {
  if (idea.schedule) return 'Create job';
  return idea.kind === 'discover' && idea.product ? 'Show me' : 'Do it';
}

/** The quiet second line: price and seller for a pick, how often for a job, otherwise why now. */
function detail(idea: Idea): string {
  const blurb = withoutEmDash(idea.blurb);
  const product = idea.product;
  if (product?.price) return `${product.price} · ${product.seller || linkHost(product.url)}`;
  if (idea.schedule) return `${scheduleLabel(idea.schedule)} · ${blurb}`;
  return blurb;
}

/** How many app marks fit on a suggestion before the rest fold into +N. */
const APP_MARKS = 3;

/** A small square: the pick's photo, else the apps it uses, else what kind of ask it is. */
function Mark({ idea }: { idea: Idea }): ReactElement {
  const photo = useProductPhoto(idea.product);
  const apps = ideaApps(idea);
  const Icon = idea.schedule ? Repeat : USE_CASE_ICONS[idea.kind];
  if (!photo && apps.length > 1) return <AppStack apps={apps} />;
  const app = apps[0];
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-chip text-muted shadow-button-secondary">
      {photo ? (
        <img src={photo} alt="" draggable={false} className="size-full object-contain p-0.5 mix-blend-multiply dark:mix-blend-normal" />
      ) : photo === undefined ? null : app ? (
        <SiteIcon host={app.host} className="size-5" />
      ) : (
        <Icon className="size-4" strokeWidth={1.6} aria-hidden />
      )}
    </span>
  );
}

/** Overlapping app marks when one suggestion uses more than one app. */
function AppStack({ apps }: { apps: ConnectApp[] }): ReactElement {
  const shown = apps.slice(0, APP_MARKS);
  const extra = apps.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      {shown.map((app, index) => (
        <span
          key={app.slug}
          className={`relative flex size-6 items-center justify-center rounded-full bg-chip shadow-button-secondary${index > 0 ? ' -ml-2' : ''}`}
          style={{ zIndex: index + 1 }}
        >
          <SiteIcon host={app.host} className="size-3.5" />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="relative -ml-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-chip px-1 text-[10px] tabular-nums text-muted shadow-button-secondary"
          style={{ zIndex: shown.length + 1 }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The product's photo as a data URL, fetched by main: the window's CSP blocks
 * remote images and stores refuse hotlinks. Undefined while loading; null
 * when the store would not serve it, or there is no photo to fetch.
 */
function useProductPhoto(product: IdeaProduct | undefined): string | null | undefined {
  const image = product?.image;
  const url = product?.url;
  const [photo, setPhoto] = useState<string | null | undefined>(image && url ? undefined : null);
  useEffect(() => {
    if (!image || !url) {
      setPhoto(null);
      return;
    }
    setPhoto(undefined);
    let alive = true;
    void buddy.getProductPhoto(image, url).then((data) => {
      if (alive) setPhoto(data);
    });
    return () => {
      alive = false;
    };
  }, [image, url]);
  return photo;
}

const APP_REF = /\(app:([\w.-]+)\)/g;

/** Longest names first, so "Google Calendar" is taken before a shorter label inside it. */
const APPS_BY_NAME = CONNECT_APPS.toSorted((a, b) => b.label.length - a.label.length);

/**
 * Every connected app this idea acts through. Explicit slugs come first, then
 * an app named in the words. An inbox idea with none named wears the Gmail mark.
 */
function ideaApps(idea: Idea): ConnectApp[] {
  const slugs: string[] = [];
  const add = (slug: string): void => {
    const clean = slug.trim();
    if (!clean || slugs.includes(clean) || !CONNECT_APPS.some((entry) => entry.slug === clean)) return;
    slugs.push(clean);
  };
  idea.app?.split(/[,\s]+/).forEach(add);
  const text = `${idea.title}\n${idea.blurb}\n${idea.prompt}`;
  APP_REF.lastIndex = 0;
  for (const match of text.matchAll(APP_REF)) add(match[1] ?? '');
  let rest = text;
  for (const app of APPS_BY_NAME) {
    const pattern = new RegExp(`\\b${app.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (!pattern.test(rest)) continue;
    add(app.slug);
    rest = rest.replace(pattern, ' ');
  }
  if (slugs.length === 0 && idea.kind === 'email') add('gmail');
  return slugs.flatMap((slug) => {
    const app = CONNECT_APPS.find((entry) => entry.slug === slug);
    return app ? [app] : [];
  });
}
