# Proposal

## Why

The overview answers "who is live" well, but not the questions the operator actually opens it for:

- **Is something broken?** Failed mails and broken subscriptions hide in a one-line status text and in coloured dots that only explain themselves on hover.
- **Why did (or didn't) a mail go out?** A live card shows a "matches" check, but not whether a mail was sent, failed or never triggered, nor why a stream did not match.
- **Where is streamer X?** The roster has no search or filter; with 20+ streamers the operator scrolls.

The clickable prototype (Open Design project, "Übersicht" view) resolves these with status tiles, an attention list, plain-text states and a filterable roster. This change ports that overview into `apps/web`, keeping the Replaymark design system unchanged.

## What Changes

- **Status tiles instead of the status line:** four link tiles: live now → roster filtered to live, subscriptions active/expected → Subscriptions page, last sync (time + ok/failed) → Subscriptions page, failed mails → History filtered to `failed`. Each tile states its state in text; colour is secondary.
- **"Needs attention" / "Braucht Aufmerksamkeit":** a list above the roster, shown only when something is wrong: failed mails, streamers with a subscription in `error` or `missing`, a failed last sync. Each item names the cause and links to the page that fixes it. Hidden when empty (no "all good" banner).
- **Live cards say what happened:** the lower third gets a reason line: "Match · mail sent 18:59", "Match · mail failed", "Match · mail queued", "No match · not a default game", "No match · not in the custom list", "Paused · triggers no mails".
- **Roster search and filter:** a search field (name/login) and a segmented filter All / Live / Active / Paused with counts. State lives in the URL (`?q=&filter=`).
- **Plain-text row state:** each row states "Live since 18:42", "Last live: Tue 23:10", or "Paused · triggers no mails", plus the mode text. The subscription dots are replaced by a text state that only appears when not all subscriptions are enabled ("1 subscription failing").
- **Page header:** visible condensed title with the ink tab and a kicker with date and time; "Add streamer" is the single primary ink button of the view.
- **API:** `Streamer` gains `lastLiveAt` and `mail` (status of the notification for the current stream). Both are additive.

Non-goals: command palette, mobile bottom navigation, changes to other pages, per-subscription repair endpoint. They are listed in design.md under "Later".

## Capabilities

### Modified Capabilities
- `admin-ui`: the Overview part of the Pages requirement changes; new requirements for triage and roster filtering.
- `admin-api`: `Streamer` DTO gains `lastLiveAt` and `mail`.

## Impact

- **Web:** `routes/_app/index.tsx` (split into components), new pure helpers in `lib/streamers.ts` with tests, new strings in `i18n/en.ts` and `i18n/de.ts`. No new dependencies.
- **Server:** `listStreamers` in `http/admin.ts` reads `max(streams.ended_at)` and the latest `mail_outbox` row per live `stream_id`; `shared/schemas.ts` gets the two fields. New index on `mail_outbox.stream_id` (migration).
- **SSE:** no new event types; `notification` must also invalidate `streamers` so the live-card mail line updates.
