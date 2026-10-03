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

- Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(server): ...`, `fix(web): ...`, `docs(openspec): ...`, `chore: ...`, `refactor`, `test`, `style`, `ci`, `build`. The PR title is checked by the `PR title` workflow; with squash merge the PR title becomes the commit message, so it is what the release is computed from.
- Work on a feature branch (`feat/...`, `fix/...`, `chore/...`) created from `develop`, and open the pull request against `develop`.
- `develop` is merged into `main` for releases.

## Releases and images

Releases are automatic ([semantic-release](https://semantic-release.gitbook.io/), configured in `.releaserc.json`); do not edit versions or the changelog by hand. The version is computed from the commits since the last release:

- `fix:` (and `perf:`) -> patch (`1.0.0` -> `1.0.1`)
- `feat:` -> minor (`1.0.0` -> `1.1.0`)
- `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer -> major
- `docs`, `chore`, `ci`, `build`, `test`, `style`, `refactor` -> no release

Every push to `develop` publishes `ghcr.io/replaymark/replaymark:develop` and `:develop-<sha>`. If the commits warrant a release, it also creates a GitHub prerelease `vX.Y.Z-develop.N` and the image tag `:X.Y.Z-develop.N`. A stable release is a merge of `develop` into `main`:

1. Open a pull request `develop` -> `main` and merge it with a merge commit (not squash or rebase), so the individual commits are analysed.
2. The push to `main` runs `.github/workflows/release.yml`: after the CI gate, semantic-release creates the tag `vX.Y.Z` and the GitHub release with generated notes, then the image is pushed as `:X.Y.Z`, `:X.Y` and `:latest`. If no commit warrants a release, nothing is published.

After a stable release, the `back-merge` job opens a pull request `main` -> `develop` titled `chore(release): back-merge vX.Y.Z into develop` and enables auto-merge with a merge commit. This makes the tag reachable from `develop`, so prerelease numbering continues from the new version. It is skipped if `develop` already contains `main` or such a pull request is already open. Auto-merge must be allowed in the repository settings; always merge this PR with a merge commit.

Optional GitHub App setup (so the required checks run on the back-merge PR): PRs created with `GITHUB_TOKEN` do not trigger workflows, so the required checks never report. To avoid this:

1. Create a GitHub App with repository permissions Contents: read and Pull requests: write, and install it on this repository.
2. Add its ID as the secret `RELEASE_APP_ID` and its private key as `RELEASE_APP_PRIVATE_KEY`.
3. If the app is configured, the job uses it (via `actions/create-github-app-token`); otherwise it falls back to `GITHUB_TOKEN`, and a maintainer re-runs the checks (or closes and reopens the PR) and merges it.

Do not push release tags by hand. Image tags for users are listed in [docs/operations.md](docs/operations.md#image-tags-and-channels).

## OpenSpec in short

Behaviour changes are specified with [OpenSpec](https://github.com/Fission-AI/OpenSpec) before they are built. A change lives in `openspec/changes/<name>/` with a `proposal.md` (why and what), spec deltas under `specs/`, an optional `design.md` and a `tasks.md` checklist. When a change is done it is archived and its deltas are merged into `openspec/specs/`, which describes the current behaviour. Small fixes, docs and refactors without behaviour change do not need a change. For anything larger, open an issue first so the approach can be agreed.

## Reporting bugs and requesting features

Use the [issue forms](https://github.com/replaymark/replaymark/issues/new/choose). A good bug report contains the version, how you run replaymark (Docker/compose or from source), the steps to reproduce and relevant logs. Redact secrets (Twitch client secret, webhook secret, SMTP password, password hashes, session cookies) before pasting anything.

Security problems must not go into public issues; see [SECURITY.md](SECURITY.md).
