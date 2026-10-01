// Airplane mode as its own page, like the iOS settings toggle it is named
// after: one switch, and a preflight checklist naming what is ready and
// where to fix what isn't.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { OllamaStatus } from '../../../shared/types';
import { buddy } from '../../buddy';
import { Card, CheckIcon, LinkButton, Note, SectionHeader, SwitchInput, XIcon } from '../../ui';
import { useSettings } from '../context';

export function AirplanePage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader title="Airplane Mode" description="Everything stays on this Mac. No cloud. For those who like the offline experience, and/or has trust issues." />
      <Card>
        <SwitchInput
          label="Works with no internet"
          subtitle="Local Whisper, macOS voice, Ollama, and screenshots only. Remote MCP servers pause; local ones still work."
          checked={settings.airplaneMode}
          onChange={(checked) => void patch({ airplaneMode: checked })}
        />
        {settings.airplaneMode ? <PreflightChecklist ollamaModel={settings.ollamaModel} /> : null}
      </Card>
    </>
  );
}

/**
 * The airplane-mode onboarding: what is ready, what is missing, and where to
 * fix it. Every fix is a click (a download button or the right settings
 * page). No terminal, ever.
 */
function PreflightChecklist({ ollamaModel }: { ollamaModel: string }): ReactElement {
  const [ear, setEar] = useState<boolean | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);

  const refresh = (): void => {
    void buddy.getLocalWhisperReady().then(setEar);
    void buddy.getOllamaStatus().then(setOllama);
  };
  useEffect(refresh, []);

  if (ear === null || ollama === null) return <Note>Checking setup…</Note>;

  const brainProblem = !ollama.running
    ? { detail: 'Start or install Ollama under API keys → Local.', page: 'providers' }
    : !ollamaModel
      ? { detail: 'Pick a local model under Brain.', page: 'brain' }
      : !ollama.models.includes(ollamaModel)
        ? { detail: `Download ${ollamaModel} under API keys → Local.`, page: 'providers' }
        : null;
  const allSet = ear && !brainProblem;

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <ChecklistRow
        ok={ear}
        label="Ears"
        detail={ear ? 'Local Whisper is ready.' : 'Download Whisper under API keys → Local.'}
        fix={ear ? null : { label: 'Open API keys', page: 'providers' }}
      />
      <ChecklistRow
        ok={!brainProblem}
        label="Brain"
        detail={brainProblem?.detail ?? `${ollamaModel} on this Mac.`}
        fix={
          brainProblem
            ? { label: brainProblem.page === 'brain' ? 'Open Brain' : 'Open API keys', page: brainProblem.page }
            : null
        }
      />
      <ChecklistRow ok label="Voice" detail="macOS voice works offline." fix={null} />
      {allSet ? (
        <Note tone="ok">Ready. Buddy works fully offline.</Note>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Note tone="warn">Finish downloads while you still have internet.</Note>
          <LinkButton onClick={refresh}>Check again</LinkButton>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({
  ok,
  label,
  detail,
  fix,
}: {
  ok: boolean;
  label: string;
  detail: ReactNode;
  fix: { label: string; page: string } | null;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {ok ? <CheckIcon /> : <XIcon />}
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[12px] text-muted">{detail}</span>
      </div>
      {fix ? <LinkButton onClick={() => buddy.openSettingsWindow(fix.page)}>{fix.label}</LinkButton> : null}
    </div>
  );
}
