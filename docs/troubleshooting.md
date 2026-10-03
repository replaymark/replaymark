# Troubleshooting

First look at the logs and the status:

```sh
docker compose logs --tail 100
docker exec replaymark node src/cli.ts status
```

| Symptom | Cause and fix |
|---|---|
| Container exits right after start | Invalid configuration. The log names the offending variables (never the values). Fix `.env` using [configuration.md](configuration.md). |
| Start aborts mentioning `ADMIN_PASSWORD_HASH` | The hash is malformed. Compose interpolated the `$` characters because the single quotes are missing, or the value was truncated. See [upgrading](upgrading.md#admin_password_hash-takeover), or remove the variable. |
| Login does nothing or fails silently | You use plain `http://` but the cookie is `Secure`. Set `ADMIN_COOKIE_SECURE=false` or use HTTPS. |
| Writes in the UI answer `403` | A proxy changed the `Host` header. The API compares `Origin` with `Host`. Keep `Host` (`proxy_set_header Host $host;`). |
| Login blocked after wrong passwords | At most 5 failed attempts per IP in 15 minutes. The limit is in memory and resets on restart. Behind a reverse proxy all clients share the proxy IP, because `X-Forwarded-For` is not trusted. |
| Live updates do not arrive | The proxy buffers or closes `/api/events`. Disable buffering (`proxy_buffering off;`, Caddy `flush_interval -1`) and allow long reads. |
| Setup code not found | Run `docker logs replaymark 2>&1 \| grep "Setup code"`. The code is regenerated on every start while no account has a password. After setup it is no longer offered. |
| Forgot a password | `docker exec replaymark node src/cli.ts reset-password <username>`. |
| Subscriptions stay pending or never become `enabled` | Twitch cannot reach `TWITCH_CALLBACK_URL`, or the proxy alters the body. It must be the public HTTPS URL, forwarding only to `8080/webhook`, with the body unchanged. Run `node src/cli.ts sync`. |
| Webhook answers `403` | Wrong `TWITCH_WEBHOOK_SECRET`, or the timestamp is too old (check the host clock). |
| No mail arrives | Run `node src/cli.ts test-mail`. Check `SMTP_*`, the recipients under Settings and the History page. Failed mails are retried after 1, 5 and 30 minutes, then marked `failed` and can be sent again. |
| Mail has the wrong language or time | The mail language is its own per-account setting under Settings. Times use `TZ`. |
| Mails have no link to the UI | Set `PUBLIC_BASE_URL`. |
| Subscriptions remain at Twitch after removal | Remove streamers and run `node src/cli.ts sync` before you delete the volume. |
| No VOD link in the timeline | The channel must store past broadcasts. The resolver gives up after 7 days. Twitch deletes VODs after 7, 14 or 60 days. |
| `HEALTHCHECK` missing with Podman | Build with `podman build --format docker`, or use the published image. |
| Cannot write to `/data` | A bind mount must be writable for UID 1000 or group 0. Use the named volume. |
| `sh` or `bash` not found in the container | The distroless image has no shell. Use `docker exec replaymark node ...`. |
| CLI cannot connect | The CLI talks to `127.0.0.1:8082` and runs only where the server runs. |

Still stuck? Open an [issue](https://github.com/replaymark/replaymark/issues/new/choose) with the version and redacted logs. See [CONTRIBUTING.md](../CONTRIBUTING.md).
