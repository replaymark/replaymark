# Design

## Context

Auth today: one scrypt hash from `ADMIN_PASSWORD_HASH` (`http/auth.ts`), sessions without an owner (`sessions` table), admin listener only started when the hash is set (`index.ts:41-48`, `app.ts:176`). Data has no owner: `streamers` (PK = Twitch broadcaster id in column `user_id`) carries `game_mode`/`enabled`; `streamer_games`, `streamer_groups`, `game_groups` (one `is_default`), `sent_notifications` unique `(stream_id, category_id)`, `mail_outbox` with recipients frozen in its payload; recipients and mail language are global settings keys (`db/settings.ts`). Matching runs per broadcaster (`notify/check.ts:45` → `notify/match.ts`). Reconcile and live sync select `streamers.enabled` (`twitch/reconcile.ts:94`, `notify/live-sync.ts:27`). The CLI talks to the internal listener on 127.0.0.1:8082 without auth (`http/internal.ts`).

## Goals / Non-Goals

**Goals:**
- Every owned row carries `owner_id`; every API scope check is one `where owner_id = ?`.
- One upgrade path that never loses data and keeps FKs `NOT NULL`.

**Non-Goals:**
- Open registration, invitations, email verification, password reset by mail.
- Per-user SMTP, sync interval or retention.
- Hiding SSE events per user (events carry only broadcaster ids and trigger refetches of scoped data).

## Decisions

- **Account row 1 exists from the migration on.** Migration 0007 inserts `users` row id 1 (username `admin`, role `admin`, `password_hash` NULL, email = first old recipient or empty) and assigns every existing row to it. "Setup required" ⇔ no account has a `password_hash`. Setup fills row 1 (username, email, password) instead of inserting; if the email is not yet in its recipients it is added. Alternative "nullable owner, claimed at setup" rejected: nullable FKs everywhere and a claim step that can be forgotten.
- **Tables**: `users (id pk, username, email, password_hash null, role 'admin'|'user', must_change_password int, mail_language 'de'|'en', created_at)`, unique index on `lower(username)`; `user_recipients (user_id → users cascade, email, pk)`; `follows (owner_id → users cascade, broadcaster_id → streamers.user_id cascade, game_mode, enabled, created_at, pk(owner_id, broadcaster_id))` taking over `game_mode`/`enabled` from `streamers`, which stays the shared broadcaster profile; `streamer_games` and `streamer_groups` gain `owner_id` and reference `follows (owner_id, broadcaster_id)` with cascade; `game_groups` gains `owner_id` (cascade), unique `(owner_id, lower(name))`, partial unique `(owner_id) where is_default = 1`; `sent_notifications` gains `owner_id`, unique `(stream_id, category_id, owner_id)`; `mail_outbox` gains `owner_id` (cascade); `sessions` gains `user_id` (cascade). Settings keys `recipients` and `mailLanguage` move into `user_recipients` / `users.mail_language` for row 1 and are deleted. A broadcaster row is deleted when its last follow is removed.
- **Hash takeover** at startup (`index.ts`): if no account has a password and `ADMIN_PASSWORD_HASH` is valid, set it on row 1 and log that the variable can be removed. The admin listener always starts.
- **Setup code**: 10 random characters from an unambiguous alphabet, generated at each start while setup is required, kept in memory, logged at `warn` (`Setup code: XXXXX-XXXXX`), compared in constant time. Wrong codes go through the existing login rate limiter. After success the code is discarded; the endpoint checks "any account has a password" on every call, so it cannot be reopened by restarting.
- **Auth middleware** resolves the session to `{ id, username, role, mustChangePassword }` per request and stores it in the Hono context. `requireAdmin()` guards users, settings, subscriptions and sync routes. The password-change gate allows only `/api/auth/*` and `POST /api/account/password` while the flag is set.
- **Temporary passwords**: 16 characters from the same alphabet, generated server-side, returned once in the create/reset response, never logged.
- **Matching per follow**: `maybeNotify(broadcasterId)` loads all enabled follows of the broadcaster and, per owner, runs `categoryMatches(db, ownerId, broadcasterId, categoryId)`, inserts `sent_notifications` and an outbox row with that owner's recipients and language in one transaction per owner.
- **Scoping**: streamers API = caller's follows joined with the broadcaster profile and shared live state (DTO shape unchanged; `userId` stays the broadcaster id). Timeline filters `streams.broadcaster_id in (caller's follows)`; `GET /api/timeline/streams/:id` answers `404` for streams of broadcasters the caller does not follow. Notifications: owner filter, admins unfiltered with `owner` username in each row; retry actions follow the same rule. Overview: own counts; subscription counts and last sync only for admins (`null` otherwise).
- **CLI**: `hash-password` removed; `reset-password <username>` → `POST /internal/users/reset-password`; `import`, `status` and `test-mail` use the lowest-id account with role admin.
- **Web**: `meQuery` returns the account; `_app` `beforeLoad` redirects to `/setup` when `GET /api/auth/setup` says required, to `/login` on 401 and to `/change-password` when the flag is set; admin routes redirect users to `/`. Nav shows Users only for admins.

## Risks / Trade-offs

- [Large migration rebuilding several SQLite tables] → generated by drizzle, extended by hand for the data copy; covered by a test that migrates a seeded 0006 database and checks every row's owner.
- [Setup race on an exposed port before setup] → the code exists only in the server log.
- [CLI on the internal listener can reset any password] → it listens on 127.0.0.1 only, like the existing import; documented.
- [Shared SSE stream leaks which broadcaster went live to other accounts] → accepted; no personal data is in the events.

## Migration Plan

Back up the database, deploy, then either log in as `admin` with the old password (hash takeover) or open the UI and complete setup with the code from `docker logs`. Remove `ADMIN_PASSWORD_HASH` from `.env` afterwards. Rollback requires the backup.
