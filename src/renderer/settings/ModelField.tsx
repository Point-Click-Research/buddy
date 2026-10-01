// A provider's models as a menu, with Enter manually at the bottom for a typed id.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { modelOnPlan } from '../../shared/plan-models';
import type { ProviderModel } from '../../shared/types';
import { buddy } from '../buddy';
import { MenuSelect, TextInput } from '../ui';

const MANUAL = '__manual__';

export function ModelField({
  label = 'Model',
  provider,
  value,
  placeholder,
  disabled,
  emptyLabel,
  allowed = [],
  lockedDetail,
  onChange,
}: {
  label?: string;
  provider: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** First row, saved as an empty string (fast and agent models). */
  emptyLabel?: string;
  /** Plan prefixes. Empty means every model can be picked. */
  allowed?: readonly string[];
  /** Right-side note on a model the plan does not include. */
  lockedDetail?: string;
  onChange: (model: string) => void;
}): ReactElement {
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState(value);
  const valueRef = useRef(value);
  valueRef.current = value;
  const restricted = allowed.length > 0;
  const onPlan = (id: string): boolean => id === '' || !restricted || modelOnPlan(id, allowed);

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    setModels(null);
    setError('');
    setManual(false);
    void buddy.listModels(provider).then((result) => {
      if (!alive) return;
      setModels(result.models);
      setError(result.error);
      const current = valueRef.current;
      if (current && !result.models.some((model) => model.id === current)) setManual(true);
    });
    return () => {
      alive = false;
    };
  }, [provider, disabled]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (disabled) {
    return (
      <TextInput
        label={label}
        value={value}
        placeholder={placeholder}
        disabled
        onChange={() => undefined}
      />
    );
  }

  const available: ProviderModel[] = [];
  const outside: ProviderModel[] = [];
  for (const model of models ?? []) (onPlan(model.id) ? available : outside).push(model);
  const listed = [...available, ...outside];
  const known = listed.some((model) => model.id === value);
  const showManual = manual || (models !== null && listed.length === 0) || (models !== null && value !== '' && !known);

  const options = [
    ...(emptyLabel ? [{ value: '', label: emptyLabel }] : []),
    ...(models === null && value ? [{ value, label: value }] : []),
    ...(models === null && !value && !emptyLabel
      ? [{ value: '', label: 'Loading…', disabled: true, inertWhenDisabled: true }]
      : []),
    ...(models === null
      ? []
      : listed.map((model) => {
          const locked = !onPlan(model.id);
          return {
            value: model.id,
            label: model.label,
            disabled: locked,
            inertWhenDisabled: true,
            detail: locked ? lockedDetail : undefined,
          };
        })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <MenuSelect
        wide
        searchable={listed.length > 12}
        label={label}
        error={error}
        value={showManual ? MANUAL : value}
        options={options}
        footer={{ value: MANUAL, label: 'Enter manually' }}
        onSelect={(next) => {
          if (next === MANUAL) {
            setManual(true);
            return;
          }
          if (!onPlan(next)) return;
          setManual(false);
          onChange(next);
        }}
      />
      {showManual && (
        <TextInput
          value={restricted ? draft : value}
          placeholder={placeholder || 'Model id'}
          onBlur={restricted ? () => setDraft(value) : undefined}
          onChange={(event) => {
            const next = event.target.value;
            const trimmed = next.trim();
            if (!restricted) {
              onChange(trimmed);
              return;
            }
            setDraft(next);
            if (onPlan(trimmed)) onChange(trimmed);
          }}
        />
      )}
    </div>
  );
}
