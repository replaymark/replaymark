---
category: Data display
---

Round Twitch profile image. `url` may be `null` – it then falls back to the first letter of `name` on paper. `size` in px (default 32; 40 in stream heads).

## Example

```jsx
<div className="flex items-center gap-2">
  <StreamerAvatar url={null} name="Gronkh" size={40} />
  <span className="font-display text-xl font-bold">Gronkh</span>
</div>
```
