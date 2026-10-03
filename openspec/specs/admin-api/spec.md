# admin-api Specification

## Purpose
Provide a session-protected, typed HTTP API on the LAN listener for managing streamers, games, recipients and settings, and for observing live state.

## Requirements

### Requirement: Endpoints
The admin listener (port 8081) SHALL provide: `GET|POST /api/auth/setup` (setup state without session; first account), `POST /api/auth/login` (username and password), `POST /api/auth/logout`, `GET /api/auth/me` (id, username, role, password-change flag), `GET|PATCH /api/account` (own email, recipients ≥1 valid email, mail language `de|en`), `POST /api/account/password` (current and new password), `GET|POST /api/users` and `PATCH|DELETE /api/users/:id` (admin only; patch sets role or resets the password to a temporary one), `GET /api/overview`, `GET|POST /api/streamers`, `PATCH|DELETE /api/streamers/:id` (patch accepts mode, single category ids, group ids and the active flag), `GET /api/streamers/lookup?login=` (preview without saving), `GET /api/categories/search?q=` (min 2 chars, results cached briefly), `GET|POST /api/game-groups` (list with games, default flag and number of assigned streamers; create), `PATCH|DELETE /api/game-groups/:id` (rename, replace games; delete, rejected for the default group), `GET|PUT /api/settings` (admin only: interval hours, retention, read-only callback URL), `GET /api/subscriptions` and `POST /api/sync` (admin only), `GET /api/notifications` (paginated, filter by one or more statuses, per-status counts, next attempt time of pending mails), `POST /api/notifications/:id/retry`, `POST /api/notifications/retry-failed` (re-queues every failed mail, returns the number re-queued), `POST /api/test-mail` (to the caller's own recipients in the caller's mail language), `GET /api/events`. Streamers SHALL be returned with their assigned groups (id and name). Streamer, group, notification, timeline and overview endpoints SHALL act on the caller's own data as defined in the user-accounts capability. All inputs SHALL be schema-validated (`400` with field errors on violation). Changes to streamers, games or groups SHALL trigger a debounced reconcile.

#### Scenario: Unknown login
- **WHEN** a streamer is added with a login Twitch does not know
- **THEN** the response is `404` with a clear message and nothing is stored

#### Scenario: Games stored as categories
- **WHEN** a custom game list or a group is saved with a category id that does not exist on Twitch
- **THEN** the request is rejected; stored games always carry id, name and box-art URL

#### Scenario: Unknown group
- **WHEN** a streamer is patched with a group id that does not exist
- **THEN** the response is `400` and nothing is stored

#### Scenario: Retry all failed
- **WHEN** three mails are failed and `POST /api/notifications/retry-failed` is called
- **THEN** all three are pending again with the same effect as retrying each one, and the response reports 3

#### Scenario: Counts
- **WHEN** `GET /api/notifications?status=failed` is called while 2 mails are pending, 5 sent and 3 failed
- **THEN** the response lists the failed mails and carries `counts` `{ all: 10, pending: 2, sent: 5, failed: 3 }` independent of the filter

### Requirement: Authentication and sessions
Every route except login and setup SHALL require a valid session, else `401`; admin-only routes SHALL answer `403` to accounts with role `user`. Login SHALL look up the account by username (case-insensitive) and verify the password against its stored scrypt hash; an unknown username and a wrong password SHALL get the same `401`. Sessions SHALL use a random 32-byte id in a cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` per `ADMIN_COOKIE_SECURE`, 30-day sliding expiry. Sessions SHALL belong to one account and end when the account is deleted. The admin listener SHALL start without any password configuration.

#### Scenario: No session
- **WHEN** `GET /api/overview` is called without a cookie
- **THEN** the response is `401`

#### Scenario: Wrong password
- **WHEN** login is attempted with a wrong password
- **THEN** the response is `401` and no cookie is set

#### Scenario: Unknown username
- **WHEN** login is attempted with a username that does not exist
- **THEN** the response is `401`, identical to a wrong password

### Requirement: Login rate limit
After 5 failed logins from one IP within 15 minutes further attempts SHALL get `429`.

#### Scenario: Sixth failure
- **WHEN** an IP fails 5 times and tries again within 15 minutes
- **THEN** the response is `429`

### Requirement: CSRF origin check
Mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) whose `Origin` header does not match the `Host` SHALL be rejected with `403`.

#### Scenario: Foreign origin
- **WHEN** a logged-in POST carries `Origin: https://evil.example`
- **THEN** the response is `403`

