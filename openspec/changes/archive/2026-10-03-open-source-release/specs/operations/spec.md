# Spec Delta

## MODIFIED Requirements

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
