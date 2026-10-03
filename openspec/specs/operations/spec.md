# operations Specification

## Purpose
Run the notifier reliably as a single container: configuration, listeners, CLI, health, logging, housekeeping, shutdown and packaging.

## Requirements

### Requirement: Validated environment
All environment variables from the brief SHALL be validated at startup; invalid or missing required values SHALL print a clear message naming the variable (never its secret value) and exit non-zero. `SMTP_SECURITY` SHALL map `starttls`→STARTTLS required, `ssl`→implicit TLS, `none`→no TLS. `.env.example` SHALL document every variable.

#### Scenario: Short webhook secret
- **WHEN** `TWITCH_WEBHOOK_SECRET` has 5 characters
- **THEN** startup fails with a message naming `TWITCH_WEBHOOK_SECRET`

### Requirement: Three listeners
One process SHALL listen on 8080 (0.0.0.0, webhook only), 8081 (0.0.0.0, admin) and 8082 (127.0.0.1, `/healthz` and `/internal/*`).

#### Scenario: Internal not exposed
- **WHEN** the container starts
- **THEN** port 8082 is bound to 127.0.0.1 only

### Requirement: Health
`GET /healthz` SHALL return `200` with `{ status, subscriptionsEnabled, lastSyncAt, lastSyncOk }`, or `503` when the database is unreachable.

#### Scenario: Healthy
- **WHEN** the service runs normally
- **THEN** `/healthz` returns `200` with those four fields

### Requirement: CLI
`node src/cli.ts <command>` SHALL support `status` (table: id, active/paused, live, current game, subscription state), `sync` (runs and prints result), `test-mail` (to the first administrator's recipients), `reset-password <username>` (sets a random temporary password, prints it once, requires a change at next login and ends the account's sessions) and `import <file.yaml>` (old format, into the first administrator's lists; resolves logins and game names case-insensitively, reports unknown ones clearly, imports the rest, then syncs). All commands talk to the running server over `127.0.0.1:8082/internal/*`.

#### Scenario: Import with unknowns
- **WHEN** a YAML file contains one unknown login and one unknown game
- **THEN** both are reported, everything else is imported, and a sync runs

#### Scenario: Reset a forgotten password
- **WHEN** `reset-password mia` runs while the server is up
- **THEN** a temporary password is printed, Mia's sessions end, and her next login requires a password change

#### Scenario: Unknown account
- **WHEN** `reset-password nobody` runs
- **THEN** it exits non-zero with a clear message and changes nothing

### Requirement: Robustness and shutdown
Errors in single events, mails or reconciles SHALL NOT stop the service; unhandled rejections SHALL be logged. On SIGTERM/SIGINT the service SHALL stop accepting requests, let running jobs finish (max 10 s), close SSE streams and close the database.

#### Scenario: SIGTERM
- **WHEN** SIGTERM is received during a mail send
- **THEN** the send completes (or 10 s pass), then the process exits 0

### Requirement: Logging without secrets
Logs SHALL be structured (JSON in production, readable in development), level from `LOG_LEVEL`, and a central redaction SHALL remove tokens, client secret, webhook secret, SMTP password, password hash and session ids. Startup SHALL log callback URL, streamer count and the first reconcile result.

#### Scenario: Redaction
- **WHEN** an object containing `access_token` or the SMTP password is logged
- **THEN** the value appears as `[redacted]`

### Requirement: Housekeeping
Every day, the service SHALL delete inbox entries older than 24 h, notified records older than 7 days, expired sessions, sent outbox mails older than 30 days, and, when segment retention is greater than 0, streams (with their segments) that ended longer ago than the retention period. Streams that are still open SHALL never be deleted.

#### Scenario: Cleanup
- **WHEN** cleanup runs
- **THEN** only rows beyond those ages are removed

#### Scenario: Retention for segments
- **WHEN** retention is 365 days and cleanup runs
- **THEN** streams that ended more than 365 days ago are deleted with their segments, and newer or still-live streams are kept

### Requirement: Container packaging
A multi-stage Dockerfile SHALL build the SPA and production server dependencies in a Node 24 build stage (build tools, package manager and caches only there) and ship a minimal distroless Node 24 runtime without shell or package manager, running as numeric non-root user `1000` with group `0`, with `WORKDIR /app/apps/server`, `NODE_ENV=production`, `VOLUME /data` writable for any UID in group `0`, `EXPOSE 8080 8081`, `STOPSIGNAL SIGTERM` and an exec-form `HEALTHCHECK` without curl. The image SHALL run under rootless Podman and Docker, with a read-only root filesystem (tmpfs `/tmp`), all capabilities dropped and `no-new-privileges`. A release SHALL publish the image for `linux/amd64` and `linux/arm64` to `ghcr.io/replaymark/replaymark`. `compose.yaml` (pulling the published image, hardened as above), `compose.build.yaml` (build from source) and `.dockerignore` SHALL be provided. English documentation SHALL cover installation, configuration, usage, operations, upgrading, troubleshooting, architecture and development.

#### Scenario: Compose up
- **WHEN** `docker compose up -d` runs with a filled `.env`
- **THEN** the container becomes healthy and creates all subscriptions on its own

#### Scenario: Existing data volume
- **WHEN** an installation whose `/data` volume was written by the previous image (user `node`, UID 1000) is upgraded
- **THEN** the new container can read and write the database without manual permission changes

#### Scenario: Arbitrary UID
- **WHEN** the container runs with `--user 12345:0`, a fresh volume and a read-only root filesystem
- **THEN** it starts, writes its database and `/healthz` answers `200`
