# Spec Delta

## Purpose
Provide a session-protected, typed HTTP API on the LAN listener for managing streamers, games, recipients and settings, and for observing live state.

## ADDED Requirements

### Requirement: Endpoints
The admin listener (port 8081) SHALL provide: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/overview`, `GET|POST /api/streamers`, `PATCH|DELETE /api/streamers/:id`, `GET /api/streamers/lookup?login=` (preview without saving), `GET /api/categories/search?q=` (min 2 chars, results cached briefly), `GET|PUT /api/settings` (default games, recipients ≥1 valid email, interval hours, mail language `de|en`, read-only callback URL), `GET /api/subscriptions`, `POST /api/sync`, `GET /api/notifications` (paginated, status filter), `POST /api/notifications/:id/retry`, `POST /api/test-mail`, `GET /api/events`. All inputs SHALL be schema-validated (`400` with field errors on violation). Changes to streamers or games SHALL trigger a debounced reconcile.

#### Scenario: Unknown login
- **WHEN** a streamer is added with a login Twitch does not know
- **THEN** the response is `404` with a clear message and nothing is stored

#### Scenario: Games stored as categories
- **WHEN** a custom game list is saved with a category id that does not exist on Twitch
- **THEN** the request is rejected; stored games always carry id, name and box-art URL

### Requirement: Authentication and sessions
Every route except login SHALL require a valid session, else `401`. Login SHALL verify the password against the scrypt hash from `ADMIN_PASSWORD_HASH`. Sessions SHALL use a random 32-byte id in a cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` per `ADMIN_COOKIE_SECURE`, 30-day sliding expiry. Without `ADMIN_PASSWORD_HASH` the admin listener SHALL NOT start and a clear hint is logged, while the webhook keeps running.

#### Scenario: No session
- **WHEN** `GET /api/overview` is called without a cookie
- **THEN** the response is `401`

#### Scenario: Wrong password
- **WHEN** login is attempted with a wrong password
- **THEN** the response is `401` and no cookie is set

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
