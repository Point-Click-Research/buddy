import type { ReactElement, ReactNode } from 'react';

/** A labeled range slider with the current value shown beside the label. */
export function SliderInput({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Shown after the value, e.g. "WPM". */
  unit?: string;
  onChange: (next: number) => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{label}</span>
        <span className="text-[13px] tabular-nums text-muted">
          {value}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slider"
      />
    </div>
  );
}
