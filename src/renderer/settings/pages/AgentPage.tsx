import type { ReactElement } from 'react';
import { Card, MenuSelect, SectionHeader, SwitchInput, Textarea, TextInput } from '../../ui';
import { clampNumber, useSettings } from '../context';

export function AgentPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader
        title="General"
        description="Buddy drives your screen while you watch, or works in his own browser while you keep going. Purchases always use his browser."
      />
      <Card>
        <SwitchInput
          label="Enable agent mode"
          subtitle="Multi-step tasks on screen. Off, Buddy still answers and uses tools, but won't drive the UI."
          checked={settings.agentModeEnabled}
          onChange={(checked) => void patch({ agentModeEnabled: checked })}
        />
        <MenuSelect
          label="How Buddy uses your computer"
          subtitle="CUA finds things on the accessibility tree by description, with Jev picking actions. Only the main display supports this. Other displays use pixels. Changing this stops a running task."

          value={settings.computerProvider}
          onSelect={(value) => void patch({ computerProvider: value })}
          options={[
            { value: 'cua', label: 'CUA (accessibility), recommended' },
            { value: 'basic', label: 'Basic (pixels only)' },
          ]}
        />
      </Card>

      <SectionHeader title="Safety" description="Confirmations and limits." />
      <Card>
        <SwitchInput
          label="Approve plan before starting"
          subtitle="Show the plan and wait for OK before acting. Off starts right away."
          checked={settings.agentConfirmPlans}
          onChange={(checked) => void patch({ agentConfirmPlans: checked })}
        />
        <SwitchInput
          label="Ask before taking consequential actions"
          subtitle="Ask before send, submit, delete, or pay."
          checked={settings.agentConfirmActions}
          onChange={(checked) => void patch({ agentConfirmActions: checked })}
        />
        <SwitchInput
          label="Offer to save a skill after a task"
          subtitle="After a good run, offer to save steps as a skill."
          checked={settings.distillSaveCards}
          onChange={(checked) => void patch({ distillSaveCards: checked })}
        />
        <TextInput
          label="Max actions per task"
          subtitle="Cap clicks, keys, and commands per task."
          type="number"
          min={1}
          max={500}
          value={settings.agentMaxActions}
          onChange={(event) => void patch({ agentMaxActions: clampNumber(event.target.value, 1) })}
        />
        <TextInput
          label="Max minutes per task"
          subtitle="Wall-clock limit. Task stops when time is up."
          type="number"
          min={1}
          max={120}
          value={settings.agentMaxMinutes}
          onChange={(event) => void patch({ agentMaxMinutes: clampNumber(event.target.value, 1) })}
        />
        <Textarea
          label="Excluded apps"
          subtitle="Agent pauses when one of these is frontmost."
          rows={7}
          value={settings.agentExcludedApps.join('\n')}
          onChange={(event) => {
            const apps = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean);
            void patch({ agentExcludedApps: apps });
          }}
        />
      </Card>
    </>
  );
}
