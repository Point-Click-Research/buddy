import type { ReactElement } from 'react';
import { Card, SectionHeader, SwitchInput } from '../../ui';
import { useSettings } from '../context';

export function SoundEffectsPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader title="Sound effects" description="Cues Buddy plays while it listens, works, and finishes." />
      <Card>
        <SwitchInput
          label="Progress cues"
          subtitle="Short cues when Buddy starts listening, works, proposes a plan, finishes, or hits an error."
          checked={settings.sfxEnabled}
          onChange={(checked) => void patch({ sfxEnabled: checked })}
        />
      </Card>
    </>
  );
}
