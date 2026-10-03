# Proposal

## Why

replaymark goes to production and is to be published as a professional open-source project under the GitHub organization `replaymark` (repository `replaymark/replaymark`). Today the repository is private, has no license, a German-only README and no community files, CI or published container image.

## What Changes

- License AGPL-3.0 (`LICENSE`, `"license": "AGPL-3.0-only"` in every package.json), version 1.0.0, repository metadata.
- Community health files: CONTRIBUTING, CODE_OF_CONDUCT (Contributor Covenant 2.1), SECURITY, CHANGELOG (Keep a Changelog), issue forms, PR template, Dependabot.
- CI on every push/PR (lint, typecheck, test, build, container build) and a release workflow that publishes a multi-arch image to `ghcr.io/replaymark/replaymark` on `v*` tags.
- `compose.yaml` pulls the published image; building from source moves to `compose.build.yaml`.
- Documentation rewritten in English: a concise README with screenshots and a `docs/` set (installation, configuration, usage, operations, upgrading, troubleshooting, architecture, development).
- Reproducible screenshots from demo data (fictional streamers, no real accounts, no Twitch calls), light and dark, desktop and phone, plus a social preview image.
- Not in this change: creating the organization, transferring the repository, making it public (the operator does that afterwards).

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `operations`: container packaging (distroless rootless runtime, published multi-arch image, English docs)

## Impact

New: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/**`, `docs/**`, `compose.build.yaml`, `scripts/screenshots/**`. Changed: `README.md`, `package.json` files, `Dockerfile` (OCI labels), `compose.yaml`, `.gitignore`.
