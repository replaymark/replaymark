# Spec Delta

## ADDED Requirements

### Requirement: Streamer live context
Each streamer returned by `GET /api/streamers` SHALL include `lastLiveAt` (end of the most recent recorded stream, or null if none is recorded) and `mail` (for a live streamer, the newest mail for the current stream with its status `pending|sent|failed`, time and last error; otherwise null).

#### Scenario: Mail failed
- **WHEN** a live streamer's current stream has a failed mail with error "SMTP 550"
- **THEN** its `mail` is `{ status: "failed", error: "SMTP 550", at: <time> }`

#### Scenario: Offline
- **WHEN** a streamer is offline and their last recorded stream ended at T
- **THEN** `mail` is null and `lastLiveAt` is T
