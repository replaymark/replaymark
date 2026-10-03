import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from '@replaymark/ds';

const games = [
  'Elden Ring',
  'Just Chatting',
  'Minecraft',
  'Counter-Strike 2',
  'Grand Theft Auto V',
];

export const Single = () => (
  <div className="w-72">
    <Combobox items={games} defaultValue="Elden Ring">
      <ComboboxInput placeholder="Spiel suchen…" />
      <ComboboxContent>
        <ComboboxEmpty>Keine Treffer</ComboboxEmpty>
        <ComboboxList>
          {(g: string) => (
            <ComboboxItem key={g} value={g}>
              {g}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  </div>
);

function MultiChips() {
  const anchor = useComboboxAnchor();
  return (
    <div className="w-96">
      <Combobox
        multiple
        items={games}
        defaultValue={['Elden Ring', 'Minecraft']}
      >
        <ComboboxChips ref={anchor} className="min-h-9 rounded-md">
          <ComboboxValue>
            {(selected: string[]) =>
              selected.map((g) => <ComboboxChip key={g}>{g}</ComboboxChip>)
            }
          </ComboboxValue>
          <ComboboxChipsInput placeholder="" className="h-7 bg-transparent" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Keine Treffer</ComboboxEmpty>
          <ComboboxList>
            {(g: string) => (
              <ComboboxItem key={g} value={g}>
                {g}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
export const Multiple = () => <MultiChips />;

function OpenMulti() {
  const anchor = useComboboxAnchor();
  return (
    <div className="h-72 w-96">
      <Combobox
        multiple
        items={games}
        defaultValue={['Elden Ring']}
        defaultOpen
      >
        <ComboboxChips ref={anchor} className="min-h-9 rounded-md">
          <ComboboxValue>
            {(selected: string[]) =>
              selected.map((g) => <ComboboxChip key={g}>{g}</ComboboxChip>)
            }
          </ComboboxValue>
          <ComboboxChipsInput placeholder="" className="h-7 bg-transparent" />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>Keine Treffer</ComboboxEmpty>
          <ComboboxList>
            {(g: string) => (
              <ComboboxItem key={g} value={g}>
                {g}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
export const Open = () => <OpenMulti />;
