# Design

## Context

v1 keeps one `live_state` row per broadcaster, with the current stream id, category and title. Every write goes through `updateLiveState(deps, broadcasterId, patch, source)` in `apps/server/src/twitch/eventsub.ts`, called by `applyEvent` (EventSub, `source: 'event'`) and by the live sync (`source: 'sync'`, deferring to events within a 5-minute grace period, `EVENT_GRACE_MS`). Inbox rows carry `receivedAt`. Events are retried with backoff, so processing time can lag the receive time by minutes. The Helix client (`apps/server/src/twitch/helix.ts`) already handles the app token, paging and chunking. The cleanup job (`apps/server/src/jobs/cleanup.ts`) runs daily. Settings are key/value rows. The motivation is in proposal.md.

## Goals / Non-Goals

**Goals:**
- One place that turns live-state transitions into stream and segment rows, so events and the live sync cannot diverge.
- Segment boundaries that are exact for events and honestly flagged when approximate.
- VOD lookup that costs a bounded number of Helix calls.

**Non-Goals:**
- Backfilling history from before deployment, or from any undocumented source.
- Recording streamers who are not tracked.
- Showing VODs or clips inside the app (the link goes to Twitch).
- Charts or statistics beyond the per-stream strip.

## Decisions

### D1 Data model
- `streams`: `stream_id` PK, `broadcaster_id`, `started_at`, `ended_at` (null while live), `end_approx` (bool), `vod_id`, `vod_created_at`, `vod_duration_s`, `vod_muted` (JSON `[{offset,duration}]`), `vod_state` (`pending|available|none`), `vod_checked_at`.
- `category_segments`: `id` autoincrement PK, `stream_id` FK (cascade delete), `broadcaster_id`, `category_id`, `category_name`, `started_at`, `ended_at` (null = open), `start_approx`, `end_approx`. Indexes on `(category_id, started_at)` and `(stream_id, started_at)`.
- Box art and names come from the existing `categories` table when present. Otherwise `category_name` is stored on the segment and box art is built from the id via the existing box-art helper. `likely_expired` is computed at read time (ended more than 60 days ago), not stored.
- The migration is created with `pnpm db:generate` as 0003.

### D2 Recorder at the single write point
A pure `recordTransition(prev, next, at, approx)` is called inside `updateLiveState`, in the same transaction as the live-state upsert. It diffs the previous and next rows and writes:
- **offline → live** (stream id set): insert the stream (`started_at` = event `started_at`, or `at` for sync). No segment yet.
- **live, category known, and no open segment for this stream:** open the first segment. For an event, it starts at the stream's `started_at`; for a sync, at `at`, marked approximate. This means the stale category left over from the previous stream is never recorded. `stream.online` sets the stream id before the channel fetch, and the first category after that opens the segment at stream start.
- **live, category changed, open segment exists:** close the segment at `at` and open a new one at `at`.
- **live → offline, or a new stream id:** close the open segment and the stream at `at`. For a sync, both ends are marked approximate.
- **Title-only change:** nothing happens.

Alternative considered: logging raw events and deriving segments at read time. Rejected, because the live sync gaps and grace logic would have to be re-implemented in the query.

### D3 Event time plumbing
`applyEvent` gets `at` from the inbox row's `receivedAt`, and from `started_at` for `stream.online`. It passes `at` to `updateLiveState` through a new optional parameter. The live sync passes `clock.now()` with `approx = true`. A guard ignores a transition whose `at` is earlier than the open segment's start, so events processed out of order cannot create negative or overlapping segments. Such a transition still updates the live state as before.

### D4 VOD resolver job
A scheduler job runs every 10 minutes and whenever `stream.offline` has been handled. It picks up to 10 streams where `vod_state = 'pending'` and `vod_checked_at` is older than 1 h (or null), grouped by broadcaster. For each broadcaster it makes one call to `GET /helix/videos?user_id=<id>&type=archive&first=100`, then matches the videos by `stream_id`. If a match is found, it sets the state to `available` and stores the id, `created_at`, duration (parsed from Twitch's `1h2m3s` format) and `muted_segments`. If no match is found and the stream ended more than 7 days ago, it sets `none`. Otherwise it only updates `vod_checked_at`. Live streams are included, since the archive exists while live. Errors are logged and never thrown. The job only uses `getVideos`, which is added to the Helix client.

### D5 Offsets and links
The pure function `deepLink(vod, segmentStart, approx)`:
- `offset = segStart − vod_created_at`, minus 60 s if approximate.
- The offset is clamped to `[0, duration]`.
- Below 10 s, no `t` parameter is added.
- Otherwise it adds `?t=<h>h<m>m<s>s`, dropping zero hours.

`muted` is true when `[segStart, segEnd]` (as offsets) intersects any muted range. Everything is unit-tested with fixed numbers.

### D6 API shapes
The Zod schemas in `shared/schemas.ts` cover `TimelineQuery`, `TimelineStream`, `TimelineSegment`, `RecordedCategory` and `StreamDetail`. Times are epoch ms, and the UI formats them in the browser's local time zone. Pagination is 20 streams per page, with `hasMore`. The streamer filter is applied in SQL. SSE: a new bus event type `timeline` (payload `{ streamId }`) is emitted on segment writes and VOD resolution, and the web client invalidates the timeline keys on it and on `live-state`. This keeps the meaning of existing events unchanged.

### D7 Settings and cleanup
The setting key `segment_retention_days` defaults to 365. Cleanup deletes streams with `ended_at < now − days` when days > 0, and cascade removes their segments. Foreign keys are already enforced (`PRAGMA foreign_keys=ON`; this is verified in the task).

### D8 UI
- New route `/_app/timeline` with search params `{ categoryId?, streamers?, from?, to?, page? }` (validated), and `/_app/timeline/$streamId` for the detail view.
- The game picker reuses `CategoryPicker` in single-select mode (a prop on the existing component) plus a row of chips for the recorded categories.
- Cards use the existing streamer avatar and tally lamp. The strip is a flex row of segments sized by duration: the chosen game in ink, others muted, the live tail hatched. Gaps without a category (time not covered by any segment) are ignored: the strip is proportional to the summed segment durations, not to wall-clock stream time.
- The "Watch from here" link uses `target="_blank" rel="noopener noreferrer"`.

## Risks / Trade-offs

- [Twitch shifts the VOD start by a few seconds relative to `started_at`] → the offset is based on the VOD's `created_at`, not the stream start. Links for approximate starts begin 60 s earlier.
- [VOD deleted or expired before 60 days (7 days for non-Affiliates)] → the state stays `available` until 60 days have passed. The link then 404s at Twitch, and the UI tooltip says VODs can expire earlier. There is no extra polling.
- [Service down during a category change] → the boundary is recorded at the next sync and marked approximate. The downtime is not filled.
- [`Get Videos` returns only the last 100 archives] → the resolver runs every 10 min, so streams are matched long before they drop out of the first page.
- [Recording all categories grows the table] → a few rows per stream. Retention is 365 days by default and indexed.
- [Out-of-order processing after retries] → the D3 guard. Tests cover it.

## Migration Plan

1. Migration 0003 is applied automatically at startup. Nothing is backfilled, and recording starts with the next event.
2. Rollback: deploy v1 again. Its code does not use the new tables, which stay in place, and the migration journal does not block it. A later re-deploy continues where it stopped.
