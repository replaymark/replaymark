# Design

## Context

Monorepo (pnpm 12, Node 24 per `.nvmrc`): `apps/server` (Hono, Drizzle/SQLite), `apps/web` (Vite, React, shadcn base-nova, Tailwind 4). Gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. `Dockerfile` (multi-stage, node:24-slim, non-root), `compose.yaml` currently builds locally (`image: replaymark`). README is German (≈400 lines, sections: Twitch app, webhook secret, first start, reverse proxy nginx/Caddy, admin UI in LAN, operation incl. CLI/health/backup, YAML migration, Twitch CLI testing, timeline, development, design decisions). Env vars are defined and validated in `apps/server/src/env.ts`. The UI is bilingual (de/en).

## Goals / Non-Goals

**Goals:** a newcomer can install, configure and operate replaymark from the docs alone; every documented command, env var and default matches the code; screenshots are reproducible with one command.
**Non-Goals:** a docs website (plain Markdown in the repo is enough), a German translation of the docs, the organization transfer and visibility change.

## Decisions

- **Language:** all repository docs in English (open-source standard); the docs state that the UI and mails are available in German and English.
- **Docs layout:** `README.md` (pitch, hero screenshot, features, how it works as a Mermaid diagram, 5-step quick start, links) and `docs/` with one file per topic: `installation.md`, `configuration.md`, `usage.md`, `operations.md`, `upgrading.md`, `troubleshooting.md`, `architecture.md`, `development.md`; `docs/images/` for screenshots. Content of the current German README is translated and redistributed, nothing dropped (design decisions → `architecture.md`, YAML import → `upgrading.md`).
- **Copyright line:** `Copyright (C) 2026 The replaymark contributors` (AGPL text verbatim from `gh api licenses/agpl-3.0`). No personal email in any new file; security and conduct reports go through GitHub private vulnerability reporting / the maintainers' GitHub contact.
- **Screenshots:** a Playwright script in `scripts/screenshots/` (Playwright as root devDependency, run with `pnpm screenshots`). It starts the server with an isolated temporary `DATA_DIR` and **dummy Twitch and SMTP credentials**, so no real Twitch subscription is ever created or deleted, seeds demo data directly into SQLite (fictional streamers with placeholder avatars, real game names and box-art URLs, live state, streams and segments, groups, mails in all states, two accounts), logs in and captures fixed viewports (1440×900 desktop, 390×844 phone) in light and dark. Output PNGs are optimized (oxipng/pngquant if available) and kept under ~400 KB each.
- **CI:** `.github/workflows/ci.yml` (pnpm/action-setup + setup-node from `.nvmrc`, cache, frozen lockfile, gate, `docker build` without push). `.github/workflows/release.yml` on `v*` tags: buildx multi-arch (amd64, arm64), push to GHCR with semver and `latest` tags, OCI labels, GitHub release with the CHANGELOG section. Actions pinned to major versions; Dependabot keeps them current.
- **Compose:** `compose.yaml` uses `ghcr.io/replaymark/replaymark:${REPLAYMARK_VERSION:-latest}`; `compose.build.yaml` adds `build: .` for source builds (`docker compose -f compose.yaml -f compose.build.yaml up -d --build`).

## Risks / Trade-offs

- [The operator's current deploy builds locally] → until the first image is published, deploy with `compose.build.yaml`; called out in `upgrading.md` and the hand-off.
- [Secrets in git history become public] → a history scan runs before publishing (report to the operator; no history rewrite in this change).
- [Docs drift from code] → the review checks every command, env var and default against the code.

## Migration Plan

Merge to `develop`; the operator creates the `replaymark` organization, transfers the repository, enables private vulnerability reporting, sets the social preview, makes it public and tags `v1.0.0` to publish the first image.
