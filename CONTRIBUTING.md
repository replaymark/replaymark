# Contributing to replaymark

Thanks for your interest. Bug reports, feature ideas, docs fixes and pull requests are all welcome. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). The project is licensed under AGPL-3.0-only; contributions are accepted under the same license.

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm 12 via Corepack: `corepack enable`
- Optional: Docker or Podman to build the image

## Setup

```sh
git clone https://github.com/replaymark/replaymark.git
cd replaymark
pnpm install
cp .env.example .env     # fill in; set DATA_DIR to e.g. ./data
set -a; . ./.env; set +a # load the variables into your shell
pnpm dev                 # server with node --watch, Vite dev server on :5173
```

The Vite dev server on `http://localhost:5173` proxies `/api` to the admin listener on `:8081`. The server does not load `.env` by itself; load it into your shell with `set -a; . ./.env; set +a` before `pnpm dev`. Set `ADMIN_COOKIE_SECURE=false` to log in over plain `http://localhost`. Required variables and defaults are defined in `apps/server/src/env.ts`.

## The gate

Every change must pass, from the repository root:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm format` fixes Biome formatting. Tests use Vitest in both apps (`pnpm test`); add or update tests next to the code you change. Database changes need a migration: edit `apps/server/src/db/schema.ts` and run `pnpm db:generate`.

## Commits and branches

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(server): ...`, `fix(web): ...`, `docs(openspec): ...`, `chore: ...`, `refactor`, `test`, `style`.
- Work on a feature branch (`feat/...`, `fix/...`, `chore/...`) created from `develop`, and open the pull request against `develop`.
- `develop` is merged into `main` for releases; releases are tagged `vX.Y.Z`.

## Releases and images

Every push to `develop` publishes `ghcr.io/replaymark/replaymark:develop` and `:develop-<sha>` (no GitHub release). A release is a merge of `develop` into `main`:

1. On `develop`, bump `version` in `package.json`, `apps/server/package.json` and `apps/web/package.json`, and add a `## [<version>]` section to `CHANGELOG.md`.
2. Open a pull request `develop` -> `main` and merge it with a merge commit (not squash or rebase).
3. The push to `main` runs the workflow `.github/workflows/release.yml`: if tag `v<version>` does not exist yet, it runs the CI gate, requires the CHANGELOG section (fails otherwise), pushes `:<version>`, `:<major>.<minor>` and `:latest`, creates the tag `v<version>` and the GitHub release with the CHANGELOG section as notes. If the tag already exists, the release jobs are skipped.

Do not push release tags by hand. Image tags for users are listed in [docs/operations.md](docs/operations.md#image-tags-and-channels).

## OpenSpec in short

Behaviour changes are specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) before they are built. A change lives in `openspec/changes/<name>/` with a `proposal.md` (why and what), spec deltas under `specs/`, an optional `design.md` and a `tasks.md` checklist. When a change is done it is archived and its deltas are merged into `openspec/specs/`, which describes the current behaviour. Small fixes, docs and refactors without behaviour change do not need a change. For anything larger, open an issue first so the approach can be agreed.

## Reporting bugs and requesting features

Use the [issue forms](https://github.com/replaymark/replaymark/issues/new/choose). A good bug report contains the version, how you run replaymark (Docker/compose or from source), the steps to reproduce and relevant logs. Redact secrets (Twitch client secret, webhook secret, SMTP password, password hashes, session cookies) before pasting anything.

Security problems must not go into public issues; see [SECURITY.md](SECURITY.md).
