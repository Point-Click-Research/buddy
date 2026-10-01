import type { ReactElement } from 'react';
import { keyWarningDisplay } from '../../../shared/key-warning';
import { SPEECH_WPM } from '../../../shared/types';
import {
  Card,
  CardStack,
  MenuSelect,
  Note,
  PairTable,
  SectionHeader,
  SliderInput,
  SwitchInput,
  TabbedView,
  TextInput,
} from '../../ui';
import { useSettings } from '../context';
import { useAccount } from '../../shared/account-data';
import { VoiceSelect } from '../../shared/VoiceSelect';
import { keyedOption, openProviders } from '../provider-options';

const SYSTEM_VOICE_SUBTITLE =
  'Offline macOS voices. Fallback when ElevenLabs fails. Better voices: System Settings → Accessibility → Spoken Content.';

export function VoicePage(): ReactElement {
  const { view, patch } = useSettings();
  const account = useAccount();
  const { settings } = view;
  const tts = settings.ttsProvider;
  const speechOn = settings.speechEnabled;

  const speaking = (
    <>
      <SectionHeader title="Speaking" description="Text to speech." />
      <CardStack>
        <Card>
          <SwitchInput
            label="Speak responses out loud"
            subtitle="Off: answers on screen only, no voice."
            checked={speechOn}
            onChange={(checked) => void patch({ speechEnabled: checked })}
          />
        </Card>

        {speechOn ? (
          <Card>
          <MenuSelect
            label="Provider"
            subtitle={tts === 'system' ? SYSTEM_VOICE_SUBTITLE : undefined}
            error={
              tts === 'elevenlabs' ? keyWarningDisplay(settings, tts, settings.keyWarnings[tts]) : undefined
            }
            value={tts}
            onSelect={(value) => void patch({ ttsProvider: value })}
            onDisabledPick={() => openProviders()}
            options={[
              keyedOption(account, view.keys, 'elevenlabs', 'ElevenLabs'),
              { value: 'system', label: 'macOS (free, no key needed)', detail: 'Free' },
            ]}
          />
          {tts === 'elevenlabs' && (
            <VoiceSelect
              value={settings.elevenLabsVoiceId}
              onSelect={(elevenLabsVoiceId) => void patch({ elevenLabsVoiceId })}
            />
          )}
          {tts === 'system' && (
            <TextInput
              label="Voice"
              value={settings.systemVoice}
              placeholder="System default"
              onChange={(event) => void patch({ systemVoice: event.target.value.trim() })}
            />
          )}
          <SliderInput
            label="Speaking speed"
            value={settings.speechWpm}
            min={SPEECH_WPM.min}
            max={SPEECH_WPM.max}
            step={5}
            unit="WPM"
            onChange={(wpm) => void patch({ speechWpm: wpm })}
          />
          </Card>
        ) : null}
      </CardStack>
    </>
  );

  const pronunciation = (
    <>
      <SectionHeader
        title="Pronunciation dictionary"
        description="Fix misread words when Buddy speaks."
      />
      <PairTable
        labelA="Written"
        labelB="Spoken"
        placeholderA="°F"
        placeholderB="degrees Fahrenheit"
        requireBoth
        rows={settings.pronunciations.map((rule) => ({ a: rule.text, b: rule.spoken }))}
        onSave={(pairs) =>
          void patch({ pronunciations: pairs.map((pair) => ({ text: pair.a, spoken: pair.b })) })
        }
      />
      <Note>Captions stay written. Lowercase matches any casing; capitals match exactly.</Note>
    </>
  );

  return (
    <TabbedView
      tabs={[
        { id: 'speaking', label: 'Speaking', panel: speaking },
        { id: 'pronunciation', label: 'Pronunciation', panel: pronunciation },
      ]}
    />
  );
}
