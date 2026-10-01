// Buddy's memory as plain lists: what it knows about you, and what it knows
// about each person you shop for. Every row is one line of text, editable in
// place. Rows are filed by category under the hood (sizes vs. dining vs.
// addresses) so the prompt can group them; the page never shows that seam.

import { useEffect, useState, type ReactElement } from 'react';
import { SHOPPER_CATEGORIES, type ShopperCategory, type ShopperProfile } from '../../../shared/types';
import { InlineInput, LinkButton, Note, SectionHeader, Table, TableRow, TextInput } from '../../ui';
import { useSettings } from '../context';
import { errorMessage } from '../../../shared/errors';

const EMPTY_SHOPPER: Omit<ShopperProfile, 'name'> = {
  products: [],
  travel: [],
  dining: [],
  formFacts: [],
  general: [],
};

/** One memory line, whichever category it lives in. */
interface Row {
  key: string;
  text: string;
  commit: (next: string) => unknown;
  remove: () => unknown;
}

/** TS needs help assigning a computed category key into a profile patch. */
function categoryPatch(category: ShopperCategory, entries: string[]): Partial<ShopperProfile> {
  return { [category]: entries };
}

/** Every entry across a profile's categories, in category order. */
function profileRows(shopper: ShopperProfile, onChange: (next: Partial<ShopperProfile>) => unknown): Row[] {
  return SHOPPER_CATEGORIES.flatMap(({ key }) =>
    shopper[key].map((text, index) => ({
      key: `${key}-${index}`,
      text,
      commit: (next: string) => onChange(categoryPatch(key, shopper[key].map((row, i) => (i === index ? next : row)))),
      remove: () => onChange(categoryPatch(key, shopper[key].filter((_, i) => i !== index))),
    })),
  );
}

export function MemoryPage(): ReactElement {
  const { view, patch } = useSettings();
  const { shoppers } = view.settings;
  const [error, setError] = useState('');

  const saveShoppers = (next: ShopperProfile[]): void => {
    patch({ shoppers: next }).then(
      () => setError(''),
      (err: unknown) => setError(errorMessage(err)),
    );
  };
  const saveShopper = (index: number, next: Partial<ShopperProfile>): void =>
    saveShoppers(shoppers.map((shopper, i) => (i === index ? { ...shopper, ...next } : shopper)));
  const addTo = (index: number, text: string): void =>
    saveShopper(index, categoryPatch('general', [...shoppers[index]!.general, text]));

  return (
    <>
      <SectionHeader
        title="About you"
        description="What Buddy knows about you: sizes, brands you love or avoid, addresses, birthdays. It adds lines as you talk. Edit or remove any of them."
      />
      <MemoryList
        rows={profileRows(shoppers[0]!, (next) => saveShopper(0, next))}
        placeholder="Loves classic design · vegetarian · prefers eco-friendly brands · travels frequently"

        onAdd={(text) => addTo(0, text)}
      />

      <SectionHeader
        title="Memory about others"
        description="Buddy keeps their notes apart from yours, and files under them when you name them or they introduce themselves (“this is Sanna”)."
      />
      {shoppers.slice(1).map((shopper, offset) => {
        const index = offset + 1;
        return (
          <div key={index} className="mb-6 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <TextInput
                  placeholder="Sanna (girlfriend)"
                  value={shopper.name}
                  onChange={(event) => saveShopper(index, { name: event.target.value })}
                />
              </div>
              <LinkButton tone="danger" className="shrink-0" onClick={() => saveShoppers(shoppers.filter((_, i) => i !== index))}>
                Remove
              </LinkButton>
            </div>
            <MemoryList
              rows={profileRows(shopper, (next) => saveShopper(index, next))}
              placeholder="Size 8 in Nike · allergic to nickel · loves Aesop"
              onAdd={(text) => addTo(index, text)}
            />
          </div>
        );
      })}
      <LinkButton tone="ink" onClick={() => saveShoppers([...shoppers, { name: '', ...EMPTY_SHOPPER }])}>
        + Add someone
      </LinkButton>
      <Note tone="fail">{error}</Note>
    </>
  );
}

/** A list of memory lines with an add row at the bottom. */
function MemoryList({
  rows,
  placeholder,
  onAdd,
}: {
  rows: Row[];
  placeholder: string;
  onAdd: (text: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <Table columns={[{ key: '#', label: '#' }, { key: 'main', label: 'Memory' }, { key: 'action', label: '' }]}>
      {rows.map((row, index) => (
        <TableRow
          key={row.key}
          index={index + 1}
          main={<EntryCell text={row.text} onCommit={row.commit} />}
          action={
            <LinkButton tone="danger" onClick={() => void row.remove()}>
              Remove
            </LinkButton>
          }
        />
      ))}
      <TableRow
        index={rows.length + 1}
        main={
          <InlineInput
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
        }
        action={
          <LinkButton tone="ink" onClick={add}>
            Add
          </LinkButton>
        }
      />
    </Table>
  );
}

/** One line, editable in place. Commits on blur or Enter; empty reverts. */
function EntryCell({ text, onCommit }: { text: string; onCommit: (next: string) => unknown }): ReactElement {
  const [value, setValue] = useState(text);
  useEffect(() => {
    setValue(text);
  }, [text]);

  const commit = (): void => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === text) {
      setValue(text);
      return;
    }
    void onCommit(trimmed);
  };

  return (
    <InlineInput
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}
