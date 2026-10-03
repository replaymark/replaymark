# Spec Delta

## MODIFIED Requirements

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
