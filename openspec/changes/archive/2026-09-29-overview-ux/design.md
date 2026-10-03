# Design

Reference: the Open Design prototype, "Übersicht" view (`/home/mirko/open-design/.od/projects/c84fa4f7-fbcb-4c49-9972-d685c6dc7f23/index.html`). It shows the target layout and copy; this document fixes what the code does.

## Constraints (unchanged design system)

- Tally red only for live (`TallyLamp`, `LiveBadge`). Errors use crimson plus an icon. Status is never colour alone.
- One solid ink primary button per view: "Add streamer" / "Streamer hinzufügen".
- Radius 8px, `.surface` cards, 1px rules, 150ms transitions, `prefers-reduced-motion` respected.
- Every string in `en.ts` and `de.ts`. German copy: short, factual, no exclamation marks.
- 375px: no horizontal scroll; tiles go 2×2, the filter wraps below the search.

## D1 Page order

1. Header: kicker (weekday, date, time via `useFormat`), visible `h1` "Overview"/"Übersicht" with the ink tab, primary button "Add streamer" right-aligned.
2. Status tiles (D2).
3. Needs attention (D3), only when it has items.
4. On air: the existing lower thirds with the reason line (D4). Keep `useJustWentLive`.
5. All streamers: search + filter (D5), rows (D6).

## D2 Status tiles

Replace `StatusLine` with `StatusTiles`: a `<ul>` of four `<Link>` tiles (grid `repeat(auto-fill, minmax(min(100%, 180px), 1fr))`, 12px gap). Each tile has a numeral (display font, `clamp()`, `nowrap`) above a caption, each on its own block line.

| Tile | Value | Caption | Target |
|---|---|---|---|
| Live | `streamers.live` | "live now" / "of N streamers" | `/` with `?filter=live` |
| Subscriptions | `active/expected` | "subscriptions active" | `/subscriptions` |
| Last sync | relative time | "ok" or "failed" + icon | `/subscriptions` |
| Failed mails | `notifications.failed` | "failed mails" | `/history?status=failed` |

The failed-mail and sync tiles show a crimson icon and text when non-zero/failed; otherwise neutral. The live numeral only gets tally red via a `TallyLamp` when `live > 0`.

## D3 Needs attention

Pure function `attentionItems(overview, streamers): AttentionItem[]` in `lib/streamers.ts`:

```ts
type AttentionItem =
  | { kind: 'failedMails'; count: number }                 // → /history?status=failed
  | { kind: 'subscription'; streamer: Pick<Streamer,'id'|'displayName'>; types: SubscriptionType[]; state: 'error'|'missing' } // → /subscriptions
  | { kind: 'syncFailed'; at: string; errors: string[] };   // → /subscriptions
```

Order: syncFailed, failedMails, then subscription items by display name. Only enabled streamers produce subscription items (paused ones are expected to have none). `pending` is not an attention item. Render as a `.surface` list with `divide-y`; each row: crimson icon, cause text, link button ("View in history", "Open subscriptions"). Max 5 rows, then "+N more" linking to `/subscriptions`.

The raw Twitch status from `GET /api/subscriptions` is not needed here; the Subscriptions page already shows it.

## D4 Live-card reason line

Pure function `liveReason(s: Streamer): LiveReason`:

```ts
type LiveReason =
  | { key: 'paused' }
  | { key: 'noMatch'; mode: 'default' | 'custom' }
  | { key: 'match'; mail: 'sent' | 'failed' | 'pending' | 'none'; at: string | null };
```

- `!s.enabled` → `paused` ("Paused · triggers no mails").
- `!s.matches` → `noMatch` with the mode (`any` always matches, so it never lands here).
- `s.matches` → `match` with `s.mail?.status ?? 'none'` ("Match · no mail yet" for `none`, which covers the dedup/queue gap).

Rendered under the title line of the lower third; `failed` uses crimson + icon and links to `/history?status=failed`.

## D5 Roster search and filter

- Route search params validated in the route (`q?: string`, `filter?: 'live'|'active'|'paused'`, default all). Same pattern as `history.tsx`.
- Pure `filterRoster(list, { q, filter })`: case-insensitive match on `displayName` and `login`; `live` = `s.live`, `active` = `s.enabled`, `paused` = `!s.enabled`. Pure `rosterCounts(list)` for the segment labels.
- Search input with a visible label (can be `sr-only` + placeholder-free icon), `type="search"`, updates the URL with `replace: true`, debounced via `use-debounced.ts`.
- Filter as a radio group styled as segments (`RadioGroup` from the kit), each option "Live 3".
- Empty result: "No streamer matches "xyz"." with a "Reset filter" ghost button. The existing "no streamers yet" empty state stays for an empty list.

## D6 Row state text

Pure `rowStatus(s): RowStatus`:

```ts
type RowStatus =
  | { key: 'live'; since: string }
  | { key: 'lastLive'; at: string }
  | { key: 'never' }
  | { key: 'paused' };
```

Paused wins over everything. Rendered as the second line under the name, followed by the mode label. `subscriptionDots` is replaced by `subscriptionIssue(s): { count: number; state: 'error'|'missing'|'pending' } | null`; only non-null renders ("1 subscription failing", "2 subscriptions pending"). Remove `DotState`/`dotState`/`subscriptionDots` when no longer used; update their tests.

## D7 API additions

`shared/schemas.ts`:

```ts
export interface StreamerMail { status: MailStatus; at: string; error: string | null }
// Streamer:
  /** End of the most recent recorded stream; null if never recorded. */
  lastLiveAt: string | null;
  /** Latest mail for the current live stream; null when offline or none queued. */
  mail: StreamerMail | null;
```

`listStreamers` (`http/admin.ts`):
- `lastLiveAt`: one grouped query `select broadcaster_id, max(ended_at) from streams group by broadcaster_id`. Only known since the timeline feature was deployed; older history is null.
- `mail`: for live streamers, the newest `mail_outbox` row per `stream_id` (`at` = `sent_at ?? updated_at`, `error` = `last_error`). One query with `inArray(streamId, liveIds)`, picked in JS.
- Migration: index `mail_outbox_stream_idx` on `stream_id`.

`sse.ts`: `notification` also invalidates `keys.streamers`.

## Later (not in this change)

- Command palette (`Ctrl+K` / `/`) and mobile bottom navigation (prototype has both).
- Per-subscription "recreate" action; needs a server endpoint, today only `POST /api/sync` exists.
- Showing the Twitch error string of a failing subscription in the attention list.
