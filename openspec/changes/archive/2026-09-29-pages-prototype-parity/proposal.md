# Proposal

## Why

The Overview now matches the Open Design prototype. A side-by-side comparison of the other four pages (2026-09-29, DE light, 375/1280 px, seeded data) shows the prototype solves real operator problems the app still has, and the app is better in a few places too:

- **Subscriptions:** missing subscriptions are invisible (only existing Twitch subscriptions are listed), each streamer takes three rows, failures carry no explanation, logins truncate on mobile.
- **Timeline:** the page is empty until a game is picked; list cards show only the chosen game's segments, not the stream around it; the detail strip is unlabelled grey blocks (name only in a tooltip) and has no title; several solid ink "Watch from here" buttons per page; the streamer filter is a chip cloud that takes five rows on mobile.
- **History:** no counts on the status filter, failed mails get lost between sent ones, no way to re-queue all failed mails after an SMTP outage, no "next attempt" for pending mails, the retry button squeezes the name on mobile.
- **Settings:** the save bar floats between cards and has no discard, the callback URL cannot be copied, the test mail doesn't say who receives it, the interval range is unknown until an error.

## What Changes

- **Subscriptions:** tiles (last sync, active/expected, next sync + link to the interval setting); one row per streamer (avatar, three event columns, mobile cards) including missing subscriptions; explanation + "create again" (starts a sync) for failing ones; legend; orphaned subscriptions kept.
- **Timeline:** kicker "recording since …"; recent streams of all games without a game; full stream strip on every card with the chosen game highlighted; labelled detail strip with axis and page title; "Watch from here" outlined; streamer filter as a dropdown with checkboxes.
- **History:** filter counts; failed group first ("needs attention"); next attempt time for pending; "retry all failed" as the single primary action; mobile row layout with the retry below the error; selected filter outlined with a check instead of solid ink.
- **Settings:** bottom save bar with unsaved state, save and discard; copy button for the callback URL (wrapping, not truncated); recipient count on the test mail; interval hint 1–168.
- **API:** timeline `categoryId` optional and every segment returned with a `match` flag; notifications page gains `counts` and `nextAttemptAt`; new `POST /api/notifications/retry-failed`.

Kept from the app (better than the prototype): box art and stream title in History rows, recorded-game quick picks with last played, category combobox in Settings, compact mail-language radios, logout only in the app bar, orphaned subscription rows. Not taken: per-mail recipient (not stored), big radio cards, logout in Settings, the prototype's mobile Settings layout (scrolls horizontally).

Non-goals: per-subscription Twitch endpoint, a total stream count on the timeline (API has only `hasMore`), history recipients.

## Capabilities

### Modified Capabilities
- `admin-ui`: Pages (Subscriptions, History, Settings), Timeline page.
- `admin-api`: Endpoints (notifications counts, next attempt, retry-failed), Timeline endpoints (optional category).
- `category-timeline`: Timeline query (optional category, all segments with `match`).

## Impact

- **Server:** `http/admin.ts` (notifications, retry-failed, timeline params), `timeline/query.ts`, `shared/schemas.ts`, tests. No migration expected (`next_attempt_at` exists in `mail_outbox`).
- **Web:** `routes/_app/subscriptions.tsx`, `timeline.index.tsx`, the timeline detail route, `history.tsx`, `settings.tsx`, `components/timeline.tsx`, i18n en/de, new small components where useful. No new dependencies (use existing ui kit: popover/checkbox if present, else a native `<details>`-based dropdown).
