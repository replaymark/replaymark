# Design

Reference: Open Design backup `prototype-2026-09-28.html` (original prototype views Abos, Zeitleiste, Verlauf, Einstellungen) and the comparison screenshots in the session scratchpad (`pages/{proto,app}-*.png`). Constraints from `admin-ui`: one solid ink button per view, no colour-only state, tally red only for live, 375 px without horizontal scroll or truncated status text, EN/DE.

## D1 Subscriptions page (`routes/_app/subscriptions.tsx`)

- **Header:** visible title + kicker as on the Overview; "Sync now" stays the single solid ink button (right on desktop, under the title on mobile, like the Overview header).
- **Tiles** (reuse the `StatusTiles` tile look, own component or a shared `Tile`): last sync (time + ok/failed with icon; failed text from `lastSync.errors`), active/expected (crimson + icon when below), next sync = `lastSync.at + syncIntervalHours` ("in 3 h" / time) with a link "change" to `/settings`.
- **Rows:** one per streamer from `streamersQuery` (so `missing` shows), sorted by name; avatar (`StreamerAvatar`), name + login (login wraps, no truncation), then one cell per event type (`stream.online`, `stream.offline`, `channel.update`) with icon + text state (enabled check-circle green icon, pending clock amber, error alert crimson, missing circle-dashed muted). Paused streamers: row muted with "Paused · no subscriptions needed" instead of cells.
- **Failing row:** below the cells a detail line: error → "Twitch rejected the subscription (status {raw}). Check that /webhook is reachable through the reverse proxy." (raw status from `GET /api/subscriptions` where available); missing → "Not created yet. The next sync creates it." Plus an outline button "Create again" that calls the existing sync mutation.
- **Orphans:** subscriptions from `/api/subscriptions` without a known streamer stay as extra rows ("Unknown ({id})") under a small heading.
- **Legend** under the table: the four states with icon + text.
- **Mobile (<`sm`):** each streamer is a card: head (avatar, name, login), then the three events as a definition list (event label left, state right, wrapping).

## D2 Timeline (list `routes/_app/timeline.index.tsx`, `components/timeline.tsx`, detail route)

- **API** (see D5): `categoryId` optional; every stream carries all segments with `match`.
- **Header:** title + kicker "Recording since {date}" from settings/`recordingSince` (whatever the app already exposes; check `schemas.ts`), hidden when unknown.
- **No game chosen:** results show recent streams (first page) under the heading "Recent streams"; rows list every segment; the empty state stays for no data.
- **Card strip:** a proportional horizontal strip of all segments (reuse the detail strip component) above the rows; matching segments in ink, others muted, live open segment hatched; labels inside segments where width allows (≥ 56 px), otherwise none (names are in the rows).
- **Rows:** only `match` segments when a game is chosen, else all. "Watch from here" is `variant="outline"` size sm with external-link icon.
- **Detail page:** H1 "Stream on {date}" / "Stream am {date}" + kicker streamer name; strip with visible labels (game name, truncated inside the segment with the full name in a legend below for narrow segments) and an axis with start and end time (and hour ticks when ≥ 3 h); list as today.
- **Streamer filter:** replace the chip cloud with a dropdown button "Streamers: all" / "Streamers: 2" opening a popover with a checkbox list (existing ui `popover`/`checkbox` if present; else a disclosure panel). URL param unchanged.
- **Selected game quick pick / "All" chip:** selected state outlined with check (no solid ink) so the page keeps at most one solid ink element (none needed here).

## D3 History (`routes/_app/history.tsx`)

- **Header:** title + kicker; "Retry all failed" solid ink button, only when `counts.failed > 0`, confirms nothing (idempotent), shows loading, toast/inline result "3 mails queued again".
- **Filter:** segments All / Pending / Sent / Failed with counts from `counts` ("Failed 3"), selected outlined with check (same pattern as the Overview roster filter), order All, Failed, Pending, Sent.
- **Grouping:** with filter All, page 1 starts with "Needs attention" (query `status=failed`, all failed mails, up to one page) followed by "All mails" (query `status=pending,sent`, paginated). With a single-status filter only that list is shown.
- **Row:** box art 30×40, streamer, game, stream title (wraps to 2 lines max), time, status with icon + text, attempts, error text (crimson icon, text ink), for pending "Next attempt {time}" from `nextAttemptAt`; "Retry" outline button: right on desktop, below the error on mobile.

## D4 Settings (`routes/_app/settings.tsx`)

- **Save bar:** sticky at the bottom of the viewport (above the mobile bottom nav), shown always; left the state text ("All changes saved" / "Unsaved changes" with a pending-coloured icon), right "Discard" (ghost, disabled when clean) and "Save" (the single solid ink button, disabled when clean or invalid). Discard resets the form to the last loaded settings.
- **Callback URL:** read-only mono text that wraps (`break-all`), plus an outline "Copy" button (clipboard API, "Copied" feedback for 2 s).
- **Test mail:** helper text "Goes to the saved recipients ({n})".
- **Interval:** helper text "1 to 168 hours".
- Section cards and the rest unchanged.

## D5 API

- `GET /api/timeline`: `categoryId` optional (empty string → 400). Query in `timeline/query.ts`: without category, streams in filter newest first; with category, streams having ≥1 segment of it; return all segments per stream with `categoryId`, `categoryName`, `boxArtUrl` as the detail endpoint does, plus `match: boolean`. Update the web types.
- `GET /api/notifications`: response gains `counts: { all, pending, sent, failed }` (one grouped count query, independent of the status filter) and each item `nextAttemptAt: string | null` (ISO) from `mail_outbox.next_attempt_at` when pending.
- `status` accepts one status or a comma-separated list (`pending,sent`); unknown values → 400.
- `POST /api/notifications/retry-failed`: for every `failed` row do exactly what the single retry does (same helper), in one transaction; respond `{ requeued: n }`; wake the outbox worker like the single retry; emit the same SSE event.
