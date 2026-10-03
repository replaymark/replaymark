## ADDED Requirements

### Requirement: Overview last mail error
`GET /api/overview` SHALL include `notifications.lastError`: the error text of the most recently updated mail in state `failed`, or null when no mail has failed.

#### Scenario: Failed mail present
- **WHEN** the newest failed mail has error "SMTP 550"
- **THEN** `notifications.failed` is at least 1 and `notifications.lastError` is "SMTP 550"

#### Scenario: No failed mail
- **WHEN** no mail is in state `failed`
- **THEN** `notifications.lastError` is null
