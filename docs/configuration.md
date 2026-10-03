# Configuration

replaymark is configured through environment variables. With Compose they come from `.env` (`env_file`). Start from the template:

```sh
cp .env.example .env
```

The variables are defined and validated in `apps/server/src/env.ts`. Empty values (`FOO=`) count as unset. If validation fails, the server refuses to start and names only the offending variables, never their values.

## Twitch

| Variable | Required | Default | Description |
|---|---|---|---|
| `TWITCH_CLIENT_ID` | yes | none | Client ID of your Twitch application. |
| `TWITCH_CLIENT_SECRET` | yes | none | Client secret of your Twitch application. |
| `TWITCH_WEBHOOK_SECRET` | yes | none | EventSub signing secret, 10 to 100 characters. Create one with `openssl rand -hex 32`. |
| `TWITCH_CALLBACK_URL` | yes | none | Public HTTPS URL Twitch posts to, for example `https://twitch.example.com/webhook`. Must match your reverse proxy exactly. |

## SMTP

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | yes | none | Mail server host name. |
| `SMTP_PORT` | yes | none | Mail server port, 1 to 65535, for example `587`. |
| `SMTP_SECURITY` | yes | none | `starttls`, `ssl` or `none`. |
| `SMTP_USERNAME` | no | none | Login name. Authentication is used only if this is set. |
| `SMTP_PASSWORD` | no | none | Login password. |
| `SMTP_FROM` | yes | none | Sender address, for example `"replaymark <notify@example.com>"`. |

## Admin UI

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_PASSWORD_HASH` | no | none | Only for the one-time takeover when upgrading from a single-password version (before 1.0): the hash becomes the password of the account `admin`. Remove it afterwards. Keep the single quotes, see [upgrading](upgrading.md#admin_password_hash-takeover). A malformed hash aborts the start. |
| `ADMIN_COOKIE_SECURE` | no | `true` | Set to `false` if you open the UI over plain `http://`, for example in the LAN. Otherwise the login fails silently. |
| `PUBLIC_BASE_URL` | no | none | Base URL of the admin UI. If set, mails contain a link to it. |

## Runtime

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATA_DIR` | no | `/data` | Directory of the SQLite database (`replaymark.db`). |
| `TZ` | no | none | Time zone for timestamps in mails, for example `Europe/Berlin`. |
| `DEFAULT_LANGUAGE` | no | `en` | `en` or `de`. UI language for browsers that are neither German nor English, and mail language of newly created accounts. Existing accounts keep theirs. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn` or `error`. |

## Listeners and paths (development)

| Variable | Required | Default | Description |
|---|---|---|---|
| `PUBLIC_PORT` | no | `8080` | Webhook listener port. |
| `ADMIN_PORT` | no | `8081` | Admin UI listener port. |
| `INTERNAL_PORT` | no | `8082` | Internal listener (`/healthz`, `/internal/*`) on `127.0.0.1`. |
| `WEB_DIST` | no | `../web/dist` | Directory of the built SPA, relative to `apps/server`. |

Changing the ports is meant for development. In the container, keep the defaults so the published ports and the healthcheck keep working.

## Docker Compose only

These variables are read by Compose, not by the server.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_BIND` | no | `127.0.0.1` | Host address that port 8081 is published on: a LAN IP, `127.0.0.1` or a Tailscale address. Never a public interface. |
| `REPLAYMARK_VERSION` | no | `latest` | Image tag of `ghcr.io/replaymark/replaymark`. Also used as the version build argument with `compose.build.yaml` (default `dev`). |

## Settings in the UI

The timeline keeps stream and category history for as long as `segmentRetentionDays` allows. Pick a retention that fits your own obligations (privacy law, the [Twitch Developer Services Agreement](https://legal.twitch.com/en/legal/developer-agreement/)); `0` keeps everything forever.

Per-account and global options live in the admin UI under **Settings**, not in the environment: per account the mail recipients and the mail language (`de` or `en`, default `de`); for administrators only the sync interval (1 to 168 hours) and the timeline retention `segmentRetentionDays` (default 365, `0` keeps everything). The default games are maintained on the **Games** page. See [usage](usage.md#settings).

## Secrets

Never commit `.env`. Passwords, session IDs and secrets are redacted from logs. The logger masks keys such as `token`, `secret`, `password`, `hash`, `session`, `cookie` and `authorization`, and every known secret value from the environment.
