import { useEffect, useState, type ReactElement } from 'react';
import { keyWarningDisplay } from '../../../shared/key-warning';
import type { KeyProvider, OllamaStatus } from '../../../shared/types';
import { buddy } from '../../buddy';
import { ApiKeyRow, Button, Card, Note, SectionHeader, SiteIcon, Tabs, TextInput } from '../../ui';
import { useAccount } from '../../shared/account-data';
import { consumeProvidersTab } from '../provider-options';
import { useSettings } from '../context';

/** Each provider's site, doubling as the source of its favicon. */
const PROVIDERS: Array<{ id: KeyProvider; name: string; host: string }> = [
  { id: 'openrouter', name: 'OpenRouter', host: 'openrouter.ai' },
  { id: 'elevenlabs', name: 'ElevenLabs', host: 'elevenlabs.io' },
  { id: 'jev', name: 'TypeSafe (Jev)', host: 'typesafe.ai' },
];

const OLLAMA_DOWNLOAD = 'https://ollama.com/download';

/**
 * Open-weight Ollama models that ship as Buddy's suggestions, all good with
 * tools. Qwen's instruct tags, not the bare ones: those are the thinking
 * builds, which reason for hundreds of tokens before every reply and can't
 * be told not to. gpt-oss and Muse always reason; Buddy asks them for little.
 */
const RECOMMENDED = [
  {
    tag: 'qwen3-vl:30b-a3b-instruct',
    note: 'Most reliable with tools, and quick. ~20 GB. Needs 32 GB RAM.',
  },
  {
    tag: 'muse-glimmer:30b-mlx',
    note: 'Most capable, but slow to answer on a laptop. ~19 GB. Needs 32 GB RAM.',
  },
  {
    tag: 'gpt-oss:20b',
    note: "Quick and good with tools, but can't see your screen. ~14 GB. Needs 16 GB RAM.",
  },
  {
    tag: 'qwen3-vl:8b-instruct',
    note: 'Sees screen + tools. ~6 GB. Best with 16 GB RAM.',
  },
  {
    tag: 'qwen3-vl:4b-instruct',
    note: 'Lighter. ~3.5 GB. Good for 8 GB RAM.',
  },
];

const PROVIDER_TABS = [
  { id: 'cloud', label: 'Cloud' },
  { id: 'local', label: 'Local' },
] as const;
type ProviderTab = (typeof PROVIDER_TABS)[number]['id'];

