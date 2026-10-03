# Proposal

## Why

The `overview-ux` change shipped the triage structure of the Open Design prototype ("Übersicht" view), but a side-by-side comparison at 375 and 1280 px shows the implementation still falls short of the prototype where it matters to the operator:

- **Live cards** are flat rows with a gamepad placeholder. The prototype shows who is live (avatar, LIVE badge, duration), what they play (box art, game, title), what happened (reason line with a coloured icon) and a way to watch.
- **Roster rows** show a letter avatar and one line. The prototype shows the real avatar with a live dot, the current game, the game list behind the mode, and an explicit edit button.
- **Needs attention** items are one crimson line each. The prototype names the cause in ink, adds a detail line (the actual SMTP error, what the subscription state means) and outline buttons with an arrow.
- **Roster controls** lack visible labels and a search icon, cannot find a streamer by game, and the sections have no counts.

The data for almost all of this already exists in the `Streamer` DTO (`avatarUrl`, `currentCategory` with `boxArtUrl`, `categories`, `login`, `startedAt`) and in settings (`defaultCategories`).

## What Changes

- **Live cards as cards:** grid (1 / 2 / 3 columns), avatar with live dot, "LIVE" badge, "since 18:40 · 2 h 34 min", box art with game and title, divider, reason line with a state-coloured icon, "Watch ↗" link to the Twitch channel.
- **Roster rows:** real avatar (letter fallback) with live dot; line 1 = state plus current game when live; line 2 = mode plus its game list; a pencil button "Edit" beside the switch (row click keeps working).
- **Needs attention:** card with the heading inside; ink item titles with a crimson icon; a muted detail line (last mail error; plain-language meaning of subscription `error` / `missing`; sync failure hint); outline buttons with an arrow.
- **Roster controls:** visible labels "Search" / "Show", search icon, search also matches the current game and the streamer's game list; counts beside the section headings ("8 streamers", "3 live").
- **Small alignment:** kicker "TODAY · 28 SEPTEMBER · 21:14" style; tile captions "Streamers live", "Last sync ok"; the subscriptions tile turns crimson with icon when active < expected; compact "On air" heading without the tally dot.
- **API:** `Overview.notifications` gains `lastError` (error text of the newest failed mail, or null). Additive.

Kept on purpose (spec wins over prototype): only "Add streamer" is solid ink (the selected filter segment stays outlined with a check); no status by colour alone; state and mode never truncate on mobile.

Non-goals: command palette / Ctrl+K search, icon navigation and "3 live" pill in the app bar, History badge, mobile app bar, per-subscription Twitch error text (not stored today).

## Capabilities

### Modified Capabilities
- `admin-ui`: Pages (Overview description), Overview triage (attention detail, live card content), Roster search and filter (game search, labels, counts).
- `admin-api`: `Overview.notifications.lastError`.

## Impact

- **Web:** `routes/_app/index.tsx` (live card and roster row extracted into `components/live-card.tsx` and `components/roster-row.tsx`), `components/attention-list.tsx`, `components/status-tiles.tsx`, `lib/streamers.ts` (+ tests), `i18n/en.ts`, `i18n/de.ts`. Uses existing `lib/boxart.ts`, `settingsQuery`. No new dependencies.
- **Server:** `GET /api/overview` in `http/admin.ts`, `shared/schemas.ts`, route test. No migration.
- **CSP:** unchanged; avatars and box art come from `static-cdn.jtvnw.net`, already allowed in `img-src`.
