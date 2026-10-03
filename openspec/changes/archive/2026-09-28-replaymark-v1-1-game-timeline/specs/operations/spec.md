# Spec Delta

## MODIFIED Requirements

### Requirement: Housekeeping
Every day, the service SHALL delete inbox entries older than 24 h, notified records older than 7 days, expired sessions, sent outbox mails older than 30 days, and, when segment retention is greater than 0, streams (with their segments) that ended longer ago than the retention period. Streams that are still open SHALL never be deleted.

#### Scenario: Cleanup
- **WHEN** cleanup runs
- **THEN** only rows beyond those ages are removed

#### Scenario: Retention for segments
- **WHEN** retention is 365 days and cleanup runs
- **THEN** streams that ended more than 365 days ago are deleted with their segments, and newer or still-live streams are kept
