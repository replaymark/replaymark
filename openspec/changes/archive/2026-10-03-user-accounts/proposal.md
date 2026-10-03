# Proposal

## Why

Access is a single shared password that has to be hashed on the command line and put into `.env`, and everything — streamers, games, recipients, history — is shared. The operator wants to create the first account in the browser on first start, without a way to reopen that step later, and to let several people keep their own streamers and receive their own mails.

## What Changes

- **First-run setup in the browser**: while no account has a password, the server logs a one-time setup code at every start; the setup page asks for that code, a username, an email and a password and creates the first administrator. Once an account exists, the setup endpoint and page are gone for good (only the CLI can recover access).
- **Accounts with username and password**, roles `admin` and `user`. Login asks for both.
- **User management** (admin only): create users with a temporary password (changed on first login), reset a password, change the role, delete a user. The last administrator cannot be removed or demoted.
- **Per-user data**: each user has their own streamer list (mode, games, groups, active flag), their own game groups including their own default group, their own mail recipients and mail language. Timeline and history show only the user's own streamers and mails; administrators see every mail in the history. Twitch subscriptions, sync interval, retention and SMTP stay global; a broadcaster followed by several users has one set of Twitch subscriptions and each user gets their own mail.
- **Admin-only areas**: Users page, Twitch sync section and global settings.
- **BREAKING (operations)**: `ADMIN_PASSWORD_HASH` is no longer needed; the admin listener always starts. An existing hash is taken over once as the password of the first administrator (username `admin`), then the variable has no effect. CLI `hash-password` is replaced by `reset-password <username>`, which prints a new temporary password. (Chosen over "delete the admin and rerun setup": with several users the admin owns data, so deleting it would lose it.)
- **BREAKING (admin API)**: login takes `username` and `password`; recipients and mail language move from `/api/settings` to `/api/account`.
- Upgrade: all existing streamers, groups, recipients, mail language and history belong to the first administrator.

## Capabilities

### New Capabilities
- `user-accounts`: first-run setup, accounts and roles, user management, password change and reset, per-user data scoping.

### Modified Capabilities
- `admin-api`: endpoints for setup, account and users; login with username; role checks; settings without recipients and mail language.
- `operations`: CLI `reset-password` instead of `hash-password`; admin listener independent of `ADMIN_PASSWORD_HASH`.
- `game-notifications`: matching and exactly-once per user; recipients and language per user.
- `game-groups`: groups and the default group per user.
- `subscription-reconcile`: desired set from broadcasters with at least one active follow.
- `admin-ui`: setup, login, forced password change, Users page, Settings split into account and admin sections.

## Impact

- Server: `db/schema.ts` + migration 0007, `http/auth.ts`, `http/admin.ts`, `http/internal.ts`, `notify/check.ts`, `notify/match.ts`, `twitch/reconcile.ts`, `notify/live-sync.ts`, `timeline/query.ts`, `mail/mailer.ts`, `jobs/cleanup.ts`, `env.ts`, `index.ts`, `app.ts`, `cli.ts`, most server tests.
- Web: new routes `setup`, `change-password`, `_app/users`; `login.tsx`, `_app.tsx`, `app-shell.tsx`, `settings.tsx`, `index.tsx`, `history.tsx`, `lib/auth.ts`, `lib/queries.ts`, i18n.
- Docs: `README.md`, `.env.example`.
