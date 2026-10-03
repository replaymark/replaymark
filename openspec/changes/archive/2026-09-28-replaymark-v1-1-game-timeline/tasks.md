# Tasks

## 1. Recording

- [x] 1.1 Schema and migration 0003 per D1 (`streams`, `category_segments`, indexes, cascade FK). Check that `PRAGMA foreign_keys` is on in `db/client.ts`, and enable it if not. Done: `pnpm db:generate` output committed; a migration test on a fresh DB creates both tables; gate passes.
- [x] 1.2 Pure recorder `recordTransition` per D2/D3, called from `updateLiveState` in the same transaction, with the optional `at`/`approx` parameters. `applyEvent` passes the inbox `receivedAt` (and `started_at` for online); the live sync passes `now` with approx. Done: unit tests cover the spec scenarios (switch after a long stream, title-only, offline change, retried event keeps the 20:00:00 boundary, missed offline, category changed during downtime, stale category from the previous stream not recorded, out-of-order guard); existing notification tests still pass; gate passes.

## 2. VOD resolution

- [x] 2.1 Helix `getVideos(userId, {type:'archive', first:100})` with a parser for the duration string (`1h2m3s`) and `muted_segments`, plus the pure functions `deepLink` and `isMuted` per D5, and `vodState` (including computed `likely_expired`). Done: unit tests with the spec examples (`?t=2h12m30s`, under 10 s gives no `t`, approx −60 s clamped at 0, clamped to the duration, muted overlap); gate passes.
- [x] 2.2 Resolver job per D4, registered in the scheduler (every 10 min, and triggered after `stream.offline`), which publishes the `timeline` bus event on changes. Done: tests with a fake Helix: match by stream id; no match within 7 days stays `pending` and is rechecked at most once an hour; after 7 days it becomes `none`; a live stream is matched; Helix errors are swallowed and logged; gate passes.

## 3. Admin API

- [x] 3.1 Shared schemas plus `GET /api/timeline`, `GET /api/timeline/streams/:streamId` and `GET /api/timeline/categories` per D6 and the admin-api delta, and the new `timeline` event type in `shared/events.ts`, emitted by the recorder. Done: route tests: filter by category, filter by streamers and date range, newest first, 20 per page with `hasMore`, only the queried category's segments with links, 400 with no `categoryId`, 401 with no session, 404 for an unknown stream, categories list ordered by last played; the AppType still compiles for web; gate passes.
- [x] 3.2 `segmentRetentionDays` in `GET|PUT /api/settings` (0–3650, default 365). Done: tests for the default, a valid save, and 400 for 5000; gate passes.

## 4. Housekeeping

- [x] 4.1 Cleanup removes streams ended longer ago than the retention (when retention > 0), with their segments cascaded, and never touches open streams. Done: the spec's cleanup scenarios as tests (365 days, 0 = keep, live stream kept); gate passes.

## 5. Admin UI

- [x] 5.1 Timeline page and stream detail per D8 and the admin-ui delta: nav entry, URL search params, single-select `CategoryPicker` plus recorded-category chips, streamer multi-select, date range, stream cards with segments, VOD states and hints, "Watch from here" link, proportional strip in the detail view, empty state explaining that recording starts at deployment, and SSE invalidation on `timeline` and `live-state`. Every string is in en.ts and de.ts. Done: unit tests for any extracted pure logic (duration formatting, strip proportions, search param mapping); gate and build pass; smoke run with seeded streams and segments (including a live one, a `none` VOD and a muted segment): screenshots of the timeline and the detail view in EN and DE, light and dark, at 375 and 1280 px, with no horizontal scroll at 375.
- [x] 5.2 Retention field on the Settings page (0 = "keep forever" / "unbegrenzt behalten"). Done: gate passes; screenshot at 375 px in DE.
- [x] 5.3 README: new section "Zeitleiste" (what is recorded, from when, VOD requirements and expiry, no unofficial sources), and new entries under "Designentscheidungen" (official sources only, event time vs. processing time, approximate boundaries, resolver limits). Done: sections present; gate passes.

## 6. Verification

- [x] 6.1 Extend the scratch E2E harness (fake Twitch plus `videos` endpoint): a stream with Just Chatting → game G → Just Chatting → offline, a second streamer with G, and a restart with a category change during downtime. Check `GET /api/timeline?categoryId=G` for exact and approximate boundaries and correct `?t=` links, and that notifications behave exactly as before (existing 18 checks still pass). Done: report lists each spec scenario of `category-timeline` with evidence.

## 7. Fixes from E2E

- [x] 7.1 Pausing (`PATCH enabled=false`) or deleting a streamer who is live closes the open stream and its open segment with the current time as an approximate end (via `updateLiveState`/the recorder, in the same transaction as today's live-state change; for DELETE, before the `live_state` row goes). Done: route tests for pause-while-live and delete-while-live (stream `ended_at` set, `end_approx=1`, segment closed, `timeline` event published); no mail change; gate passes.
- [x] 7.2 The timeline empty state shows the recording start date (spec "Stream before deployment"): persist a `timeline_recording_since` setting the first time the server starts with this version (never overwritten), expose it in the timeline API response, and render it localized in the empty-state text. Done: server test (set once, survives restart, returned by the API); web shows the date in EN and DE; gate and build pass.

## 8. Fixes from final review

- [x] 8.1 Resolver refreshes `available` VODs while the stream is live and once after it ends (same hourly gate), updating `vodDurationS` and `vodMuted`; `query.ts` clamps against `max(vodDurationS, ((endedAt ?? now) - vodCreatedAt)/1000)`; pending order newest first; `queryTimeline` reads `recordingSince` without writing; latest category name instead of `max()`. Done: test "matched while live at 600 s, ended, refreshed, segment 2 h in links to `?t=2h…`"; gate passes.
- [x] 8.2 Recorder: open at the stream start only for the category fetched right after `stream.online`, otherwise at `at` (M1); a stale stream closed by a new `stream.online` gets `endApprox=true` (M2); a stream reported live again after pause/delete is reopened with an approximate segment start (M3); `recordTransition` reports the touched stream ids so every one gets a `timeline` event. Done: unit tests for each; gate passes.
- [x] 8.3 Spec and docs: admin-api delta says `from`/`to` are epoch ms, inclusive, matched against stream start (M4); the card shows the VOD state label also for `available` (M5); README: per-stream recheck at most hourly, whole ended streams deleted counted from their end (M6); segment React keys include the index; the strip ignoring gaps is noted in design.md. Done: gate and build pass.
