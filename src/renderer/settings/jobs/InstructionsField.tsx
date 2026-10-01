// A job's instructions: plain words with inline cards for the apps and tools
// it uses. An empty field matches as you type; / does the same anywhere in
// the sentence. The pick lands as a card. A template's blanks are dashed cards: click one (or Tab)
// to pick it, and the first typed, pasted, or dictated words replace it.
// Hold the talk chord while the field has focus, or hold its mic button, and
// the words land at the caret.

import { Mic } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CONNECT_APPS } from '../../../shared/connect-apps';
import { chordLabel } from '../../../shared/hotkeys';
import { hasBlanks, refToken } from '../../../shared/instructions';
import { registrableDomain } from '../../../shared/link-text';
import { BUILTIN_TOOLS, SIGN_IN_SITES, mcpServerLabel } from '../../../shared/types';
import { buddy } from '../../buddy';
import { cn, Field, SiteIcon } from '../../ui';
import { subscribeDictation } from './dictation';
import { caretToEnd, chipNode, paint, serialize, type RefOption } from './instruction-chips';
import { getTalkState, subscribeTalk } from '../../shared/talk';
import { useSettings } from '../context';

/** Where the typed "/" sits, and what follows it so far. */
interface Slash {
  node: Text;
  start: number;
  end: number;
  query: string;
  /** The slash's box on screen, for placing the menu. */
  rect: DOMRect;
}

const GROUPS: Array<{ source: RefOption['source']; label: string }> = [
  { source: 'app', label: 'Apps' },
  { source: 'site', label: "Buddy's Browser" },
  { source: 'mcp', label: 'Connections' },
  { source: 'tool', label: 'On this Mac' },
];

/** Built-in tools a background run never has (see turn-tools.ts). */
const NOT_IN_JOBS = new Set(['media', 'coding']);

const MENU_WIDTH = 288;
const MENU_MAX_HEIGHT = 288;

