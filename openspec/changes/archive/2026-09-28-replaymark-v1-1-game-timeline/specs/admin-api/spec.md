# Spec Delta

## ADDED Requirements

### Requirement: Timeline endpoints
The admin listener SHALL provide these endpoints behind the same session and origin checks as the other `/api` routes:
- `GET /api/timeline?categoryId=&streamerIds=&from=&to=&page=`: timeline query per `category-timeline`. `categoryId` is required; `streamerIds` is a comma-separated list; `from` and `to` are epoch milliseconds (decimal strings), both inclusive, matched against the stream start (the UI sends local-day bounds, `to` being the end of the day minus 1 ms).
- `GET /api/timeline/streams/:streamId`: the stream with all of its segments.
- `GET /api/timeline/categories`: the recorded categories, with box art, stream count and last played time, most recent first.

All parameters SHALL be schema-validated. An invalid or missing one returns `400` with field errors. An unknown stream returns `404`. Changes to segments or streams SHALL be pushed over the existing SSE stream so that open timeline views refresh.

#### Scenario: Missing category
- **WHEN** `GET /api/timeline` is called without `categoryId`
- **THEN** the response is `400` naming the field

#### Scenario: Unauthenticated
- **WHEN** a timeline endpoint is called without a session
- **THEN** the response is `401`

### Requirement: Segment retention setting
`GET|PUT /api/settings` SHALL include `segmentRetentionDays`: an integer from 0 to 3650, default 365, where 0 means keep forever.

#### Scenario: Out of range
- **WHEN** settings are saved with `segmentRetentionDays` of 5000
- **THEN** the response is `400` with a field error, and the stored value is unchanged
