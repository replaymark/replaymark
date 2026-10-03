---
category: Overlays
---

Non-modal floating panel anchored to a trigger: `Popover` > `PopoverTrigger` + `PopoverContent` (`side`, `align`, `sideOffset`) with optional `PopoverHeader` > `PopoverTitle` / `PopoverDescription`.

## Example

```jsx
<Popover>
  <PopoverTrigger render={<Button variant="outline" size="sm" />}>Filter</PopoverTrigger>
  <PopoverContent><PopoverHeader><PopoverTitle>Zeitraum</PopoverTitle><PopoverDescription>Letzte 7 Tage</PopoverDescription></PopoverHeader></PopoverContent>
</Popover>
```
