# Operations

## CLI

The CLI runs inside the container. The working directory of the image is `/app/apps/server`:

```sh
docker exec replaymark node src/cli.ts <command>
```

```text
node src/cli.ts status              Streamers of the first administrator with live state and subscriptions
node src/cli.ts sync                Run a sync and print the result
node src/cli.ts test-mail           Test mail to the recipients of the first administrator
node src/cli.ts reset-password <username>
                                    Set a temporary password and print it once
node src/cli.ts import <file.yaml>  Import streamers and default games into the lists of the first administrator
```

All commands talk to the running server on `127.0.0.1:8082/internal/*`. They only work inside the container, or on the machine where the server runs. `docker compose exec replaymark ...` works as well.

The internal listener is unauthenticated. Whoever can reach it can reset any password, so it is bound to `127.0.0.1`.

## Image tags and channels

The image is `ghcr.io/replaymark/replaymark`. Select a tag with `REPLAYMARK_VERSION` in `.env` (default `latest`).

| Tag | Meaning |
|---|---|
| `latest` | Newest stable release (default) |
| `X.Y.Z` | Exact release, for example `1.1.0` |
| `X.Y` | Newest patch release of a minor version, for example `1.1` |
| `develop` | Latest build of the `develop` branch |
| `develop-<sha>` | A single `develop` build (short commit SHA), for pinning |

All tags are multi-arch (`linux/amd64`, `linux/arm64`).

### Development channel

To try unreleased changes, set `REPLAYMARK_VERSION=develop` in `.env` and run `docker compose pull && docker compose up -d`. Remove the line (or set a release version) to go back. `develop` may be unstable, and its database migrations are not guaranteed to be reversible: back up first and do not use it for data you cannot lose.

## Healthcheck

`GET http://127.0.0.1:8082/healthz` returns `200` with `{ status, subscriptionsEnabled, lastSyncAt, lastSyncOk }`, or `503` if the database is not reachable. The image uses it as its built-in `HEALTHCHECK` (a node one-liner, no curl needed). Check the state with `docker ps` or `docker inspect --format '{{.State.Health.Status}}' replaymark`.

## Logs

```sh
docker compose logs -f
```

In production the logs are JSON lines, for example `{"time":"2026-10-03T10:00:00.000Z","level":"info","msg":"..."}`. Set `LOG_LEVEL=debug` for details. Secrets are redacted. The container handles `SIGTERM` cleanly, so `docker stop` finishes quickly.

## Sync

The service reconciles its Twitch subscriptions with the configured streamers: on a timer (interval in Settings, administrators only, 1 to 168 hours), 2 seconds after streamer changes, and on demand with `node src/cli.ts sync`. One sync runs at a time, with at most one follow-up run.

## Data and backup

The SQLite database lives in the named volume `replaymark-data` (`/data/replaymark.db` in the container). Compose prefixes the volume name with the project name (for example `replaymark_replaymark-data`). `docker volume ls` shows the real name.

The image runs as user `1000:0` and the volume inherits that ownership (group-writable). A host bind mount such as `./data:/data` works only if the directory is writable for UID 1000 or group 0, so a named volume is the recommended setup.

Back up with the service stopped so the database is consistent. `--volumes-from replaymark` mounts the data volume of the container whatever the project prefix is, and also works on a stopped container:

```sh
docker compose stop
docker run --rm --volumes-from replaymark -v "$PWD":/backup docker.io/library/busybox \
  tar czf /backup/replaymark-data.tgz -C /data .
docker compose start
```

The database runs in WAL mode. Copy only the database file while the service is stopped, and then take `replaymark.db`, `replaymark.db-wal` and `replaymark.db-shm` together (whichever exist). Never copy the files of a running service, and never `replaymark.db` alone from a running one.

To restore, stop the service, unpack the archive into the volume with the same approach (`docker run --rm --volumes-from replaymark -v "$PWD":/backup docker.io/library/busybox tar xzf /backup/replaymark-data.tgz -C /data`), make sure the files are owned by UID 1000 or group 0 and writable for the group (`chown -R 1000:0 /data && chmod -R g=u /data`), then start.

## Testing locally with the Twitch CLI

With the [Twitch CLI](https://dev.twitch.tv/docs/cli/) you can send signed events to the webhook locally, without a public URL. Start the server locally (see [development](development.md) or `docker compose up`) and use the same secret as `TWITCH_WEBHOOK_SECRET`:

```sh
# Verification challenge (the response must be the challenge as plain text)
twitch event verify-subscription stream.online -F http://localhost:8080/webhook -s <secret>

# Stream goes live
twitch event trigger stream.online -F http://localhost:8080/webhook -s <secret> \
  --to-user <broadcaster-id>

# Category change
twitch event trigger channel.update -F http://localhost:8080/webhook -s <secret> \
  --to-user <broadcaster-id>

# Stream ends
twitch event trigger stream.offline -F http://localhost:8080/webhook -s <secret> \
  --to-user <broadcaster-id>

# Wrong secret -> 403
twitch event trigger stream.online -F http://localhost:8080/webhook -s wrong-secret
```

`<broadcaster-id>` is the Twitch user ID of a streamer you added (shown by `status`). Events for unknown streamers are accepted but ignored. After `stream.online`, replaymark fetches category and title from Helix and sends the mail only if the game matches.

## Decommissioning

See [Uninstalling](installation.md#uninstalling).
