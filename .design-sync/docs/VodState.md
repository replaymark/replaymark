---
category: Broadcast
---

Availability of a stream's VOD: `state` is `"available" | "pending" | "none" | "likely_expired"`. Non-available states render as a hint button with a tooltip explaining why (needs `ReplaymarkProvider` for i18n + tooltips).

## Example

```jsx
<div className="flex gap-4"><VodState state="available" /><VodState state="pending" /><VodState state="likely_expired" /></div>
```
