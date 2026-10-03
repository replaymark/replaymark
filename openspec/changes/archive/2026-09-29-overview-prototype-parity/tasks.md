# Tasks

Gate for every task: `pnpm typecheck && pnpm lint && pnpm test` from the repo root (lint judged by `rtk proxy pnpm lint` exit code; Biome only, no prettier).

## 1. API

- [x] 1.1 `Overview.notifications.lastError` per D7 in `apps/server/src/shared/schemas.ts` and `GET /api/overview` in `apps/server/src/http/admin.ts`. Tests in `apps/server/test/admin.test.ts`: newest failed mail's error returned; null without failed mails. Fix web fixtures that build an `Overview`. Done: tests pass; gate passes.

## 2. Pure helpers

- [x] 2.1 `liveDuration`, `gameList`, and `filterRoster` with game matching per D4/D6 in `apps/web/src/lib/streamers.ts`. Tests in `streamers.test.ts`: duration floors and never negative; game list for custom / default / any; search matches current game, custom-list game, default-list game (with defaults passed) and still name/login. Done: tests pass; gate passes.

## 3. Components

- [x] 3.1 `components/live-card.tsx` per D1 (move `LowerThird`/`ReasonLine` out of `routes/_app/index.tsx`), grid in the on-air section, coloured reason icons, Watch link. i18n keys `overview.watch`, `overview.liveBadge`, `overview.since`, `overview.duration*` in en/de. Done: gate passes.
- [x] 3.2 `components/roster-row.tsx` per D2 (avatar image + fallback + live dot, state line with current game, mode line with game list via `gameList` and `settingsQuery`, pencil button). i18n keys `overview.edit`, `overview.modeAny` if missing, en/de. Done: gate passes.
- [x] 3.3 `components/attention-list.tsx` per D3 (card with heading inside, ink titles, detail lines, outline buttons with arrow). i18n keys `overview.attention*` updated in en/de. Done: gate passes.
- [x] 3.4 Roster controls and section heads per D4, header kicker and tiles per D5 (`routes/_app/index.tsx`, `components/status-tiles.tsx`). Pass default categories to `filterRoster`. Done: gate passes.

## 4. Verification

- [x] 4.1 Smoke run with seeded data (avatars/box art as `static-cdn.jtvnw.net` URLs plus one streamer without avatar and one game without box art; live match sent, live match failed with error, live match pending, live no-match, paused, missing subscription, failed sync): screenshots DE/EN × light/dark × 375/1280. Done: every D1–D5 element visible; no horizontal scroll at 375; state/mode lines not truncated; only one solid ink button.
- [x] 4.2 Review of the branch against this change (server and web slices).

## 5. Review and smoke fixes

- [x] 5.1 Live card and images: state colour only on the reason icon (text ink/muted; failed link stays crimson); Watch link accessible name "Watch {name} on Twitch (opens in a new tab)" / "{name} auf Twitch ansehen (öffnet neuen Tab)"; Watch link on its own line below `sm`; drop `truncate` on the timing line; "match · no mail yet" gets a distinct muted icon (e.g. `CircleDashed`); `BoxArt` in category-picker gains the `onError` fallback and is reused by the live card; image error state resets when the URL changes (`key={url}`) in box art and `streamer-avatar.tsx`. Update D1 for the no-mail icon. Done: gate passes.
- [x] 5.2 Rows, attention, copy: remove dead `stopPropagation`/biome-ignores in `roster-row.tsx`, keep `relative z-10`; overlay button `tabIndex={-1}` so the pencil is the single keyboard path; `break-words` on attention detail lines; drop redundant `text-foreground`; capitalise every tile caption in en/de; pluralise the failed-mails caption; smoother German ("Prüfe, ob …", "…; ein Abgleich jetzt behebt es sofort."); D2 wording "Any game". Done: gate passes.
