## MODIFIED Requirements

### Requirement: Endpoints
The admin listener (port 8081) SHALL provide: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/overview`, `GET|POST /api/streamers`, `PATCH|DELETE /api/streamers/:id`, `GET /api/streamers/lookup?login=` (preview without saving), `GET /api/categories/search?q=` (min 2 chars, results cached briefly), `GET|PUT /api/settings` (default games, recipients ≥1 valid email, interval hours, mail language `de|en`, read-only callback URL), `GET /api/subscriptions`, `POST /api/sync`, `GET /api/notifications` (paginated, filter by one or more statuses, per-status counts, next attempt time of pending mails), `POST /api/notifications/:id/retry`, `POST /api/notifications/retry-failed` (re-queues every failed mail, returns the number re-queued), `POST /api/test-mail`, `GET /api/events`. All inputs SHALL be schema-validated (`400` with field errors on violation). Changes to streamers or games SHALL trigger a debounced reconcile.

#### Scenario: Unknown login
- **WHEN** a streamer is added with a login Twitch does not know
- **THEN** the response is `404` with a clear message and nothing is stored

#### Scenario: Games stored as categories
- **WHEN** a custom game list is saved with a category id that does not exist on Twitch
- **THEN** the request is rejected; stored games always carry id, name and box-art URL

#### Scenario: Retry all failed
- **WHEN** three mails are failed and `POST /api/notifications/retry-failed` is called
- **THEN** all three are pending again with the same effect as retrying each one, and the response reports 3

#### Scenario: Counts
- **WHEN** `GET /api/notifications?status=failed` is called while 2 mails are pending, 5 sent and 3 failed
- **THEN** the response lists the failed mails and carries `counts` `{ all: 10, pending: 2, sent: 5, failed: 3 }` independent of the filter

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
