// Settings → Buddy's Phone: voice and style for calls Buddy places.

import type { ReactElement } from 'react';
import { BLAND_VOICES, DEFAULT_CALL_STYLE } from '../../../shared/types';
import { Card, LinkButton, MenuSelect, SectionHeader, Textarea, TextInput } from '../../ui';
import { useSettings } from '../context';

const BLAND_CUSTOM = '__custom__';

function blandPreset(voice: string): string {
  return (BLAND_VOICES as readonly string[]).includes(voice) ? voice : BLAND_CUSTOM;
}

export function PhonePage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;

  return (
    <>
      <SectionHeader
        title="Voice and style"
        description="For outbound calls Buddy places. Included with your account."
      />
      <Card>
        <MenuSelect
          label="Phone call voice"
          subtitle="Used on every outbound call."
          value={blandPreset(settings.blandVoice)}
          onSelect={(value) => void patch({ blandVoice: value === BLAND_CUSTOM ? '' : value })}
          options={[
            ...BLAND_VOICES.map((voice) => ({ value: voice, label: voice })),
            { value: BLAND_CUSTOM, label: 'Custom clone' },
          ]}
        />
        {blandPreset(settings.blandVoice) === BLAND_CUSTOM && (
          <TextInput
            label="Clone id"
            value={settings.blandVoice}
            placeholder="Voice clone id"
            onChange={(event) => void patch({ blandVoice: event.target.value.trim() })}
          />
        )}
        <Textarea
          label="Calling style"
          subtitle="How the agent speaks on calls. Buddy reports when the call ends."
          rows={5}
          value={settings.callStyle}
          onChange={(event) => void patch({ callStyle: event.target.value })}
        />
        <LinkButton onClick={() => void patch({ callStyle: DEFAULT_CALL_STYLE })}>Reset to default</LinkButton>
      </Card>
    </>
  );
}
