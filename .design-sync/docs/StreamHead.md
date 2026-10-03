---
category: Broadcast
---

Header of one recorded stream: avatar, display-type name, `LiveBadge` when live, then date, time window and total duration. `stream` is a `TimelineStream` (`{ streamId, broadcaster: { id, login, displayName, avatarUrl }, startedAt, endedAt, endApprox, live, vodState, vodUrl, segments }`, times as epoch ms, `endedAt: null` while live); `now` is epoch ms used for open streams; `children` render on the right (e.g. `VodState`). `as="h1"` on detail pages.

## Example

```jsx
const now = Date.now();
const stream = { streamId: 's1', broadcaster: { id: 'b1', login: 'gronkh', displayName: 'Gronkh', avatarUrl: null },
  startedAt: now - 3 * 3600e3, endedAt: null, endApprox: false, live: true, vodState: 'available', vodUrl: null, segments: [] };
<StreamHead stream={stream} now={now}><VodState state="available" /></StreamHead>
```
