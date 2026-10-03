# Tasks

Gate for every task: `pnpm typecheck && pnpm lint && pnpm test`. Tasks 1–4 are web-only and can ship before task 5; D4 then falls back to `mail: 'none'` until the API field exists (keep `mail` optional in the web code only during that gap, or do task 5 first).

## 1. Header and status tiles

- [x] 1.1 Page header per D1: kicker with weekday/date/time, visible `h1` with ink tab, "Add streamer" as the only solid ink button. Done: `sr-only` h1 removed; gate passes.
- [x] 1.2 `StatusTiles` per D2 replacing `StatusLine`; tiles are `<Link>`s with numeral and caption as separate block lines; failed states use crimson + icon + text. New keys under `overview.*` in en/de (e.g. `tileLive`, `tileOfStreamers`, `tileSubs`, `tileSync`, `tileFailedMails`). Done: each tile navigates to its target (live tile sets `?filter=live` once task 3 lands); 2×2 at 375px without horizontal scroll; gate passes.

## 2. Needs attention

- [x] 2.1 Pure `attentionItems` per D3 in `lib/streamers.ts`. Done: tests in `streamers.test.ts` for: nothing wrong → empty; failed mails; enabled streamer with `error` and with `missing`; paused streamer with `missing` ignored; `pending` ignored; order sync → mails → subscriptions by name; gate passes.
- [x] 2.2 `AttentionList` component, hidden when empty, max 5 rows + "+N more", keys `overview.attention*` in en/de ("Needs attention" / "Braucht Aufmerksamkeit", "View in history" / "Im Verlauf ansehen", "Open subscriptions" / "Abos öffnen"). Done: list appears and disappears via SSE without reload; gate passes.

## 3. Roster search and filter

- [x] 3.1 Pure `filterRoster` and `rosterCounts` per D5. Done: tests for name and login match, case-insensitivity, each filter, combined search + filter, counts; gate passes.
- [x] 3.2 Route search params `q` and `filter` on `/_app/` (validated, defaults omitted from the URL), search field with label, segmented filter with counts, filtered empty state with "Reset filter". Done: a filtered URL can be bookmarked and restores the view; gate passes.

## 4. Plain-text states

- [x] 4.1 Pure `rowStatus`, `subscriptionIssue` and `liveReason` per D4/D6; remove `dotState`/`subscriptionDots`/`DotState` and their tests. Done: tests cover paused wins over live, live since, last live, never, each `liveReason` branch (paused, noMatch default/custom, match sent/failed/pending/none), `subscriptionIssue` null when all enabled; gate passes.
- [x] 4.2 Render the row state line and the subscription issue text in roster rows; render the reason line in the lower third, `failed` linking to `/history?status=failed`. Keys `overview.row*`, `overview.reason*`, `overview.subIssue` (plural) in en/de. Done: no status in the overview is conveyed by colour alone; gate passes.

## 5. API fields

- [x] 5.1 `StreamerMail`, `lastLiveAt` and `mail` in `shared/schemas.ts`; `listStreamers` fills them per D7; migration with `mail_outbox_stream_idx` (`pnpm db:generate`, output committed). Done: route tests for `GET /api/streamers`: `lastLiveAt` = latest `ended_at`, null without streams; `mail` = newest outbox row of the current stream (sent, failed with `error`), null when offline; the web AppType still compiles; gate passes.
- [x] 5.2 `sse.ts`: `notification` also invalidates `streamers`. Done: gate passes.

## 6. Spec and verification

- [x] 6.1 Smoke run with seeded data (one live match with sent mail, one live match with failed mail, one live non-match, one paused, one enabled streamer with a missing subscription, a failed last sync): screenshots of the overview in DE and EN, light and dark, at 375 and 1280 px. Done: every scenario of the admin-ui delta visible in a screenshot; no horizontal scroll at 375.

## 7. Review fixes

- [x] 7.1 Server: test "live without mail → `mail` null"; test for a `pending` row (`at` = `updated_at`); select only `streamId`, `status`, `sentAt`, `updatedAt`, `lastError` from `mail_outbox` in `listStreamers`. Done: tests pass; gate passes.
- [x] 7.2 Web copy and layout: page order header → tiles → attention → on air → roster (D1); `reasonMatchNone` = "Match · no mail yet" / "Treffer · noch keine Mail"; sync tile shows relative time or date when not today (D2); no-result text names the query, "Reset filter" `ghost`; German wording uses "Abo" consistently, "Mail gesendet um {time}", EN "Not live yet"; remove unused `overview.streamers` (repoint i18n.test.ts); `{' '}` before segment counts; drop the leftover `justify-between` wrapper. Done: gate passes.
- [x] 7.3 Web roster controls: debounced search (local state → URL, D5 `use-debounced.ts`); filter as the kit `RadioGroup` styled as segments, no second solid ink button; tests for `parseRosterSearch` (invalid filter dropped, blank `q` dropped, defaults omitted) and `liveReason` with mail sent/failed/pending. Done: tests pass; gate passes.
- [x] 7.4 Smoke-run fixes: status tiles grid exactly 2 columns below `sm` and 4 at `sm`+ (no `auto-fill`) in `status-tiles.tsx`; filter segments: hidden `RadioGroupItem` takes no space (no left gap), four segments fit one row at 375px, search field full width on mobile; `subscriptionIssue` returns null for paused streamers (consistent with `attentionItems`), with test; DE `rowNever` = "Noch nicht live". Done: gate passes.
- [x] 7.5 Nav active state with search params: `app-shell.tsx` nav links (`activeOptions={{ exact: n.to === '/' }}`, ~lines 161 and 189) add `includeSearch: false`, so "Overview" stays `aria-current=page` on `/?filter=live`. Done: gate passes.
