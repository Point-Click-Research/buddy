import type { ReactElement } from 'react';
import { Card, Note, SectionHeader, SwitchInput } from '../../ui';
import { useSettings } from '../context';

export function EyesPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader title="Seeing" description="Screen snapshots for answers." />
      <Card>
        <SwitchInput
          label="Show Buddy your screen"
          subtitle="Screenshot each question so Buddy can see, point, and draw. Off is faster and private."
          checked={settings.screenAwareness}
          onChange={(checked) => void patch({ screenAwareness: checked })}
        />
      </Card>
      {!settings.screenAwareness ? (
        <Note>Other tools still work. Buddy can't see or point without this.</Note>
      ) : null}
    </>
  );
}
