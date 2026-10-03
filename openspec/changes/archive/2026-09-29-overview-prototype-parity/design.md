# Design

Reference: Open Design project "Optimiere Das Design Erstelle Einen Prototypen", `index.html`, view `#/` ("Übersicht"). Screenshots of prototype and implementation at 375/1280 px were compared on 2026-09-29. Where the prototype conflicts with `admin-ui` (single solid ink button, no colour-only states, no truncation of state/mode on mobile), the spec wins.

## D1 Live card (`components/live-card.tsx`)

Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, gap as the status tiles. One card per live streamer, existing card surface tokens.

- **Head:** avatar 40 px round (`avatarUrl`, fallback initial letter as in the roster) with a tally-red live dot bottom-right; display name (bold, not condensed caps); below it "since 18:40 · 2 h 34 min" / "seit 18:40 · 2 Std. 34 Min." (`startedAt`, duration from D6, refreshed by the page's existing `useNow`). Right: a "LIVE" pill (outline, tally dot + text).
- **Body:** box art 45×60 via `boxArt(currentCategory.boxArtUrl, 90, 120)` from `lib/boxart.ts`, fallback a neutral tile with the gamepad icon; game name (bold) and stream title (muted, `line-clamp-2`; the title is content, not state, so clamping is allowed).
- **Foot:** divider, then the reason line (existing `ReasonLine` moved here) and a "Watch ↗" / "Ansehen ↗" text link to `https://www.twitch.tv/{login}`, `target="_blank" rel="noopener noreferrer"`. Below `sm` the link sits under the reason line; from `sm` up to its right when it fits (`flex-wrap`).
- **Reason icon colours:** sent → `--status-enabled` with a check-circle; pending → `--status-pending` with a clock; failed → `--status-error` with the mail-x icon, text is the link to `/history?status=failed`; no match and paused → muted foreground with minus-circle / pause.
- no mail yet → muted `CircleDashed` Text unchanged from `overview-ux`.
- The old full-width row, left red bar and right red dot are removed.

## D2 Roster row (`components/roster-row.tsx`)

- **Avatar:** 40 px round image from `avatarUrl`, fallback initial letter; tally-red dot when live.
- **Line 1 (state):** `rowStatus` text; when live, append " · {currentCategory.name}" if known.
- **Line 2 (mode):** mode label + " · " + game list: custom → names of `categories`; default → names of `settings.defaultCategories` (`settingsQuery`); any → label only ("Any game" / "Jedes Spiel"). A paused row shows no mode line (as today).
- **Subscription issue line:** unchanged.
- **Right:** switch (unchanged) and a ghost icon button with the pencil icon, `aria-label` "Edit {name}" / "{name} bearbeiten", opening the same dialog as the row click. Clicks on switch and pencil do not bubble to the row.
- **No truncation:** state and mode lines wrap on every width (`break-words`); the game list may wrap to several lines. The name may truncate.

## D3 Needs attention (`components/attention-list.tsx`)

- One card (existing surface) with the heading "Needs attention" inside, items separated by dividers.
- **Item:** crimson alert icon + title in ink, `font-semibold`; below it a muted detail line; action button right from `sm`, below the text on mobile, `variant="outline"` with a trailing arrow-right icon.
- **Titles and details:**
  - failed mails: "2 mails not delivered" / "2 Mails nicht zugestellt"; detail "Last: {lastError}" / "Zuletzt: {lastError}" when `overview.notifications.lastError` is set.
  - subscription error: "Subscription failed: {name}, {types}" / "Abo fehlgeschlagen: {name}, {types}"; detail "Twitch rejected the subscription. Check that /webhook is reachable through the reverse proxy, then sync." / "Twitch hat das Abo abgelehnt. Prüf, ob /webhook über den Reverse Proxy erreichbar ist, und gleiche dann ab."
  - subscription missing: "Subscription missing: {name}, {types}" / "Abo fehlt: {name}, {types}"; detail "The next sync creates it; sync now to fix it immediately." / "Der nächste Abgleich legt es an; jetzt abgleichen behebt es sofort."
  - sync failed: "Last sync at {time} failed" / "Letzter Abgleich um {time} fehlgeschlagen"; detail the sync error if `lastSync` carries one, else none.
- Button labels unchanged ("View in history", "Open subscriptions") plus arrow. Max 5 + "+N more" unchanged.

## D4 Roster controls and section heads

- Search: visible `<label>` "Search" / "Suchen" above the input, magnifier icon inside the input (left padding), placeholder "Name or game" / "Name oder Spiel". Full width on mobile, `sm:max-w-md` above.
- Filter: visible label "Show" / "Anzeigen" above the `RadioGroup`; segment text "All (8)" style is not adopted — keep "All 8" with the count in a muted span; selected segment stays outlined with check (no solid ink).
- `filterRoster` matches `q` against display name, login, `currentCategory.name`, and the names of the streamer's game list (custom: `categories`; default: default categories passed in). Signature gains an optional `defaults: readonly Category[]`.
- Section heads: "On air" / "Auf Sendung" in the same size as "All streamers" (no tally dot, no display size), right-aligned muted count "3 live"; "All streamers" with "8 streamers" / "8 Streamer" right-aligned.

## D5 Header and tiles

- Kicker: "TODAY · 28 SEPTEMBER · 21:14" / "HEUTE · 28. SEPTEMBER · 21:14 UHR" (`Intl.DateTimeFormat` day+month long, no year, no weekday). Uppercase via existing `kicker` class.
- Live tile caption "Streamers live" / "Streamer live" (drop "of N"; the total moves to the roster head).
- Subscriptions tile: crimson numeral + alert icon + caption when `active < expected`, else ink.
- Sync tile: caption "Last sync ok" / "Letzter Abgleich ok" on success, failure as today.

## D6 Pure helpers (`lib/streamers.ts`)

- `liveDuration(startedAt: string, now: Date): { hours: number; minutes: number }` (floor, never negative).
- `gameList(s: Streamer, defaults: readonly Category[]): string[]` (names, as D2).
- `filterRoster(list, q, defaults?)` per D4.
Rendering strings stays in components via i18n.

## D7 API

`Overview.notifications.lastError: string | null` in `shared/schemas.ts`; `GET /api/overview` selects `last_error` of the `mail_outbox` row with `status = 'failed'` ordered by `updated_at desc, id desc`, limit 1. No migration.

## Risks

- Avatar and box art load from `static-cdn.jtvnw.net`; CSP already allows it. Broken URLs fall back via `onError`.
- The default game list needs `settingsQuery` on the overview; it is small and already cached by the settings page.