export function InstructionsField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}): ReactElement {
  const editor = useRef<HTMLDivElement>(null);
  /** The last text this field reported, so its own edits are never repainted. */
  const emitted = useRef<string | null>(null);
  const focused = useRef(false);
  const holding = useRef(false);
  const options = useRefOptions();
  const [slash, setSlash] = useState<Slash | null>(null);
  const [active, setActive] = useState(0);
  const [heard, setHeard] = useState('');
  const { chord, listening } = useSyncExternalStore(subscribeTalk, getTalkState);

  // Paint text that arrived from outside: a template, or the job being edited.
  useLayoutEffect(() => {
    const el = editor.current;
    if (!el || value === emitted.current) return;
    paint(el, value, options);
    emitted.current = value;
  }, [value]);

  // The first paint may predate the connected list; redraw so each card gets its own icon.
  useEffect(() => {
    const el = editor.current;
    if (el && !focused.current) paint(el, serialize(el), options);
  }, [options]);

  const emit = (): void => {
    const el = editor.current;
    if (!el) return;
    const text = serialize(el);
    emitted.current = text;
    onChange(text);
  };

  const matches = slash ? filterOptions(options, slash.query) : [];

  /** Open, move, or close the menu from where the caret is now. */
  const readSlash = (): void => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !editor.current?.contains(node)) {
      setSlash(null);
      return;
    }
    const text = node as Text;
    const before = text.data.slice(0, selection.anchorOffset);
    const slashMatch = /(^|\s)\/([\w.-]*)$/.exec(before);
    // A field holding one word and nothing else: that word is the query, so
    // typing "ama" offers Amazon without a slash. Judged from the stored text,
    // not the DOM, which the browser may wrap in a div or pad with a <br>.
    // A sentence still needs /.
    const whole = serialize(editor.current).trim();
    const word = text.data.trim();
    const plain = !slashMatch && word.length > 0 && whole === word && /^[\w.-]+$/.test(word);
    if (!slashMatch && !plain) {
      setSlash(null);
      return;
    }
    const query = (slashMatch ? slashMatch[2]! : word).toLowerCase();
    if (plain && filterOptions(options, query).length === 0) {
      setSlash(null);
      return;
    }
    const start = slashMatch ? selection.anchorOffset - slashMatch[2]!.length - 1 : text.data.indexOf(word);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    if (query !== slash?.query) setActive(0);
    setSlash({
      node: text,
      start,
      end: plain ? start + word.length : selection.anchorOffset,
      query,
      rect: range.getBoundingClientRect(),
    });
  };

  const pick = (option: RefOption): void => {
    if (!slash) return;
    const range = document.createRange();
    range.setStart(slash.node, slash.start);
    range.setEnd(slash.node, slash.end);
    range.deleteContents();
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.insertNode(
      chipNode(
        { kind: 'ref', source: option.source, id: option.id, label: option.label, raw: refToken(option.source, option.id, option.label) },
        options,
      ),
    );
    placeCaret(space, 1);
    setSlash(null);
    emit();
  };

  /** The blank picked by a click or Tab: it shows as picked and stays until words arrive. */
  const armed = useRef<HTMLElement | null>(null);

  const disarm = (): void => {
    delete armed.current?.dataset.armed;
    armed.current = null;
  };

  const arm = (blank: HTMLElement): void => {
    disarm();
    blank.dataset.armed = '';
    armed.current = blank;
    const range = document.createRange();
    range.setStartAfter(blank);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /**
   * Words are arriving: the picked blank goes and the caret takes its place,
   * so the insertion that follows lands there. False when nothing was picked.
   */
  const fillArmed = (): boolean => {
    const blank = armed.current;
    armed.current = null;
    if (!blank?.isConnected) return false;
    const range = document.createRange();
    range.selectNode(blank);
    range.deleteContents();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  };

  /** Tab walks the blanks in reading order, from the one picked now. */
  const armNext = (): boolean => {
    const blanks = [...(editor.current?.querySelectorAll<HTMLElement>('[data-blank]') ?? [])];
    if (blanks.length === 0) return false;
    const at = armed.current ? blanks.indexOf(armed.current) : -1;
    arm(blanks[(at + 1) % blanks.length]!);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (slash) {
      if (event.key === 'Escape') {
        // Close the menu, not the dialog around the field.
        event.preventDefault();
        event.stopPropagation();
        setSlash(null);
        return;
      }
      if (matches.length > 0) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setActive((current) => (current + step + matches.length) % matches.length);
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          pick(matches[Math.min(active, matches.length - 1)]!);
          return;
        }
      }
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      if (armNext()) event.preventDefault();
      return;
    }
    if (!armed.current) return;
    // A printable key is the user's words: the blank makes way before the character lands.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      fillArmed();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key !== 'Shift' && event.key !== 'Alt') disarm();
  };

  // Dictation lands at the caret: live words show under the field, the final text goes in.
  useEffect(
    () =>
      subscribeDictation(({ kind, text }) => {
        const el = editor.current;
        if (!el || (!focused.current && !holding.current)) return;
        if (kind === 'partial') {
          setHeard(text);
          return;
        }
        setHeard('');
        if (!text.trim()) return;
        el.focus();
        const selection = window.getSelection();
        if (!fillArmed() && (!selection?.anchorNode || !el.contains(selection.anchorNode))) caretToEnd(el);
        const before = serialize(el);
        const spaced = before && !/\s$/.test(before) ? ` ${text.trim()}` : text.trim();
        // insertText keeps the edit on the undo stack and fires input, which emits.
        if (!document.execCommand('insertText', false, spaced)) {
          el.append(document.createTextNode(spaced));
          emit();
        }
      }),
    [],
  );

  useEffect(() => () => buddy.setDictationField(false), []);

  const startHold = (): void => {
    const el = editor.current;
    if (el && document.activeElement !== el) {
      el.focus();
      caretToEnd(el);
    }
    holding.current = true;
    buddy.holdDictation(true);
  };
  const endHold = (): void => {
    if (!holding.current) return;
    holding.current = false;
    buddy.holdDictation(false);
  };

  const talk = chord ? chordLabel(chord) : '';
  const hint =
    listening && heard
      ? heard
      : listening
        ? 'Listening…'
        : value.trim()
          ? `Type / for apps, sites, and tools${hasBlanks(value) ? ' · Tab to the next blank' : ''}`
          : 'Type to match apps, sites, and tools';

  return (
    <Field label={label}>
      <div className="rounded-xs border border-line-soft bg-well shadow-input focus-within:border-focus">
        <div
          ref={editor}
          role="textbox"
          aria-multiline
          aria-label="Instructions"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck
          data-placeholder={placeholder}
          onInput={() => {
            emit();
            readSlash();
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') readSlash();
          }}
          onClick={(event) => {
            const blank = (event.target as HTMLElement).closest<HTMLElement>('[data-blank]');
            if (blank) {
              arm(blank);
              return;
            }
            disarm();
            readSlash();
          }}
          onPaste={() => {
            fillArmed();
          }}
          onFocus={() => {
            focused.current = true;
            buddy.setDictationField(true);
          }}
          onBlur={() => {
            focused.current = false;
            disarm();
            setSlash(null);
            buddy.setDictationField(false);
          }}
          className="editable-field min-h-28 max-h-72 overflow-y-auto px-3 py-2.5 text-[13px] leading-6 whitespace-pre-wrap wrap-break-word text-ink outline-none"
        />
        <div className="flex items-center gap-3 border-t border-line-soft px-3 py-1.5">
          <span className={cn('min-w-0 flex-1 truncate text-[11px]', listening && heard ? 'text-ink' : 'text-faint')}>
            {hint}
          </span>
          <button
            type="button"
            title={talk ? `Hold to talk, or hold ${talk} while typing here` : 'Hold to talk'}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              startHold();
            }}
            onPointerUp={endHold}
            onPointerCancel={endHold}
            className={cn(
              'flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 px-1.5 text-[11px] font-medium',
              listening && holding.current ? 'bg-ink text-on-ink' : 'bg-transparent text-muted hover:bg-wash hover:text-ink',
            )}
          >
            <Mic className="size-3.5" strokeWidth={1.75} aria-hidden />
            Hold to talk
          </button>
        </div>
      </div>
      {slash
        ? createPortal(
            <SlashMenu rect={slash.rect} options={matches} active={active} query={slash.query} onPick={pick} onHover={setActive} />,
            document.body,
          )
        : null}
    </Field>
  );
}

