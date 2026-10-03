# Design

## Context

Greenfield repo. `brief.md` (this directory) is the authoritative source for every detail not restated here; where this design and the brief differ, this design wins and the README "Designentscheidungen" section MUST record the difference. Project name is **replaymark** (package names `@replaymark/server`, `@replaymark/web`, container/service name `replaymark`, compose service `replaymark`).

Verified latest versions (2026-09-27, pin exactly, re-check with `pnpm view` when adding): hono 4.13.9, @hono/node-server 2.1.1, zod 4.6.5, drizzle-orm 0.45.3, drizzle-kit 0.31.11, better-sqlite3 13.0.3, nodemailer 10.0.11, vite 8.3.1, react 19.3.0, @tanstack/react-router 1.170.39, @tanstack/router-plugin 1.168.40, @tanstack/react-query 5.104.0, @tanstack/react-form 1.33.5, tailwindcss 4.3.3, @biomejs/biome 2.5.14, typescript 7.0.2, vitest 5.0.2, shadcn 4.21.0, @base-ui/react 1.8.0, lucide-react 1.48.0, sonner 2.0.8, yaml 2.9.1. Node 24 is installed locally (v24.21.0), pnpm 12.6.0.

## Goals / Non-Goals

**Goals:** everything in `brief.md` plus a bilingual EN/DE UI and a distinctive visual identity.

**Non-Goals:** multi-user, OAuth user tokens, other notification channels, horizontal scaling, i18n of logs/CLI (CLI output English).

## Decisions

### D1 Layout and type sharing
- `apps/server/src/shared/` holds Zod schemas, DTO types, SSE event types and API error codes. `apps/web` maps `@shared/*` → `../server/src/shared/*` (Vite `resolve.alias` + tsconfig `paths`) and imports `AppType` via `import type { AppType } from '@server/http/admin.ts'` (alias `@server/*` → `../server/src/*`, type-only). `apps/web` depends on `hono` for `hc`.
- Server tsconfig: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `module/moduleResolution: nodenext`, `noEmit`, `strict`. No enums/namespaces/parameter properties — use `as const` objects and string unions.
- Root `tsconfig.base.json`; root scripts run per-package via `pnpm -r`. `typecheck` = `tsc --noEmit -p` for each app (TypeScript 7 `tsc`).

### D2 Dependency injection for testability
A single `createApp(deps)` composition root in `src/app.ts` builds: `db`, `clock` (`now(): number`), `logger`, `fetch` for Twitch, mail `transport` (Nodemailer transport or test double with `sendMail`), `bus`. `index.ts` only reads env, calls `createApp`, starts listeners and jobs, and handles shutdown. Tests build the app with an in-memory SQLite (`:memory:` + migrations), fake fetch, fake transport and a controllable clock. Each HTTP surface is a factory returning a Hono app (`createPublicApp`, `createAdminApp`, `createInternalApp`) so tests use `app.request()` without sockets.

### D3 Database
Drizzle schema in `src/db/schema.ts` with the brief's tables; timestamps stored as integer epoch ms. `settings` is key/value JSON (`recipients`, `syncIntervalHours`, `mailLanguage`). `client.ts` opens better-sqlite3, sets the four pragmas, runs `migrate()` from `drizzle/`. `drizzle.config.ts` in `apps/server`; `db:generate` runs drizzle-kit. Timestamps in API DTOs are ISO strings.

### D4 Twitch client
`token.ts` caches `{token, expiresAt}`, renews at `expiresAt - 5 min`, concurrent callers share one in-flight request. `helix.ts` exposes `helix.request(method, path, {query, body})` with: 401 → refresh+retry once; 429 → sleep until `Ratelimit-Reset*1000 - now` (min 0, cap 60 s) then retry; 5xx/network → backoff `min(30s, 500ms·2^n) ± jitter`, max 5 attempts total. `sleep` comes from injected clock so tests do not really wait. Typed helpers: `getUsersByLogin`, `searchCategories`, `getGames({ids|names})`, `getStreams(ids)` (chunks of 100), `getChannels(ids)`, `listSubscriptions()` (follows `pagination.cursor`), `createSubscription`, `deleteSubscription`.

### D5 Webhook and inbox
Exact order from the brief. Inbox insert uses `INSERT ... ON CONFLICT(message_id) DO NOTHING` and checks `changes`. Verification and revocation messages are also stored in the inbox (as dedup record) but marked processed immediately. Only `notification` rows are processed by the worker. Worker = async loop woken by `wake()` (coalesced), plus a 30 s safety poll; processes rows `processed_at IS NULL AND error IS NULL` ordered by `received_at, rowid`.

