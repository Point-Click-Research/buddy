// New Chat's composer sitting in a tray whose lip suggests the next piece of
// setup: connecting apps, texting Buddy, Computer Use, a card for checkout.
// Only what is still undone is offered, one slide at a time, cycling every
// few seconds and holding while the pointer is on it. Closing the lip folds
// it away for this visit; the next New Chat brings it back. With everything
// set up there is no lip at all.

import { CreditCard, MessageCircle, MousePointerClick, X } from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { CONNECT_APPS } from '../../shared/connect-apps';
import { buddy } from '../buddy';
import { useAppConnections } from '../shared/account-data';
import { SiteIcon } from '../ui';
import { useSettingsView } from './settings-data';

/** Logos on the lip; enough to read as "your apps", not a catalog. */
const SHOWN = 6;
const CYCLE_MS = 6_000;

interface Slide {
  id: string;
  text: string;
  /** The Settings page that does it. */
  page: string;
  art: ReactNode;
}

export function ComposerTray({ children }: { children: ReactNode }): ReactElement {
  const slides = useSlides();
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  /** The slide on its way out, drawn over the incoming one until its exit ends. */
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const slide = slides.length > 0 ? slides[index % slides.length] : null;
  const slideId = slide?.id ?? null;

  useEffect(() => {
    if (slides.length < 2 || hovered || dismissed) return;
    const timer = setTimeout(() => {
      setLeavingId(slideId);
      setIndex(index + 1);
    }, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [index, slideId, slides.length, hovered, dismissed]);

  if (!slide) return <>{children}</>;
  const leaving = slides.find((candidate) => candidate.id === leavingId && candidate.id !== slide.id);

  return (
    <div className="overflow-visible rounded-base border border-line bg-wash">
      {/* The composer's own border would double the tray's at the edges. */}
      <div className="-m-px">{children}</div>
      <div className={`tray-lip${dismissed ? ' tray-lip-closed' : ''}`} inert={dismissed}>
        <div
          className="flex items-center gap-2 overflow-hidden py-1.5 pl-1.5 pr-2"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className="grid min-w-0 flex-1">
            {leaving ? (
              <SlideButton
                key={`out-${leaving.id}`}
                slide={leaving}
                motion="tray-slide-out"
                onDone={() => setLeavingId(null)}
              />
            ) : null}
            <SlideButton key={slide.id} slide={slide} motion="tray-slide-in" />
          </div>
          <button
            type="button"
            aria-label="Hide setup suggestions"
            onClick={() => setDismissed(true)}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-faint transition-colors duration-150 hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** One suggestion. Incoming and outgoing slides share a grid cell, so the swap is one motion. */
function SlideButton({
  slide,
  motion,
  onDone,
}: {
  slide: Slide;
  motion: 'tray-slide-in' | 'tray-slide-out';
  onDone?: () => void;
}): ReactElement {
  const leaving = motion === 'tray-slide-out';
  return (
    <button
      type="button"
      tabIndex={leaving ? -1 : undefined}
      aria-hidden={leaving || undefined}
      onClick={() => buddy.openSettingsWindow(slide.page)}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onDone?.();
      }}
      className={`${motion} flex min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent px-2 py-1 text-left [grid-area:1/1]`}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted">{slide.text}</span>
      <span className="tray-art flex shrink-0 items-center gap-2 text-faint">{slide.art}</span>
    </button>
  );
}

/** The setup still undone, in the order it is offered. Empty until the data has landed. */
function useSlides(): Slide[] {
  const connections = useAppConnections();
  const view = useSettingsView();
  if (connections === null || view === null) return [];
  const linked = new Set(connections.filter((c) => c.status === 'active').map((c) => c.slug));
  const unlinked = CONNECT_APPS.filter((app) => !linked.has(app.slug));
  const slides: Slide[] = [];
  if (unlinked.length > 0) {
    slides.push({
      id: 'apps',
      text: 'Make Buddy more capable with your apps',
      page: 'apps',
      art: unlinked.slice(0, SHOWN).map((app) => <SiteIcon key={app.slug} host={app.host} />),
    });
  }
  if (!view.settings.textBridgeEnabled) {
    slides.push({
      id: 'texts',
      text: 'Text Buddy from your phone over iMessage',
      page: 'texts',
      art: <MessageCircle className="size-4" strokeWidth={1.75} />,
    });
  }
  if (!view.settings.agentModeEnabled) {
    slides.push({
      id: 'agent',
      text: 'Let Buddy use your Mac for you',
      page: 'agent',
      art: <MousePointerClick className="size-4" strokeWidth={1.75} />,
    });
  }
  if (!view.appKeys.card) {
    slides.push({
      id: 'card',
      text: 'Save a card so Buddy can buy things for you',
      page: 'buy',
      art: <CreditCard className="size-4" strokeWidth={1.75} />,
    });
  }
  return slides;
}
