# Spec Delta

## MODIFIED Requirements

### Requirement: Endpoints
The admin listener (port 8081) SHALL provide: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/overview`, `GET|POST /api/streamers`, `PATCH|DELETE /api/streamers/:id` (patch accepts mode, single category ids, group ids and the active flag), `GET /api/streamers/lookup?login=` (preview without saving), `GET /api/categories/search?q=` (min 2 chars, results cached briefly), `GET|POST /api/game-groups` (list with games, default flag and number of assigned streamers; create), `PATCH|DELETE /api/game-groups/:id` (rename, replace games; delete, rejected for the default group), `GET|PUT /api/settings` (recipients ≥1 valid email, interval hours, mail language `de|en`, read-only callback URL), `GET /api/subscriptions`, `POST /api/sync`, `GET /api/notifications` (paginated, filter by one or more statuses, per-status counts, next attempt time of pending mails), `POST /api/notifications/:id/retry`, `POST /api/notifications/retry-failed` (re-queues every failed mail, returns the number re-queued), `POST /api/test-mail`, `GET /api/events`. Streamers SHALL be returned with their assigned groups (id and name). All inputs SHALL be schema-validated (`400` with field errors on violation). Changes to streamers, games or groups SHALL trigger a debounced reconcile.

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
