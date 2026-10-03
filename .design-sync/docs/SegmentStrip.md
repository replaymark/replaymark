---
category: Broadcast
---

Proportional bar of all segments of a stream (widths by duration). The segment with `highlightId` (its `categoryId`) is ink, the rest muted; an open (live) segment is hatched. `segments: TimelineSegment[]`, `now` in epoch ms.

## Example

```jsx
<SegmentStrip segments={stream.segments} now={Date.now()} highlightId="g1" />
```
