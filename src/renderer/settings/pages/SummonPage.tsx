import { useState, type ReactElement } from 'react';
import { chordLabel } from '../../../shared/hotkeys';
import type { QuickAskTrigger } from '../../../shared/types';
import { buddy } from '../../buddy';
import { Button, Card, HotkeyInput, MenuSelect, SectionHeader, SwitchInput, TextInput } from '../../ui';
import { clampNumber, useSettings } from '../context';

type ChordKey = 'hotkey' | 'agentHotkey' | 'alwaysOnHotkey' | 'quickAskHotkey';

/** Which control owns each chord, for a conflict message that says where to look. */
const CHORD_OWNERS: Record<ChordKey, string> = {
  hotkey: 'Hold to Talk',
  agentHotkey: 'Do This',
  alwaysOnHotkey: 'Always On',
  quickAskHotkey: 'Type to Buddy',
};

export const HOLD_PRESETS = [
  { value: 'Control+Alt', label: 'Control (⌃) + Option (⌥)' },
  { value: 'Control+Shift', label: 'Control (⌃) + Shift (⇧)' },
  { value: 'Alt+Shift', label: 'Option (⌥) + Shift (⇧)' },
  { value: 'Control+Alt+Shift', label: 'Control (⌃) + Option (⌥) + Shift (⇧)' },
];

export const AGENT_PRESETS = [
  { value: 'Control+Alt+Shift', label: 'Control (⌃) + Option (⌥) + Shift (⇧)' },
  { value: 'Control+Shift', label: 'Control (⌃) + Shift (⇧)' },
  { value: 'Alt+Shift', label: 'Option (⌥) + Shift (⇧)' },
];

// The always-on toggle fires on press, so every preset carries an ordinary key.
const ALWAYS_ON_PRESETS = [
  { value: 'Control+Alt+a', label: 'Control (⌃) + Option (⌥) + A' },
  { value: 'Control+Alt+space', label: 'Control (⌃) + Option (⌥) + Space' },
];

// The Type to Buddy box also opens on press, so these carry a key too.
const QUICK_ASK_PRESETS = [
  { value: 'Control+Alt+t', label: 'Control (⌃) + Option (⌥) + T' },
  { value: 'Control+Alt+period', label: 'Control (⌃) + Option (⌥) + .' },
];

const QUICK_ASK_TRIGGER_OPTIONS: Array<{ value: QuickAskTrigger; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'shake', label: 'Shake the cursor' },
  { value: 'doubleTap', label: 'Double-tap Control (⌃)' },
  { value: 'hotkey', label: 'A hotkey' },
];

export function SummonPage(): ReactElement {
  const { view, patch } = useSettings();
  const { settings } = view;
  const [conflict, setConflict] = useState<Partial<Record<ChordKey, string>>>({});

  /** Save a chord unless it collides with one of the others. */
  function setChord(key: ChordKey, chord: string): void {
    const owner = (Object.keys(CHORD_OWNERS) as ChordKey[]).find(
      (other) => other !== key && chord && settings[other] === chord,
    );
    if (owner) {
      setConflict({ [key]: `${chordLabel(chord)} is already ${CHORD_OWNERS[owner]}'s hotkey. Change that one first, or pick another.` });
      return;
    }
    setConflict({});
    void patch({ [key]: chord });
  }

  return (
    <>
      <SectionHeader
        title="Hold to Talk"
        description="Hold, talk, release. Buddy uses what's on screen."
      />
      <Card>
        <HotkeyInput
          label="Hotkey"
          value={settings.hotkey}
          onChange={(chord) => setChord('hotkey', chord)}
          presets={HOLD_PRESETS}
          error={conflict.hotkey ?? ''}
        />
        <SwitchInput
          label="Draw to point while talking"
          subtitle="Hold & drag your mouse while holding talk to draw things you're referring to."
          checked={settings.marksEnabled}
          onChange={(checked) => void patch({ marksEnabled: checked })}
        />
      </Card>

      <SectionHeader title="Do This Agent Action" description="Hold and speak a task. Buddy plans and drives." />
      <Card>
        <HotkeyInput
          label="Hotkey"
          value={settings.agentHotkey}
          onChange={(chord) => setChord('agentHotkey', chord)}
          presets={AGENT_PRESETS}
          error={conflict.agentHotkey ?? ''}
        />
      </Card>

      <SectionHeader
        title="Type to Buddy"
        description="Text box by the dot. Enter sends, Esc closes. Hold talk to dictate or mark."
      />
      <Card>
        <MenuSelect
          label="Open with"
          value={settings.quickAskTrigger}
          options={QUICK_ASK_TRIGGER_OPTIONS}
          onSelect={(trigger) => void patch({ quickAskTrigger: trigger })}
        />
        {settings.quickAskTrigger === 'hotkey' && (
          <HotkeyInput
            label="Hotkey"
            subtitle="Press once to open."
            value={settings.quickAskHotkey}
            onChange={(chord) => setChord('quickAskHotkey', chord)}
            presets={QUICK_ASK_PRESETS}
            clearable
            error={conflict.quickAskHotkey ?? ''}
          />
        )}
      </Card>

      <SectionHeader
        title="Always On"
        description="Hands-free listening until you toggle off or idle timeout."
      />
      <Card>
        <HotkeyInput
          label="Toggle hotkey"
          subtitle="Press once to toggle."
          value={settings.alwaysOnHotkey}
          onChange={(chord) => setChord('alwaysOnHotkey', chord)}
          presets={ALWAYS_ON_PRESETS}
          clearable
          error={conflict.alwaysOnHotkey ?? ''}
        />
        <TextInput
          label="Idle timeout (minutes)"
          type="number"
          min={1}
          max={240}
          value={settings.alwaysOnIdleTimeoutMinutes}
          onChange={(event) => void patch({ alwaysOnIdleTimeoutMinutes: clampNumber(event.target.value, 1) })}
        />
      </Card>

      <SectionHeader title="Tour" description="The walkthrough Buddy gave after setup. Escape stops it anytime." />
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium">Hear it again, from the top</span>
          <Button variant="secondary" onClick={() => buddy.replayTour()}>
            Replay the tour
          </Button>
        </div>
      </Card>
    </>
  );
}
