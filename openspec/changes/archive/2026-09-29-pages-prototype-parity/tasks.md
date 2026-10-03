# Tasks

Gate for every task: `pnpm typecheck && pnpm lint && pnpm test` from the repo root (lint judged by `rtk proxy pnpm lint` exit code; Biome only, no prettier).

## 1. API

- [x] 1.1 Notifications per D5: `counts`, `nextAttemptAt` and a comma-separated `status` list in `GET /api/notifications`; `POST /api/notifications/retry-failed` reusing the single-retry logic. Files: `apps/server/src/shared/schemas.ts`, `apps/server/src/http/admin.ts`, `apps/server/test/admin.test.ts`, web query helper in `apps/web/src/lib/queries.ts` (mutation). Tests: counts independent of filter; `status=pending,sent` excludes failed; unknown status 400; `nextAttemptAt` set for pending, null otherwise; retry-failed re-queues all failed and returns the count, 0 when none; unauthenticated 401. Done: tests pass; gate passes.
- [x] 1.2 Timeline per D5 and `category-timeline` delta: optional `categoryId`, all segments with `match`. Files: `apps/server/src/timeline/query.ts`, `apps/server/src/http/admin.ts`, `apps/server/src/shared/schemas.ts`, timeline tests, and the web timeline components so they still render (rows filter to `match` when a game is chosen). Tests: no category → recent streams of all games, no `match`; with G → only streams with G, all segments, G flagged; played twice → two flagged; empty `categoryId` → 400. Done: tests pass; gate passes.

## 2. Pages

- [x] 2.1 Subscriptions page per D1 (header, tiles, per-streamer rows incl. missing, detail + "Create again", legend, orphans, mobile cards). i18n en/de. Done: missing subscriptions visible; one solid ink button; gate passes.
- [x] 2.2 History page per D3 (header, retry-all, filter with counts outlined, failed group, row layout, next attempt, mobile retry placement). i18n en/de. Done: gate passes.
- [x] 2.3 Settings page per D4 (sticky save bar with discard, copy callback URL, recipient count, interval hint). i18n en/de. Done: gate passes.
- [x] 2.4 Timeline list per D2 (kicker, recent streams without game, card strip with highlight, outlined Watch, streamer dropdown, outlined selected picks). i18n en/de. Done: gate passes.
- [x] 2.5 Timeline detail per D2 (H1 + kicker, labelled strip with legend fallback, axis with start/end and hour ticks). i18n en/de. Done: gate passes.

## 3. Verification

- [x] 3.1 Review of the branch against this change (server slice, web slices by page).
- [x] 3.2 Smoke run with seeded data on all four pages, DE/EN × light/dark × 375/1280: every scenario of the admin-ui delta visible; no horizontal scroll at 375; no truncated status text; at most one solid ink button per page.
- [x] 3.3 Update the Open Design prototype views (Abos, Zeitleiste incl. detail, Verlauf, Einstellungen) to the implemented state; backup already exists.

## 4. Review and smoke fixes

- [x] 4.1 Server: retry-failed test uses the real outbox retry (asserts attempts 0, nextAttemptAt now, sentAt null); comment that `outbox.retry` shares the sqlite connection with the transaction; `status` parsed once via schema transform; `total` from `counts` (drop the extra query); timeline test for paging without category; web `notificationsQuery` status typed as statuses. Done: gate passes.
- [x] 4.2 Outline buttons and timeline: `buttonVariants` returns merged classes so `outline` links get their border (affects Watch links and attention actions); rows name the game when no game is chosen; picker fallback name from the `match` segment; filtered empty text when filters match nothing; axis tick step from strip width (no overlap at 375); hatch visible on ink segments; detail title in every state and `inkAll` without game; selected game chip not truncated; DE "Neueste Streams". Done: gate passes.
- [x] 4.3 History: filter segments fit at 375 in DE (wrap or 2 columns below `sm`), selected check visible on mobile; attention section loading/error states; retry-all result clears on navigation or after a timeout, no empty spacer. Done: gate passes.
- [x] 4.4 Subscriptions and settings: tiles use the newer of overview and manual sync result; drop `aria-live` on tiles; sync error text ink with icon; paused rows muted by colour, not opacity; next sync short format and minute refresh; remove 9 unused keys; EN uses "sync" consistently; copy fallback for plain HTTP (select + execCommand, hint on failure); copied announcement in a separate sr-only status; callback label not an orphan, copy button described by it; save bar outside the form (`form=` attribute) so it stays visible, discard also clears the recipient draft. Done: gate passes.
- [x] 4.5 Last smoke findings: outline border visible in dark mode (≥ 3:1 against the card, via an existing token, in `components/ui/button.tsx`); the selected timeline game chip is scrolled into view on load at 375; settings save bar clears the mobile bottom nav (no 1 px overlap); subscription issue line in `roster-row.tsx` wraps instead of truncating; a typed but unsaved recipient draft counts as unsaved (save bar says so, discard enabled). Done: gate passes.
