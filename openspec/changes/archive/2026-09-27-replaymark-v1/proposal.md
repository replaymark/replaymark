# Proposal

## Why

The user wants a self-hosted service that emails them as soon as a chosen Twitch streamer is live **and** playing a chosen game (at go-live or on a mid-stream category switch), replacing an older YAML-configured tool. The repository is greenfield; the full, authoritative requirements are in `brief.md` in this change directory.

## What Changes

- New pnpm monorepo **replaymark** (`apps/server`, `apps/web`) on Node 24 with native type stripping, Hono, Drizzle/SQLite, Nodemailer, Vite 8 + React 19 + TanStack, Tailwind 4 + shadcn/ui (Base UI), Biome, TypeScript 7, Vitest.
- Twitch EventSub webhook ingest with HMAC verification, persistent inbox and dedup.
- Self-managing subscription reconcile against Helix, with pagination, rate-limit handling and single-flight scheduling.
- Notification logic (category matching per streamer mode, exactly-once per stream+category) and a persistent mail outbox with retries.
- Session-authenticated admin API (Hono RPC `AppType`) with SSE live updates.
- Admin SPA, **fully bilingual (English + German)**, light/dark mode, responsive.
- CLI (`status`, `sync`, `test-mail`, `hash-password`, `import`), Dockerfile, compose file, German README.

## Capabilities

### New Capabilities
- `webhook-ingest`: public `POST /webhook` — signature, timestamp, dedup, challenge, notification persistence, revocation.
- `subscription-reconcile`: app token, Helix client behaviour, desired-vs-actual EventSub subscription reconciliation and live-state resync.
- `game-notifications`: event processing into live state, category matching, exactly-once notification, mail outbox delivery and retry, mail content.
- `admin-api`: authenticated admin HTTP API, sessions, login rate limit, CSRF origin check, security headers, SSE events.
- `admin-ui`: bilingual (EN/DE) admin single-page app — pages, live updates, forms, theming.
- `operations`: listeners/ports, env config, CLI, health endpoint, logging/redaction, cleanup, graceful shutdown, Docker packaging, README.

### Modified Capabilities
- (none — greenfield)

## Impact

New repository `dasganni/replaymark` (private). New runtime dependencies as listed in the brief's tech stack plus `yaml` (CLI import parsing); every addition beyond the brief is justified in the README. Exposes port 8080 publicly (webhook only) and 8081 on LAN.