export function ProvidersPage(): ReactElement {
  const [tab, setTab] = useState<ProviderTab>(consumeProvidersTab);
  useEffect(() => {
    let alive = true;
    buddy.onSettingsShowPage((next) => {
      if (!alive) return;
      const [page, nested] = next.split(':');
      if (page !== 'providers') return;
      setTab(nested === 'local' ? 'local' : 'cloud');
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <>
      <Tabs tabs={PROVIDER_TABS} active={tab} onSelect={setTab} />
      {tab === 'cloud' ? <CloudTab /> : <LocalTab />}
    </>
  );
}

/** The API key rows, one per cloud provider. */
function CloudTab(): ReactElement {
  const { view } = useSettings();
  const account = useAccount();
  const description = !account
    ? 'Keys live in the keychain.'
    : !account.configured
      ? 'This build runs on the keys you paste here. They live in the keychain.'
      : 'Optional. A key pasted here takes over for that provider and is billed by them. Keys live in the keychain.';
  return (
    <>
      <SectionHeader title="Use my own keys" description={description} />
      <Card>
        {PROVIDERS.map((provider, index) => (
          <div key={provider.id} className={index === 0 ? '' : 'border-t border-line pt-4'}>
            <ApiKeyRow
              name={provider.name}
              host={provider.host}
              saved={view.keys[provider.id]}
              error={keyWarningDisplay(view.settings, provider.id, view.settings.keyWarnings[provider.id])}
              onSave={(value) => buddy.setApiKey(provider.id, value)}
              onRemove={() => buddy.clearApiKey(provider.id)}
              onTest={() => buddy.testApiKey(provider.id)}
            />
          </div>
        ))}
      </Card>
      <SectionHeader
        title="Apps"
        description={
          account?.configured
            ? 'Buddy connects apps for you. Paste a key only to use your own Composio project.'
            : 'This build connects apps with your Composio key.'
        }
      />
      <Card>
        <ApiKeyRow
          name="Composio"
          host="composio.dev"
          saved={view.appKeys.composio}
          onSave={(value) => buddy.setAppSecret('composio', value)}
          onRemove={() => buddy.setAppSecret('composio', '')}
        />
      </Card>
      <SectionHeader
        title="Shopify Catalog"
        description="Structured product search across Shopify merchants. Paste the Dev Dashboard credential as client_id:client_secret."
      />
      <Card>
        <ApiKeyRow
          name="Shopify Catalog"
          host="shopify.com"
          saved={view.appKeys.shopify}
          onSave={(value) => buddy.setAppSecret('shopify', value)}
          onRemove={() => buddy.setAppSecret('shopify', '')}
        />
      </Card>
    </>
  );
}

/** The on-device brain: Ollama's models. The local ear lives under Ears. */
function LocalTab(): ReactElement {
  return (
    <>
      <SectionHeader title="On this Mac" description="Free after download. Pick the model under Brain, or as cloud fallback." />
      <Card>
        <LocalOllama />
      </Card>
    </>
  );
}

/**
 * The local brain's models: install Ollama, then download models here.
 * Which one Buddy thinks with is picked under Brain.
 */
function LocalOllama(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState<{ tone: 'ok' | 'fail'; text: string } | null>(null);
  const [custom, setCustom] = useState('');

  const refresh = (): void => void buddy.getOllamaStatus().then(setStatus);
  useEffect(() => {
    refresh();
    buddy.onOllamaPullProgress((progress) => setPercent(progress.percent));
  }, []);

  const pull = async (tag: string): Promise<void> => {
    setNote(null);
    setPercent(0);
    setPulling(tag);
    const result = await buddy.pullOllamaModel(tag);
    setPulling(null);
    setNote({ tone: result.ok ? 'ok' : 'fail', text: result.message });
    refresh();
    // A first download is obviously meant to be used; save the click.
    if (result.ok && !settings.ollamaModel) void patch({ ollamaModel: tag });
  };

  const title = (
    <div>
      <p className="m-0 flex items-center gap-2 text-[13px]">
        <SiteIcon host="ollama.com" />
        Ollama
      </p>
      <p className="m-0 text-[12px] text-muted">
        Local models via Ollama. Pick the active one under Brain.
      </p>
    </div>
  );

  if (!status) return <Note>Checking for Ollama…</Note>;

  if (!status.running) {
    const openDownload = (): void => void buddy.openExternal(OLLAMA_DOWNLOAD);
    const install = async (): Promise<void> => {
      setNote(null);
      setPulling('ollama');
      const result = await buddy.installOllama();
      setPulling(null);
      setNote({ tone: result.ok ? 'ok' : 'fail', text: result.message });
      // Without Homebrew there is nothing Buddy can do; hand over the installer.
      if (!result.ok && /Homebrew is not installed/.test(result.message)) openDownload();
      refresh();
    };
    return (
      <>
        <div>
          <p className="m-0 flex items-center gap-2 text-[13px]">
            <SiteIcon host="ollama.com" />
            Ollama isn't running
          </p>
          <p className="m-0 text-[12px] text-muted">
            Ollama runs open models on this Mac for free. Install it, start it, then download a model here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={openDownload}>
            Install Ollama
          </Button>
          <Button variant="secondary" disabled={pulling !== null} onClick={() => void install()}>
            {pulling ? 'Installing…' : 'Have Buddy install it'}
          </Button>
        </div>
        {note ? <Note tone={note.tone}>{note.text}</Note> : null}
      </>
    );
  }

  return (
    <>
      {title}
      {RECOMMENDED.map(({ tag, note: description }) => {
        const installed = status.models.includes(tag);
        return (
          <div key={tag} className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-[13px]">{tag}</p>
              <p className="m-0 text-[12px] text-muted">{description}</p>
            </div>
            {installed ? (
              <Note tone="ok">Installed</Note>
            ) : (
              <Button variant="secondary" disabled={pulling !== null} onClick={() => void pull(tag)}>
                {pulling === tag ? `${percent}%` : 'Download'}
              </Button>
            )}
          </div>
        );
      })}
      <div className="flex items-end gap-2 w-fit">
        <TextInput
          label="Any other Ollama model"
          value={custom}
          placeholder="e.g. gemma3:12b"
          onChange={(event) => setCustom(event.target.value.trim())}
          className="w-full"
        />
        <Button
          variant="secondary"
          disabled={!custom || pulling !== null}
          onClick={() => void pull(custom)}
        >
          {pulling === custom ? `${percent}%` : 'Download'}
        </Button>
      </div>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </>
  );
}


