---
category: Broadcast
---

One game segment of a stream as a list row (`<li>` – render inside `<ul className="divide-y">`): time window, duration, "approximate"/"muted" hints and a "Watch" deep link when `segment.link` is set. `segment` is a `TimelineSegment` (`{ categoryId, categoryName, boxArtUrl, startedAt, endedAt, durationMs, startApprox, endApprox, muted, link }`); `name` is the streamer name for the link label; `showGame` adds box art + game name; `highlighted` marks the selected game with an ink bar.

## Example

```jsx
const now = Date.now();
const seg = { categoryId: 'g1', categoryName: 'Elden Ring', boxArtUrl: null, startedAt: now - 2 * 3600e3, endedAt: now - 3600e3,
  durationMs: 3600e3, startApprox: false, endApprox: false, muted: false, link: 'https://www.twitch.tv/videos/1?t=0h0m0s' };
<ul className="divide-y"><SegmentRow segment={seg} now={now} name="Gronkh" showGame /></ul>
```