function SlashMenu({
  rect,
  options,
  active,
  query,
  onPick,
  onHover,
}: {
  rect: DOMRect;
  options: RefOption[];
  active: number;
  query: string;
  onPick: (option: RefOption) => void;
  onHover: (index: number) => void;
}): ReactElement {
  const below = window.innerHeight - rect.bottom > MENU_MAX_HEIGHT + 12;
  const left = Math.max(8, Math.min(rect.left - 6, window.innerWidth - MENU_WIDTH - 8));
  return (
    <div
      role="listbox"
      // The field keeps focus (and its caret) while the menu is clicked.
      onMouseDown={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        zIndex: 90,
        left,
        width: MENU_WIDTH,
        maxHeight: MENU_MAX_HEIGHT,
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      }}
      className="app-no-drag overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-card"
    >
      {options.length === 0 ? (
        <p className="m-0 px-3 py-2 text-[12px] leading-4 text-muted">
          {query ? `Nothing connected matches “${query}”.` : 'Nothing is connected yet. Add apps under Settings → Apps.'}
        </p>
      ) : (
        GROUPS.map((group) => {
          const rows = options.filter((option) => option.source === group.source);
          if (rows.length === 0) return null;
          return (
            <div key={group.source}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-faint">{group.label}</div>
              {rows.map((option) => {
                const index = options.indexOf(option);
                return (
                  <button
                    key={`${option.source}:${option.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(option)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 border-0 px-3 py-1.5 text-left',
                      index === active ? 'bg-wash' : 'bg-transparent',
                    )}
                  >
                    <SiteIcon host={option.host} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] leading-5 text-ink">{option.label}</span>
                      <span className="truncate text-[11px] leading-4 text-muted">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}

/** In group order, so arrow keys walk the list the way it reads. */
function filterOptions(options: RefOption[], query: string): RefOption[] {
  const found = query
    ? options.filter((option) => option.label.toLowerCase().includes(query) || option.id.toLowerCase().includes(query))
    : options;
  return GROUPS.flatMap((group) => found.filter((option) => option.source === group.source));
}

function placeCaret(node: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** What the slash menu offers: connected apps, Buddy's Browser sites, MCP servers, and the Mac tools a job can use. */
function useRefOptions(): RefOption[] {
  const disabled = useSettings().view.settings.disabledBuiltinTools;
  const [remote, setRemote] = useState<RefOption[]>([]);
  const [signedIn, setSignedIn] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      buddy.listAppConnections().catch(() => []),
      buddy.getMcpServers().catch(() => []),
      buddy.listSignedInSites().catch(() => [] as string[]),
    ]).then(([apps, servers, hosts]) => {
      if (!alive) return;
      setSignedIn(hosts);
      setRemote([
        ...(apps ?? []).flatMap((connection): RefOption[] => {
          const app = CONNECT_APPS.find((entry) => entry.slug === connection.slug);
          return connection.status === 'active' && app
            ? [{ source: 'app', id: app.slug, label: app.label, host: app.host, description: app.blurb }]
            : [];
        }),
        ...servers
          .filter((server) => server.enabled && server.status === 'connected')
          .map((server): RefOption => ({
            source: 'mcp',
            id: server.name,
            label: mcpServerLabel(server),
            host: serverHost(server.url, server.name),
            description: server.tools.map((tool) => tool.name).join(', ') || 'Connected',
          })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => {
    const off = new Set(disabled ?? []);
    const signed = new Set(signedIn);
    const sites = [...SIGN_IN_SITES]
      .toSorted((a, b) => {
        const aIn = signed.has(a.host);
        const bIn = signed.has(b.host);
        if (aIn !== bIn) return aIn ? -1 : 1;
        return SIGN_IN_SITES.indexOf(a) - SIGN_IN_SITES.indexOf(b);
      })
      .map(
        (site): RefOption => ({
          source: 'site',
          id: site.host,
          label: site.label,
          host: site.host,
          description: signed.has(site.host) ? 'Signed in' : site.host,
        }),
      );
    return [
      ...remote,
      ...sites,
      ...BUILTIN_TOOLS.filter((tool) => !NOT_IN_JOBS.has(tool.id) && !off.has(tool.id)).map(
        (tool): RefOption => ({ source: 'tool', id: tool.id, label: tool.label, host: 'apple.com', description: tool.description }),
      ),
    ];
  }, [remote, signedIn, disabled]);
}

/** The server's own site, not its API host: api.bland.ai has no icon, bland.ai does. */
function serverHost(url: string, name: string): string {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return name;
  }
}
