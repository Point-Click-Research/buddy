import { useEffect, useState, type ReactElement } from 'react';
import { BRAIN_EFFORTS, BRAIN_PROVIDERS, type BrainEffort, type BrainProvider, type OllamaStatus } from '../../../shared/types';
import { buddy } from '../../buddy';
import { Card, MenuSelect, Note, SectionHeader, TabbedView } from '../../ui';
import { useSettings } from '../context';
import { ModelField } from '../ModelField';
import { useAccount } from '../../shared/account-data';
import { keyedOption, openProviders } from '../provider-options';
import { cloudModelsForPlan, modelsForPicker } from '../../../shared/plan-models';
import { providerAccess } from '../../../shared/provider-access';
import { planLabel } from '../../shared/account-text';

/**
 * The brain: every cloud model through OpenRouter, or the local Ollama model
 * by choice. Thinking, fast, and agent models each pick from the same list.
 * What Buddy knows lives on the Memory page.
 */
export function BrainPage(): ReactElement {
  const { view, patch } = useSettings();
  const account = useAccount();
  const { settings } = view;
  const isLocal = settings.brainProvider === 'ollama';
  const brainAccess = isLocal ? 'ready' : providerAccess(account, view.keys.openrouter, 'openrouter');
  const allowed = modelsForPicker(account, view.keys.openrouter);
  const lockedDetail = account && allowed.length > 0 ? `Not on ${planLabel(account)}` : undefined;

  // Ollama's models are its own. OpenRouter's starters are only kept when this
  // plan includes them; otherwise the fast model, which every plan has.
  const switchProvider = (next: BrainProvider): void => {
    const starter = BRAIN_PROVIDERS[next];
    const fitted =
      next === 'openrouter'
        ? cloudModelsForPlan(starter.model, starter.fastModel, allowed)
        : { brainModel: starter.model, brainFastModel: starter.fastModel };
    void patch({ brainProvider: next, ...fitted });
  };

  const thinkHard = (
    <>
      <SectionHeader
        title="Think hard model"
        description="For harder questions and walkthroughs. Use a more powerful model."
      />
      <Card>
        <MenuSelect
          label="Provider"
          subtitle="OpenRouter reaches every cloud model. Ollama runs on this Mac."
          value={settings.brainProvider}
          onSelect={switchProvider}
          onDisabledPick={openProviders}
          options={[
            keyedOption(account, view.keys, 'openrouter', BRAIN_PROVIDERS.openrouter.label),
            { value: 'ollama', label: BRAIN_PROVIDERS.ollama.label, detail: 'Free' },
          ]}
        />
        {brainAccess === 'add' && (
          <Note tone="warn">No OpenRouter key yet. Add one under API keys, or use a local model.</Note>
        )}
        {isLocal ? (
          <>
            <LocalBrain />
            <Note>Local model is Q&A only. Drawing and agent need cloud.</Note>
          </>
        ) : (
          <>
            <ModelField
              provider="openrouter"
              value={settings.brainModel}
              placeholder={BRAIN_PROVIDERS.openrouter.model}
              allowed={allowed}
              lockedDetail={lockedDetail}
              onChange={(brainModel) => void patch({ brainModel })}
            />
            <EffortField
              value={settings.brainEffort}
              subtitle="Thinking depth. Auto: low for talk, medium for walkthroughs."
              onSelect={(brainEffort) => void patch({ brainEffort })}
            />
          </>
        )}
      </Card>
    </>
  );

  const thinkFast = (
    <>
      <SectionHeader
        title="Think fast model"
        description="For quick Q&A and casual conversations. Use a cheaper model."
      />
      <Card>
        <ModelField
          provider="openrouter"
          value={settings.brainFastModel}
          placeholder={BRAIN_PROVIDERS.openrouter.fastModel}
          emptyLabel="Use think hard model"
          allowed={allowed}
          lockedDetail={lockedDetail}
          onChange={(brainFastModel) => void patch({ brainFastModel })}
        />
      </Card>
    </>
  );

  const agent = (
    <>
      <SectionHeader
        title="Agent model"
        description="For when buddy is controlling your computer to do tasks. Use a more powerful model."
      />
      <Card>
        {isLocal && <Note tone="warn">Agent tasks run on OpenRouter while Ollama is the main brain.</Note>}
        <ModelField
          provider="openrouter"
          value={settings.agentModel}
          placeholder={BRAIN_PROVIDERS.openrouter.model}
          emptyLabel={isLocal ? `Use ${BRAIN_PROVIDERS.openrouter.model}` : 'Use think hard model'}
          allowed={allowed}
          lockedDetail={lockedDetail}
          onChange={(agentModel) => void patch({ agentModel })}
        />
        <EffortField
          value={settings.agentEffort}
          subtitle="Thinking depth. Auto uses medium."
          onSelect={(agentEffort) => void patch({ agentEffort })}
        />
      </Card>
    </>
  );

  const fallback = (
    <>
      <SectionHeader
        title="Local fallback"
        description="Free Ollama model on this Mac when cloud is unavailable. Q&A only. Get models under API keys → Local."
      />
      <Card>
        <LocalBrain />
      </Card>
    </>
  );

  // With Ollama as the brain there is no separate fast model, and it is already the local model.
  return (
    <TabbedView
      tabs={[
        {
          id: 'thinking',
          label: 'Thinking',
          panel: (
            <>
              {thinkHard}
              {isLocal ? null : thinkFast}
            </>
          ),
        },
        { id: 'agent', label: 'Agent', panel: agent },
        ...(isLocal ? [] : [{ id: 'fallback', label: 'Local fallback', panel: fallback }]),
      ]}
    />
  );
}

/** How hard a cloud model thinks; OpenRouter maps the level onto each model's own parameter. */
function EffortField({
  value,
  subtitle,
  onSelect,
}: {
  value: BrainEffort;
  subtitle: string;
  onSelect: (effort: BrainEffort) => void;
}): ReactElement {
  return (
    <MenuSelect
      label="Effort"
      subtitle={subtitle}
      value={value}
      onSelect={onSelect}
      options={BRAIN_EFFORTS.map((option) => ({ value: option.value, label: option.label }))}
    />
  );
}

/** Which Ollama model Buddy thinks with; installing and downloading live under Providers. */
function LocalBrain(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;
  const [status, setStatus] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    void buddy.getOllamaStatus().then(setStatus);
  }, []);

  if (!status) return <Note>Checking for Ollama…</Note>;

  if (!status.running) {
    return (
      <Note tone="warn">
        Ollama isn't running. Install it and download a model under API keys → Local.
      </Note>
    );
  }

  // The saved model stays pickable even if it was removed from Ollama, so
  // the select never lies about what's configured.
  const models = status.models.includes(settings.ollamaModel) || !settings.ollamaModel
    ? status.models
    : [settings.ollamaModel, ...status.models];

  if (!models.length) {
    return (
      <Note tone="warn">No models yet. Download under API keys → Local.</Note>
    );
  }

  return (
    <MenuSelect
      label="Model"
      value={settings.ollamaModel}
      onSelect={(model) => void patch({ ollamaModel: model })}
      options={[
        { value: '', label: 'Off (no local model)' },
        ...models.map((name) => ({ value: name, label: name })),
      ]}
    />
  );
}
