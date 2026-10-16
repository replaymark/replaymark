# replaymark

Self-hosted Twitch notifier: mails when a favorite streamer goes live with a matching game. pnpm
monorepo, Node 24: `apps/server` (Hono, Drizzle/SQLite, Twitch EventSub, mail, CLI) and `apps/web`
(Vite SPA admin UI). AGPL-3.0-only. Architecture: `docs/architecture.md`; changes are specified in
`openspec/`.

This repository is public. Never commit anything about a specific installation: no host names,
credentials, `.env` contents or real streamer/user data. Examples use `example.com`.

## Run

- Running instance from source on port 28103 (admin UI, reachable on the LAN; webhook only on
  127.0.0.1): `docker compose -f compose.dev.yaml up -d --build`. Needs a `.env` from `.env.example`;
  the setup code for the first account is in `docker logs replaymark-dev`.
- Hot reload: `pnpm dev` (`docs/development.md`). To keep the LAN address, stop the container first
  and set `ADMIN_PORT=28103`.

## Gate

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` — must pass before a PR.

## Rules

- Branch from `develop` (`feat/…`, `fix/…`, `chore/…`), PR against `develop`; Conventional Commits
  for commits and PR titles (they drive semantic-release). Never edit versions or `CHANGELOG.md`.
- Schema changes: edit `apps/server/src/db/schema.ts`, run `pnpm db:generate`; never edit a
  committed migration.
- Required env variables and defaults live in `apps/server/src/env.ts`; document new ones in
  `.env.example` and `docs/configuration.md`.
- Only `POST /webhook` (8080) is public; the admin listener (8081) is LAN/VPN only, the internal one
  (8082) stays on 127.0.0.1.