### D6 Reconciler
`Reconciler.request(reason)` implements single-flight with one pending follow-up flag; `requestDebounced(reason)` uses a 2 s timer. Scheduler re-arms interval from the current setting after each run. Result `{ at, ok, active, created, deleted, errors: string[] }` stored in `app_meta.last_sync`, published as SSE `sync` (start/end) and `subscriptions`.

### D7 Notifications and mail
`notify/check.ts` `maybeNotify(broadcasterId, source)` does matching and, in one `db.transaction`, inserts into `sent_notifications` with `ON CONFLICT DO NOTHING`; only if a row was inserted it renders the mail and inserts the outbox row. The rendered payload (subject, text, html, recipients, plus streamer login/display name, game name, box art for the history view) is frozen in the outbox row. Outbox backoff delays `[60s, 300s, 1800s]`; attempt 3 failing → `failed`. Test mail goes straight through the transport (not the outbox) and reports success/error. Mail templates are plain template strings, HTML with inline styles and `prefers-color-scheme` media query; mail language from settings (`de` default). Date formatting with `Intl.DateTimeFormat` using `TZ` → `dd.MM.yyyy HH:mm` (assembled from parts to guarantee the format in both languages).

### D8 Admin auth
Hash format `scrypt$N$r$p$saltB64$hashB64` (N=2^15, r=8, p=1, 32-byte salt, 64-byte key, `maxmem` raised accordingly), verify with `timingSafeEqual`. Sessions stored by SHA-256 of the cookie value (so a DB leak does not leak live cookies); cookie name `ss_session`. Sliding expiry: refresh `expires_at` when older than 1 day since last extension. Rate limiter in memory keyed by IP from `@hono/node-server` conninfo (no `X-Forwarded-For` trust by default; README explains). Origin check: `new URL(origin).host === Host header`; missing Origin on mutating requests → 403. API errors use `{ error: { code: ApiErrorCode, message: string, fields?: Record<string,string[]> } }`; codes are a const list in `shared/errors.ts`, the UI translates by code.

### D9 SSE
`bus` is a typed `EventEmitter` wrapper. `/api/events` uses `streamSSE`, subscribes per connection, writes `: ping` every 20 s, unsubscribes on abort; a registry allows shutdown to close all streams. Web `lib/sse.ts`: `EventSource('/api/events')`, on `live-state` → `invalidateQueries(['streamers'])` + `['overview']`; `subscriptions`/`sync` → `['subscriptions']`, `['overview']`; `notification` → `['notifications']`, `['overview']`. Reconnect with backoff 1 s→30 s; on 401 route to login.

### D10 i18n (user addition)
No i18n library. `apps/web/src/i18n/`: `en.ts` is the source dictionary (`as const`), `de.ts` is typed `satisfies Messages` (derived from `en`) so a missing key fails typecheck. `I18nProvider` + `useT()` with simple `{name}` interpolation and a plural helper; language from `localStorage('ss.lang')` else `navigator.language`. `Intl` formatters bound to the active locale. A test asserts both dictionaries have identical key sets. Mail language is a separate server setting (D7).

### D11 Visual identity (confirmed by the user: direction "B – lower third"; implementer MUST follow)
Subject: a personal lookout for favourite streamers; primary job "who is live in my game right now?". Motif: a broadcast studio's **tally light** (red "on air" lamp) plus TV **lower thirds** (Bauchbinden). Boldness is spent only on the on-air band; everything else is quiet.
- **Palette** (CSS variables mapped onto shadcn tokens):
  - light: `--paper #E9ECEF` (background), `--sheet #FFFFFF` (surfaces), `--ink #1B2230` (text AND primary buttons: ink-filled, paper text), `--muted #5B6576`, `--rule #D2D8E0`.
  - dark: `--paper #151A26`, `--sheet #1D2333`, `--ink #E6EAF2` (primary buttons ink-filled with dark text), `--muted #95A0B3`, `--rule #2C3448`.
  - **Tally red `#E5322D` is the only chromatic accent and means "live" exclusively** (lamp, live badge, live count). Errors use crimson `#B4232C` (dark `#F07178`) always paired with an icon. Subscription indicator = three small dots (one per subscription type): enabled `#2E9E6A`, pending `#D99A1E`, error/missing crimson hollow dot. "Matches" = ink check icon + word ("passt" / "match").
  - No Twitch purple, no gradients, no teal, no cream/terracotta, no acid green, no drop shadows (hairline `--rule` borders instead).
