# Proposal

## Why

Mails say that a streamer went live with or switched to a wanted game, but afterwards it is hard to find *when* they played it. A 10-hour stream may contain just 20 minutes of the game. The operator wants to pick a game and see every stream in which tracked streamers played it, with the exact time window and a link that opens the VOD at that moment. Twitch's official API has no category history for past broadcasts: Helix `Get Videos` has no chapter or segment field, and `Get Channel Information` returns only the current or last game. So the only allowed source is our own recording, and every day without it is history lost.

## What Changes

- Record **every** category a tracked streamer plays while live (all games, not only the configured ones) as time segments with start and end. Segments come from the EventSub events the service already receives. The startup and interval live sync fills gaps and marks those segments as approximate.
- Record one row per stream (id, broadcaster, start, end) and resolve its archive VOD through the official Helix `Get Videos` endpoint, matched by `stream_id`.
- New admin API endpoints: the timeline filtered by game (optionally by streamers and date range), the segments of one stream, and the list of categories seen in the recorded data.
- New admin UI page "Timeline" / "Zeitleiste" (EN/DE). The user picks a game from the Twitch category search or from the games already recorded. The page lists the matching streams, newest first, with the segment windows, the duration and a VOD deep link (`https://www.twitch.tv/videos/<id>?t=1h2m3s`). A per-stream view shows all segments of one stream as a strip.
- Graceful VOD states: no VOD (archiving off), VOD not found yet, VOD probably expired, stream still live. A muted-audio hint appears when a segment overlaps Twitch's `muted_segments`.
- New setting: segment retention in days (default 365, 0 = keep forever), enforced by the daily cleanup.
- Explicit non-goal: no scraping, no unofficial or undocumented Twitch API (e.g. GQL VOD chapters), and no third-party trackers. History before deployment is not available.

## Capabilities

### New Capabilities
- `category-timeline`: recording streams and category segments from events and the live sync, resolving VODs, computing deep-link offsets, and query semantics.

### Modified Capabilities
- `admin-api`: new timeline endpoints, and a segment-retention field in settings.
- `admin-ui`: new Timeline page with a per-stream view, a navigation entry, and the retention setting on the Settings page.
- `operations`: housekeeping removes segments and streams older than the configured retention.

## Impact

- **Server:** new tables `streams` and `category_segments` (migration 0003). Recording hooks into the single live-state writer (`updateLiveState` in `apps/server/src/twitch/eventsub.ts`), which both the events and the live sync use. The Helix client gets `getVideos`. Also affected: new admin routes and shared schemas, the settings row, and the cleanup job.
- **Web:** new route `/_app/timeline` plus a stream detail view, a nav item, and new query keys (SSE `live-state` also invalidates the timeline). Every string is in both en.ts and de.ts.
- **Twitch API usage:** extra `Get Videos` calls, bounded and cached per stream. They use the existing app token; no new scopes are needed.
- **Dependencies:** none new.
- **Data volume:** a few rows per stream. Negligible for SQLite.
