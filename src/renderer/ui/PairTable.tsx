// An editable two-column table of text pairs — Field/Value facts,
// written/spoken pronunciations. Saved rows commit on blur or Enter, a
// draft row adds new pairs, and emptying a row removes it.

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { LinkButton } from './LinkButton';
import { Table, TableRow } from './Table';
import { InlineInput } from './TextInput';

export interface Pair {
  a: string;
  b: string;
}

export function PairTable({
  labelA,
  labelB,
  widthA = '180px',
  placeholderA,
  placeholderB,
  requireBoth = false,
  requireA = false,
  rows,
  onSave,
}: {
  labelA: string;
  labelB: string;
  /** The first column's width; the second takes the rest. */
  widthA?: string;
  placeholderA: string;
  placeholderB: string;
  /** A row needs both sides to exist (otherwise either side will do). */
  requireBoth?: boolean;
  /** A row needs its first side; the second is optional. */
  requireA?: boolean;
  rows: Pair[];
  /** Called with the complete new list on every add, edit, or removal. */
  onSave: (rows: Pair[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Pair>({ a: '', b: '' });
  const keeps = (pair: Pair): boolean => {
    if (requireBoth) return Boolean(pair.a && pair.b);
    if (requireA) return Boolean(pair.a);
    return Boolean(pair.a || pair.b);
  };

  const addDraft = (): void => {
    if (!keeps(draft)) return;
    onSave([...rows, draft]);
    setDraft({ a: '', b: '' });
  };

  const shared = { widthA, placeholderA, placeholderB };

  return (
    <Table
      columns={[
        { key: '#', label: '#' },
        { key: 'a', label: labelA, width: widthA },
        { key: 'b', label: labelB },
        { key: 'action', label: '' },
      ]}
    >
      {rows.map((pair, index) => (
        <PairRow
          key={`${index}-${pair.a}`}
          {...shared}
          index={index + 1}
          pair={pair}
          onCommit={(next) => {
            const copy = [...rows];
            if (keeps(next)) copy[index] = next;
            else copy.splice(index, 1);
            onSave(copy);
          }}
          action={
            <LinkButton tone="danger" onClick={() => onSave(rows.filter((_, i) => i !== index))}>
              Remove
            </LinkButton>
          }
        />
      ))}
      <PairRow
        {...shared}
        index={rows.length + 1}
        pair={draft}
        onChange={setDraft}
        onEnter={addDraft}
        action={
          <LinkButton tone="ink" onClick={addDraft}>
            Add
          </LinkButton>
        }
      />
    </Table>
  );
}

/** One pair as a row. Saved rows commit on blur; the draft row reports every keystroke. */
function PairRow({
  index,
  pair,
  widthA,
  placeholderA,
  placeholderB,
  onChange,
  onCommit,
  onEnter,
  action,
}: {
  index: number;
  pair: Pair;
  widthA: string;
  placeholderA: string;
  placeholderB: string;
  onChange?: (next: Pair) => void;
  onCommit?: (next: Pair) => void;
  onEnter?: () => void;
  action: ReactNode;
}): ReactElement {
  const [local, setLocal] = useState(pair);
  useEffect(() => {
    setLocal(pair);
  }, [pair.a, pair.b]);

  const update = (next: Pair): void => {
    setLocal(next);
    onChange?.(next);
  };
  const commit = (): void => onCommit?.({ a: local.a.trim(), b: local.b.trim() });
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return;
    if (onEnter) onEnter();
    else event.currentTarget.blur();
  };

  return (
    <TableRow
      index={index}
      mainWidth={widthA}
      main={
        <InlineInput
          placeholder={placeholderA}
          value={local.a}
          onChange={(event) => update({ ...local, a: event.target.value })}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      }
      second={
        <InlineInput
          placeholder={placeholderB}
          value={local.b}
          onChange={(event) => update({ ...local, b: event.target.value })}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      }
      action={action}
    />
  );
}
