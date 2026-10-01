import type { ReactElement, ReactNode } from 'react';
import { chordLabel } from '../../shared/hotkeys';
import { MenuSelect, type MenuSelectOption } from './MenuSelect';

/**
 * A hotkey picker: a menu of preset chords. A chord saved by an older build
 * that is not one of them stays selectable, so nobody's hotkey changes
 * under them; nothing new can be recorded.
 */
export function HotkeyInput({
  label,
  subtitle,
  value,
  onChange,
  presets,
  clearable = false,
  error,
}: {
  label?: ReactNode;
  subtitle?: ReactNode;
  /** The stored chord ('' means none, only sensible with clearable). */
  value: string;
  onChange: (chord: string) => void;
  presets: ReadonlyArray<{ value: string; label: string }>;
  /** Offer a None row that stores '' (turns the hotkey off). */
  clearable?: boolean;
  /** An error from the caller (e.g. a collision with another hotkey). */
  error?: string;
}): ReactElement {
  const options: MenuSelectOption[] = [
    ...(clearable ? [{ value: '', label: 'None' }] : []),
    ...presets,
    ...(value && !presets.some((preset) => preset.value === value)
      ? [{ value, label: `Custom: ${chordLabel(value)}` }]
      : []),
  ];
  return (
    <MenuSelect label={label} subtitle={subtitle} error={error} value={value} options={options} onSelect={onChange} />
  );
}
