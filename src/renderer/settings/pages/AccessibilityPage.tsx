import type { ReactElement } from 'react';
import { Card, SectionHeader, SwitchInput } from '../../ui';
import { useSettings } from '../context';

export function AccessibilityPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader
        title="Accessibility"
        description="Low-vision preset using Buddy's voice and drawings."
      />
      <Card>
        <SwitchInput
          label="Vision assist"
          subtitle="Larger drawings and captions, describe the screen, prefer spotlight."
          checked={settings.visionAssist}
          onChange={(checked) => void patch({ visionAssist: checked })}
        />
      </Card>
    </>
  );
}
