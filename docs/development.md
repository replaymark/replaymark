# Development

Prerequisites: Node.js 24 and pnpm (through Corepack: `corepack enable`). The general contribution flow is in [CONTRIBUTING.md](../CONTRIBUTING.md).

```sh
pnpm install
cp .env.example .env    # fill in; set DATA_DIR to e.g. ./data
set -a; . ./.env; set +a   # load the variables into your shell
pnpm dev                # server with node --watch + Vite dev server (proxies /api)
```

The server does not load `.env` itself. Load it into your shell before `pnpm dev` as shown above. With `ADMIN_COOKIE_SECURE=false` the login works over `http://localhost`. See [configuration](configuration.md).

| Command | Purpose |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` (TypeScript 7) in both apps |
| `pnpm lint` | Biome (lint and format check) |
| `pnpm format` | Biome formats |
| `pnpm test` | Vitest in both apps |
| `pnpm build` | builds the SPA to `apps/web/dist` |
| `pnpm db:generate` | generates Drizzle migrations from `apps/server/src/db/schema.ts` into `apps/server/drizzle/` |
| `pnpm screenshots` | regenerates `docs/images/` from demo data (isolated data directory, dummy Twitch and SMTP credentials) |

The full gate is `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Migrations run automatically on start. The server runs directly from `src/*.ts` without a build step.

## Structure

- `apps/server`: Hono, Drizzle, Twitch, mail and CLI. Shared schemas and types live in `apps/server/src/shared/`.
- `apps/web`: Vite SPA. It imports `@shared/*` through a path alias and imports `AppType` as a type only.
- `scripts/screenshots`: the Playwright screenshot script.
- `openspec/`: specifications and changes.

## Build the image

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

With Podman use `podman build --format docker -t replaymark .` to keep the `HEALTHCHECK`. Releases are published by `.github/workflows/release.yml` when a `v*` tag is pushed (multi-arch image on GHCR, GitHub release with the changelog section).

For testing webhooks locally see [operations](operations.md#testing-locally-with-the-twitch-cli).
