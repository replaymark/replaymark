# Changelog

> Releases after 1.0.0 are created automatically and listed under [GitHub Releases](https://github.com/replaymark/replaymark/releases). This file is no longer updated.

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-10-03

### Added

- Twitch EventSub notifications: a mail is sent when a followed streamer goes live with a game you care about, with signature and timestamp verification on the public webhook.
- Game modes and game groups: notify for all games or only for a custom selection, with a built-in default group and reusable groups per streamer.
- Category timeline per stream with segments per game and deep links to the VOD at the matching timestamp.
- History of sent mails with states and retries.
- Accounts and roles with a first-run setup, per-user data, password change and a users page.
- Bilingual admin UI and mails (German and English).
- Command line interface (`node src/cli.ts status`, `test-mail`, and more) for use inside the container.
- Health endpoint (`GET /healthz`) and a Docker `HEALTHCHECK`.
- Periodic reconcile of Twitch subscriptions with the configured streamers.
- Distroless, rootless Docker image (user `1000:0`, read-only root filesystem, no shell) and a hardened compose file.
- Multi-arch image (`linux/amd64`, `linux/arm64`) published to GHCR on release tags.

[Unreleased]: https://github.com/replaymark/replaymark/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/replaymark/replaymark/releases/tag/v1.0.0
