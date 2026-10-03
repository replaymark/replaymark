# Spec Delta

## Purpose
Run the notifier reliably as a single container: configuration, listeners, CLI, health, logging, housekeeping, shutdown and packaging.

## ADDED Requirements

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
`node src/cli.ts <command>` SHALL support `status` (table: id, active/paused, live, current game, subscription state), `sync` (runs and prints result), `test-mail`, `hash-password` (prompts without echo, prints a hash accepted by the login, needs no server) and `import <file.yaml>` (old format; resolves logins and game names case-insensitively, reports unknown ones clearly, imports the rest, then syncs). All but `hash-password` talk to the running server over `127.0.0.1:8082/internal/*`.

#### Scenario: Import with unknowns
- **WHEN** a YAML file contains one unknown login and one unknown game
- **THEN** both are reported, everything else is imported, and a sync runs

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
Daily, the service SHALL delete inbox entries older than 24 h, notified records older than 7 days, expired sessions, and sent outbox mails older than 30 days.

#### Scenario: Cleanup
- **WHEN** cleanup runs
- **THEN** only rows beyond those ages are removed

### Requirement: Container packaging
A multi-stage Dockerfile on `node:24-slim` SHALL build the SPA and production server dependencies in a build stage (build tools only there) and ship a non-root runtime with `WORKDIR /app/apps/server`, `NODE_ENV=production`, `VOLUME /data`, `EXPOSE 8080 8081`, `STOPSIGNAL SIGTERM` and a curl-free `HEALTHCHECK`. `compose.yaml` and `.dockerignore` SHALL be provided. A German README SHALL cover the brief's eleven sections.

#### Scenario: Compose up
- **WHEN** `docker compose up -d` runs with a filled `.env`
- **THEN** the container becomes healthy and creates all subscriptions on its own
