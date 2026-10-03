# Upgrading

## Before every upgrade

1. Read the [changelog](../CHANGELOG.md) for the target version.
2. **Back up the data volume first.** The database is the only state. See [backup](operations.md#data-and-backup):

   ```sh
   docker compose stop
   docker run --rm --volumes-from replaymark -v "$PWD":/backup docker.io/library/busybox \
     tar czf /backup/replaymark-data.tgz -C /data .
   docker compose start
   ```

3. Pull and restart:

   ```sh
   docker compose pull
   docker compose up -d
   ```

   Set `REPLAYMARK_VERSION=<version>` in `.env` to pin a release instead of `latest`.

### Image tags

| Tag | Meaning |
|---|---|
| `latest` | Newest stable release (default) |
| `X.Y.Z` | Exact release, for example `1.1.0` |
| `X.Y` | Newest patch release of a minor version, for example `1.1` |
| `develop` | Latest build of the `develop` branch |
| `develop-<sha>` | A single `develop` build (short commit SHA), for pinning |
| `X.Y.Z-develop.N` | Prerelease from `develop`, for example `1.1.0-develop.1` (only built when the commits since the last release warrant a version) |

All tags are multi-arch (`linux/amd64`, `linux/arm64`).

### Development channel

To try unreleased changes, set `REPLAYMARK_VERSION=develop` in `.env` and run `docker compose pull && docker compose up -d`. Remove the line (or set a release version) to go back. `develop` may be unstable, and its database migrations are not guaranteed to be reversible: back up first and do not use it for data you cannot lose.

## Database migrations

Migrations run automatically on every start. You do not run anything by hand. Check `docker compose logs` after the upgrade. A downgrade is not supported: restore the backup of the old version instead.

## Switching from a local build to the GHCR image

Earlier deployments built the image locally (`image: replaymark`, `build: .`). `compose.yaml` now pulls `ghcr.io/replaymark/replaymark:${REPLAYMARK_VERSION:-latest}` (`linux/amd64` and `linux/arm64`).

1. Back up the volume (see above).
2. Update the checkout (`git pull`) or replace `compose.yaml` with the current one. Keep your `.env`.
3. Run `docker compose pull && docker compose up -d`. The container name `replaymark` and the volume `replaymark-data` stay the same, so your data is reused.
4. Compose prefixes the volume name with the project name, which is the name of the directory holding `compose.yaml` (for example `replaymark_replaymark-data`). If your data lives in a volume with a different name, `docker volume ls` shows it. Point Compose to it as an existing volume:

   ```yaml
   volumes:
     replaymark-data:
       external: true
       name: <your-existing-volume-name>
   ```

   With `external: true` Compose never creates or removes the volume itself.

To keep building from source, for example before the first image is published:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

### Volume ownership

The image runs as UID 1000, GID 0, the same UID as the former `node` user. Existing volumes therefore keep working without a `chown`. A host bind mount must be writable for UID 1000 or group 0. The root filesystem is read-only (`/tmp` is a tmpfs), so everything persistent must live under `/data`.

## ADMIN_PASSWORD_HASH takeover

Versions before 1.0 had a single admin password in `.env` (`ADMIN_PASSWORD_HASH`). Accounts replaced it. When you upgrade such an installation:

1. Leave `ADMIN_PASSWORD_HASH` in `.env` for the first start of the new version. Keep the single quotes: the hash contains `$`, and Docker Compose interpolates `$...` in `env_file` values unless the value is single-quoted.
2. If no account is set up yet, the service takes the hash over once as the password of the account `admin`. The setup page is not shown.
3. Log in as `admin` with your old password.
4. Remove `ADMIN_PASSWORD_HASH` from `.env`. The log tells you to do so.

A malformed hash aborts the start with a message naming `ADMIN_PASSWORD_HASH`. Fresh installations need no hash: they use the [setup code](installation.md#5-first-start-set-up-the-administrator).

## Import from the legacy YAML format

The earlier tool kept its streamers in a YAML file. Import it into the lists of the first administrator:

```yaml
default_games: ["Elden Ring"]
streamers:
  papaplatte:
    games: ["Minecraft", "Elden Ring"]
  gronkh: {}              # uses the default games
  somestreamer:
    games: ["*"]          # any game
```

The container has a read-only root filesystem and no shell, so place the file on the data volume, import it and remove it:

```sh
docker run --rm --volumes-from replaymark -v "$PWD":/in:ro docker.io/library/busybox \
  cp /in/old.yaml /data/old.yaml
docker exec replaymark node src/cli.ts import /data/old.yaml
docker run --rm --volumes-from replaymark docker.io/library/busybox rm /data/old.yaml
```

The CLI reads the file and the server resolves logins and game names through the Helix API (case-insensitive). Unknown logins or games are listed in the report and the rest is imported anyway. A sync runs afterwards. `["*"]` becomes "any game" and `{}` becomes "default games". The `default_games` of the file are appended to the existing default games, not replaced. Switch the old tool off only when `status` shows all subscriptions as `enabled`.
