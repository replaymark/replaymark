import type { Category } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BoxArt } from '@/components/box-art.tsx';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@/components/ui/combobox.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { categorySearchQuery, errorCode } from '@/lib/queries.ts';
import { useDebounced } from '@/lib/use-debounced.ts';

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Multi-select for Twitch categories. Only search results can be chosen
 * (no free text); selections render as removable chips. With `single`, a new
 * pick replaces the previous one, so `value` holds at most one category.
 */
export function CategoryPicker({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  single = false,
  placeholder,
}: {
  id?: string;
  value: Category[];
  onChange: (next: Category[]) => void;
  invalid?: boolean;
  describedBy?: string;
  single?: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const anchor = useComboboxAnchor();
  const [input, setInput] = useState('');
  const q = useDebounced(input.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = q.length >= SEARCH_MIN_CHARS;
  const search = useQuery({ ...categorySearchQuery(q), enabled });
  const items = enabled ? (search.data ?? []) : [];
  const pending =
    input.trim().length >= SEARCH_MIN_CHARS &&
    (input.trim() !== q || search.isFetching);

  let emptyText = t('picker.noResults');
  if (input.trim().length < SEARCH_MIN_CHARS) emptyText = t('picker.minChars');
  else if (pending) emptyText = t('picker.searching');
  else if (search.isError) emptyText = t.error(errorCode(search.error));

  return (
    <Combobox
      multiple
      items={items}
      filter={null}
      value={value}
      onValueChange={(v) => {
        const next = v as Category[];
        onChange(single ? next.slice(-1) : next);
      }}
      onInputValueChange={setInput}
      itemToStringLabel={(c: Category) => c.name}
      itemToStringValue={(c: Category) => c.id}
      isItemEqualToValue={(a: Category, b: Category) => a.id === b.id}
    >
      <ComboboxChips ref={anchor} className="min-h-9 rounded-md">
        <ComboboxValue>
          {(selected: Category[]) =>
            selected.map((c) => (
              <ComboboxChip
                key={c.id}
                removeLabel={t('picker.remove', { name: c.name })}
                className="h-7 max-w-full gap-1.5 rounded-md border bg-sheet pl-1"
              >
                <BoxArt url={c.boxArtUrl} width={15} height={20} />
                <span className="truncate">{c.name}</span>
              </ComboboxChip>
            ))
          }
        </ComboboxValue>
        <ComboboxChipsInput
          id={id}
          placeholder={
            value.length === 0 ? (placeholder ?? t('picker.placeholder')) : ''
          }
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-7 bg-transparent"
        />
      </ComboboxChips>
      <ComboboxContent anchor={anchor} className="rounded-md">
        <ComboboxEmpty aria-live="polite">{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(c: Category) => (
            <ComboboxItem key={c.id} value={c} className="gap-2.5 py-1">
              <BoxArt url={c.boxArtUrl} width={27} height={36} />
              <span className="truncate">{c.name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
