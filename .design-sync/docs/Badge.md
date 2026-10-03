---
category: Data display
---

Small pill for counts and states (`variant`: `default`, `secondary`, `outline`, `destructive`, `ghost`, `link`). Use `destructive` for failures (with text, not colour alone). For "live" use `LiveBadge`, never a red Badge.

## Example

```jsx
<div className="flex gap-2">
  <Badge>3 aktiv</Badge>
  <Badge variant="secondary">Pausiert</Badge>
  <Badge variant="outline">Just Chatting</Badge>
  <Badge variant="destructive">Fehlgeschlagen</Badge>
</div>
```
