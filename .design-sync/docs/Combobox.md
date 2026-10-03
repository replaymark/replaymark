---
category: Forms
---

Searchable (multi-)select built on Base UI. Compose: `Combobox` (items, value, onValueChange, `multiple`) > `ComboboxInput` (single) or `ComboboxChips` + `ComboboxValue` + `ComboboxChip` + `ComboboxChipsInput` (multiple, anchor via `useComboboxAnchor()`), then `ComboboxContent` > `ComboboxEmpty` + `ComboboxList` > `ComboboxItem`. Also: `ComboboxGroup`, `ComboboxLabel`, `ComboboxSeparator`, `ComboboxCollection`, `ComboboxTrigger`.

## Example

```jsx
<Combobox items={['Elden Ring', 'Minecraft', 'Just Chatting']}>
  <ComboboxInput placeholder="Spiel suchen…" />
  <ComboboxContent>
    <ComboboxEmpty>Keine Treffer</ComboboxEmpty>
    <ComboboxList>{(item) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList>
  </ComboboxContent>
</Combobox>
```
