import {
  Accessibility,
  AudioLines,
  BookOpen,
  Brain,
  Cable,
  CreditCard,
  Ear,
  Eye,
  Globe,
  KeyRound,
  Keyboard,
  LayoutGrid,
  MessageCircle,
  MousePointerClick,
  Palette,
  Phone,
  Plane,
  Repeat,
  Shield,
  ShoppingBag,
  Sparkles,
  User,
  Volume2,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { pagesWithKeyWarning } from '../../shared/key-warning';
import { buddy } from '../buddy';
import { useSettings } from './context';
import { PageHeader, Sidebar } from '../ui';
import { AccountPage } from './pages/AccountPage';
import { AirplanePage } from './pages/AirplanePage';
import { ProvidersPage } from './pages/ProvidersPage';
import { VoicePage } from './pages/VoicePage';
import { EarsPage } from './pages/EarsPage';
import { EyesPage } from './pages/EyesPage';
import { BrainPage } from './pages/BrainPage';
import { AgentPage } from './pages/AgentPage';
import { SummonPage } from './pages/SummonPage';
import { AppearancePage } from './pages/AppearancePage';
import { AccessibilityPage } from './pages/AccessibilityPage';
import { SoundEffectsPage } from './pages/SoundEffectsPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { SkillsPage } from './pages/SkillsTab';
import { BuyPage } from './pages/BuyPage';
import { ShoppingPage } from './pages/ShoppingPage';
import { BrowserPage } from './pages/BrowserPage';
import { PhonePage } from './pages/PhonePage';
import { JobsPage } from './pages/JobsPage';
import { SuggestionsPage } from './pages/SuggestionsPage';
import { MemoryPage } from './pages/MemoryPage';
import { TextsPage } from './pages/TextsPage';
import { IntegrationsPage, INTEGRATION_ROUTES } from './pages/IntegrationsPage';
import { McpServersPage } from './pages/HandsPage';

/** Account first, then senses, what Buddy can reach, and the Mac. Developer tools sit last. */
const PAGE_GROUPS = [
  {
    items: [{ id: 'account', label: 'Account' }],
  },
  {
    items: [
      { id: 'brain', label: 'Brain' },
      { id: 'voice', label: 'Voice' },
      { id: 'ears', label: 'Ears' },
      { id: 'eyes', label: 'Eyes' },
    ],
  },
  {
    items: [
      { id: 'integrations', label: 'Apps' },
      { id: 'shopping', label: 'Shopping' },
      { id: 'buy', label: 'Checkout Forms' },
      { id: 'browser', label: "Buddy's Browser" },
      { id: 'phone', label: "Buddy's Phone" },
      { id: 'jobs', label: 'Jobs' },
      { id: 'suggestions', label: 'Suggestions' },
      { id: 'memory', label: 'Memory' },
      { id: 'agent', label: 'Computer Use' },
      { id: 'texts', label: 'Text Buddy' },
      { id: 'skills', label: 'Skills' },
    ],
  },
  {
    items: [
      { id: 'permissions', label: 'Permissions' },
      { id: 'summon', label: 'Controls' },
      { id: 'appearance', label: 'Appearance' },
      { id: 'sounds', label: 'Sound effects' },
      { id: 'accessibility', label: 'Accessibility' },
      { id: 'airplane', label: 'Airplane Mode' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { id: 'providers', label: 'API keys' },
      { id: 'mcp', label: 'MCP servers' },
    ],
  },
] as const;

type PageEntry = (typeof PAGE_GROUPS)[number]['items'][number];
type PageId = PageEntry['id'];
const PAGES: PageEntry[] = PAGE_GROUPS.flatMap((group) => [...group.items]);

const PAGE = {
  brain: BrainPage,
  voice: VoicePage,
  ears: EarsPage,
  eyes: EyesPage,
  integrations: IntegrationsPage,
  shopping: ShoppingPage,
  buy: BuyPage,
  browser: BrowserPage,
  phone: PhonePage,
  jobs: JobsPage,
  suggestions: SuggestionsPage,
  memory: MemoryPage,
  agent: AgentPage,
  texts: TextsPage,
  skills: SkillsPage,
  account: AccountPage,
  providers: ProvidersPage,
  mcp: McpServersPage,
  permissions: PermissionsPage,
  summon: SummonPage,
  appearance: AppearancePage,
  sounds: SoundEffectsPage,
  accessibility: AccessibilityPage,
  airplane: AirplanePage,
} satisfies Record<PageId, () => ReactElement>;

const isPageId = (value: string): value is PageId => PAGES.some((item) => item.id === value);

const PAGE_ICONS: Record<PageId, LucideIcon> = {
  account: User,
  brain: Brain,
  voice: AudioLines,
  ears: Ear,
  eyes: Eye,
  integrations: LayoutGrid,
  shopping: ShoppingBag,
  buy: CreditCard,
  browser: Globe,
  phone: Phone,
  jobs: Repeat,
  suggestions: Sparkles,
  memory: BookOpen,
  agent: MousePointerClick,
  texts: MessageCircle,
  skills: Wand2,
  permissions: Shield,
  summon: Keyboard,
  appearance: Palette,
  sounds: Volume2,
  accessibility: Accessibility,
  airplane: Plane,
  providers: KeyRound,
  mcp: Cable,
};

/** Sidebar id, optionally with a tab (`providers:local`, `integrations:native`). */
function pageFromRoute(raw: string): PageId {
  const [id, nested] = raw.split(':');
  if (id && INTEGRATION_ROUTES.has(id)) return 'integrations';
  if (id === 'brain' && nested === 'skills') return 'skills';
  return id && isPageId(id) ? id : 'brain';
}

/** The main process can ask for a page: as a URL hash on open, or over IPC when already open. */
export function App(): ReactElement {
  const initial = window.location.hash.slice(1);
  const [page, setPage] = useState<PageId>(pageFromRoute(initial));
  const { view } = useSettings();
  // Sidebar dots for state worth noticing without opening the page: red on
  // Providers and every page whose active provider has a key warning, amber
  // on Airplane Mode while it silently reroutes every brain and ear to local
  // models; the answer to "why is qwen answering?".
  const indicators = new Map<PageId, 'warn' | 'danger'>();
  if (view.settings.airplaneMode) indicators.set('airplane', 'warn');
  for (const warned of pagesWithKeyWarning(view.settings)) indicators.set(warned, 'danger');
  const groups = PAGE_GROUPS.map((group) => ({
    label: 'label' in group ? group.label : undefined,
    items: group.items.map((item) => {
      const Icon = PAGE_ICONS[item.id];
      return {
        ...item,
        icon: <Icon className="size-4" strokeWidth={1.75} aria-hidden />,
        indicator: indicators.get(item.id),
      };
    }),
  }));

  useEffect(() => {
    buddy.onSettingsShowPage((next) => {
      // Keep the hash current so a page mounted by this jump can read its
      // nested tab (e.g. "integrations:native"), same as when the window opens fresh.
      window.location.hash = next;
      setPage(pageFromRoute(next));
    });
  }, []);
  const Current = PAGE[page];
  const label = PAGES.find((item) => item.id === page)?.label ?? page;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar groups={groups} active={page} onSelect={(id) => setPage(id as PageId)} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <PageHeader page={label} />
        <div className="px-6 pb-10 pt-5">
          <div className="max-w-2xl mx-auto">
            <Current key={page} />
          </div>
        </div>
      </main>
    </div>
  );
}