### Requirement: Security headers and SPA delivery
The admin listener SHALL serve the built SPA with fallback to `index.html` for client routes, long cache for hashed assets, `no-cache` for `index.html`, and headers `Content-Security-Policy` (self only; images also from `static-cdn.jtvnw.net`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`.

#### Scenario: Deep link
- **WHEN** a browser requests `/settings`
- **THEN** `index.html` is served with `no-cache` and the CSP header

### Requirement: Server-sent events
`GET /api/events` SHALL stream events `live-state`, `subscriptions`, `notification`, `sync`, send a heartbeat comment every 20 s, and set `Cache-Control: no-cache` and `X-Accel-Buffering: no`.

#### Scenario: Live change pushed
- **WHEN** a streamer goes live while a client is connected
- **THEN** the client receives a `live-state` event

### Requirement: Timeline endpoints
The admin listener SHALL provide these endpoints behind the same session and origin checks as the other `/api` routes:
- `GET /api/timeline?categoryId=&streamerIds=&from=&to=&page=`: timeline query per `category-timeline`. `categoryId` is optional; `streamerIds` is a comma-separated list; `from` and `to` are epoch milliseconds (decimal strings), both inclusive, matched against the stream start (the UI sends local-day bounds, `to` being the end of the day minus 1 ms).
- `GET /api/timeline/streams/:streamId`: the stream with all of its segments.
- `GET /api/timeline/categories`: the recorded categories, with box art, stream count and last played time, most recent first.

All parameters SHALL be schema-validated. An invalid one returns `400` with field errors. An unknown stream returns `404`. Changes to segments or streams SHALL be pushed over the existing SSE stream so that open timeline views refresh.

#### Scenario: Missing category
- **WHEN** `GET /api/timeline` is called without `categoryId`
- **THEN** the response is `200` and lists the most recent recorded streams of all games

#### Scenario: Invalid category
- **WHEN** `GET /api/timeline?categoryId=` is called with an empty value
- **THEN** the response is `400` naming the field

#### Scenario: Unauthenticated
- **WHEN** a timeline endpoint is called without a session
- **THEN** the response is `401`

### Requirement: Segment retention setting
`GET|PUT /api/settings` SHALL include `segmentRetentionDays`: an integer from 0 to 3650, default 365, where 0 means keep forever.

#### Scenario: Out of range
- **WHEN** settings are saved with `segmentRetentionDays` of 5000
- **THEN** the response is `400` with a field error, and the stored value is unchanged

### Requirement: Streamer live context
Each streamer returned by `GET /api/streamers` SHALL include `lastLiveAt` (end of the most recent recorded stream, or null if none is recorded) and `mail` (for a live streamer, the newest mail for the current stream with its status `pending|sent|failed`, time and last error; otherwise null).

#### Scenario: Mail failed
- **WHEN** a live streamer's current stream has a failed mail with error "SMTP 550"
- **THEN** its `mail` is `{ status: "failed", error: "SMTP 550", at: <time> }`

#### Scenario: Offline
- **WHEN** a streamer is offline and their last recorded stream ended at T
- **THEN** `mail` is null and `lastLiveAt` is T

### Requirement: Overview last mail error
`GET /api/overview` SHALL include `notifications.lastError`: the error text of the most recently updated mail in state `failed`, or null when no mail has failed.

#### Scenario: Failed mail present
- **WHEN** the newest failed mail has error "SMTP 550"
- **THEN** `notifications.failed` is at least 1 and `notifications.lastError` is "SMTP 550"

#### Scenario: No failed mail
- **WHEN** no mail is in state `failed`
- **THEN** `notifications.lastError` is null
