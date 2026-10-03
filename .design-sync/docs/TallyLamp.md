---
category: Broadcast
---

Broadcast tally light: a round lamp that ignites and pulses in tally red while `live`, and sits grey (rule colour) otherwise. `size` in px (default 10). Pass `label` when it carries meaning on its own; omit it when text next to it says the same. Tally red is reserved for "live" – this lamp and `LiveBadge` are its only uses.

## Example

```jsx
<span className="inline-flex items-center gap-2 text-sm">
  <TallyLamp live label="Live" /> Gronkh
</span>
```
