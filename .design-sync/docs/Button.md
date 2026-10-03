---
category: Actions
---

Primary action control (Base UI button + cva variants). `variant="default"` is solid ink; use it once per view for the main action. `outline` / `secondary` / `ghost` for secondary actions, `destructive` for delete/remove (crimson, never tally red), `link` for inline text actions. Sizes: `xs`, `sm`, `default`, `lg`, and square icon buttons `icon-xs`, `icon-sm`, `icon`, `icon-lg` (give those an `aria-label`). Lucide icons as children are sized automatically.

## Example

```jsx
<div className="flex items-center gap-2">
  <Button>Speichern</Button>
  <Button variant="outline">Abbrechen</Button>
  <Button variant="destructive" size="sm">Streamer entfernen</Button>
</div>
```
