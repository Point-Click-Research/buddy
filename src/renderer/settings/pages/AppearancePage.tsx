import type { ReactElement } from 'react';
import type { Settings } from '../../../shared/types';
import { Card, ColorSwatch, MenuSelect, Note, SectionHeader, SwitchInput, Table, TableRow } from '../../ui';
import { useSettings } from '../context';

const COLOR_ROWS = [
  {
    key: 'colorIdleDot',
    main: 'Buddy is resting',
    detail: 'Resting dot when it follows your cursor.',
  },
  {
    key: 'colorSpeakingDot',
    main: "You're speaking",
    detail: 'Mic open (you, not Buddy).',
  },
  {
    key: 'colorBuddySpeakingDot',
    main: 'Buddy is speaking',
    detail: 'Buddy talking out loud.',
  },
  {
    key: 'colorLoadingDot',
    main: 'Buddy is working',
    detail: 'Thinking or using a tool.',
  },
  {
    key: 'colorDrivingFrame',
    main: 'Buddy is driving',
    detail: 'Screen glow and action ring.',
  },
  {
    key: 'colorAnnotations',
    main: 'Buddy is pointing something out',
    detail: "Buddy's on-screen marks.",
  },
  {
    key: 'colorUserMarks',
    main: "You're pointing something out",
    detail: 'Your marks while holding talk.',
  },
  {
    key: 'colorErrorBubble',
    main: 'Something went wrong',
    detail: 'Error bubble.',
  },
] as const satisfies ReadonlyArray<{
  key: keyof Settings;
  main: string;
  detail: string;
}>;

export function AppearancePage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader title="Theme" description="Light or dark for every Buddy window." />
      <Card>
        <MenuSelect
          label="Appearance"
          value={settings.appearance}
          onSelect={(appearance) => void patch({ appearance })}
          options={[
            { value: 'auto', label: 'Match macOS' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <SectionHeader
        title="The buddy dot"
        description="What the dot looks like and when it shows."
      />
      <Card>
        <SwitchInput
          label="Always follow my cursor"
          subtitle="Show the dot always. Off: only while Buddy is active."
          checked={settings.dotAlwaysVisible}
          onChange={(checked) => void patch({ dotAlwaysVisible: checked })}
        />
      </Card>

      <SectionHeader
        title="Buddy's response bubbles"
        description="On-screen text for spoken answers."
      />
      <Card>
        <SwitchInput
          label="Show Buddy's response bubbles"
          checked={settings.showCaptionBubble}
          onChange={(checked) => void patch({ showCaptionBubble: checked })}
        />
        <MenuSelect
          label="Location"
          subtitle="By the cursor or pinned to a screen corner."
          value={settings.bubbleLocation}
          onSelect={(value) => void patch({ bubbleLocation: value })}
          options={[
            { value: 'cursor', label: 'Next to cursor' },
            { value: 'top-left', label: 'Top left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-right', label: 'Bottom right' },
          ]}
        />
      </Card>

      <SectionHeader title="Text highlighting" description="Jump to Buddy from selected text." />
      <Card>
        <SwitchInput
          label="Show “Ask Buddy”"
          subtitle="Shows Ask Buddy on selection. Opens Type to Buddy with the text attached. Enter for a quick explanation."
          checked={settings.selectionButtonEnabled}
          onChange={(checked) => void patch({ selectionButtonEnabled: checked })}
        />
      </Card>

      <SectionHeader
        title="Colors"
        description="One color per state. Disco cycles the rainbow."
      />
      <Table
        columns={[
          { key: '#', label: '#' },
          { key: 'main', label: 'When' },
          { key: 'action', label: 'Color' },
        ]}
      >
        {COLOR_ROWS.map((row, index) => (
          <TableRow
            key={row.key}
            index={index + 1}
            main={row.main}
            detail={row.detail}
            action={
              <ColorSwatch
                label={row.main}
                value={settings[row.key]}
                onChange={(value) => void patch({ [row.key]: value })}
              />
            }
          />
        ))}
      </Table>
      <Note>Buddy can pick colors in speech (e.g. red strike-through). Those override these defaults.</Note>
    </>
  );
}