- **Type**: `Big Shoulders Display` (condensed, broadcast lower-third feel) only for streamer display names in the on-air band, page titles and the wordmark; `Atkinson Hyperlegible Next` for everything else, tabular figures for numbers/times. Self-hosted via `@fontsource-variable/*` (CSP self-only; justify in README; if a variable package does not exist, use the static `@fontsource/*` one). Sentence case everywhere — display names may be uppercase only inside lower thirds, as broadcast convention. No all-caps eyebrow labels, no middle-dot meta strings, no `→` in buttons, no monospace labels.
- **Layout**: desktop = top bar (lamp wordmark "replaymark" left, nav Übersicht/Abos/Verlauf/Einstellungen, language DE|EN and theme toggle right); ≤ 768 px = bottom tab bar, top bar keeps only wordmark + toggles. Overview, top to bottom:
  1. "Auf Sendung / On air" band: live streamers ordered by start time (a real sequence), each as a lower third: box art tile left, a vertical ink bar, display name in Big Shoulders, game, title on the second line, "seit 19:02" time, "passt" marker, lamp on the right edge. Empty: one quiet line "Gerade ist niemand live." / "Nobody is live right now."
  2. One inline status line (not cards): "14 Streamer, 2 live · 42 Abos aktiv · Abgleich 20:30 ok · 0 fehlgeschlagene Mails" rendered as separate inline items with spacing (no middle-dot joiners); failed mails > 0 shown in crimson with icon, linking to history.
  3. Hairline rule, then "Alle Streamer" roster as dense rows (avatar, name, mode text, subscription dots, active switch), "Streamer hinzufügen" button right-aligned in the heading row.
  Left-aligned throughout. Radius 6 px for inputs/buttons/chips, 10 px for dialogs only.
- **Motion**: exactly one orchestrated moment — when a streamer goes live via SSE the lamp ignites (glow ramps up ~400 ms) and the row slides into the on-air band; the lamp then pulses slowly (~2.4 s) while live. Other transitions ≤ 150 ms state feedback only. `prefers-reduced-motion`: no pulse, no slide.
- **Copy**: the user's vocabulary ("Streamer", "Spiele/Games", "Mail-Empfänger/Mail recipients", "Abos jetzt abgleichen/Check subscriptions now"); actions keep their names in toasts ("Änderungen speichern" → "Änderungen gespeichert"); errors say what happened and how to fix; empty states invite action. Both languages written natively.
- Quality floor: visible focus rings, AA contrast in both themes, usable at 375 px, keyboard-operable combobox and dialogs.
- Self-critique: after 5.2/5.3 take screenshots (browser skill) in both themes/languages and at 375 px, and remove one accessory.

### D12 CLI
`cli.ts` uses `node:util.parseArgs`; commands call `http://127.0.0.1:8082/internal/{status,sync,test-mail,import}`. `import` parses YAML client-side with `yaml`, posts the structure to `/internal/import`, the server resolves via Helix and returns a report. `hash-password` uses `node:readline` with muted output (raw mode), confirms twice.

### D13 Logging
Own tiny logger (`src/log.ts`, no pino) — JSON lines when `NODE_ENV=production`, colored single lines otherwise; `redact()` walks objects and replaces values of keys matching `/token|secret|password|hash|session|authorization|cookie/i` and any string equal to a known secret from env. Justification in README: avoids a dependency for ~60 lines.

### D14 Extra dependencies beyond the brief (all must be justified in README)
`yaml` (server, CLI import), `@fontsource-variable/big-shoulders-display` + `@fontsource-variable/atkinson-hyperlegible-next` (web, CSP-safe fonts), shadcn's own runtime deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`), `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/*`. Nothing else without adding it here first.

## Risks / Trade-offs

- [TypeScript 7 (native) may lag some editor/plugin integrations] → only `tsc --noEmit` is used; if a needed feature is missing, fall back to `@typescript/native-preview`, and record it.
- [Reverse proxy altering the body breaks HMAC] → README nginx/Caddy examples and a clear 403 log line with reason (never the secret).
- [In-memory login rate limit resets on restart] → acceptable for single admin; documented.
- [Web importing server types pulls server deps into web typecheck] → web tsconfig `paths` + `skipLibCheck`; web gets `hono` as devDependency.
- [better-sqlite3 native build in Docker] → build tools only in build stage; runtime copies built `node_modules`.

## Migration Plan

Deploy fresh container; run `node src/cli.ts import old.yaml` once; stop the old tool after the first sync shows all subscriptions `enabled`. Rollback = stop container; subscriptions remain on Twitch until deleted — README documents `sync` after removing all streamers to clean up.
