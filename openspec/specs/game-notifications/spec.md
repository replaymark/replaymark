# game-notifications Specification

## Purpose
Turn stored EventSub events into live state and exactly-once email notifications when an active streamer is live in a matching category.

## Requirements

### Requirement: Ordered, fault-isolated inbox processing
The inbox worker SHALL process unprocessed entries in `received_at` order, marking each processed or with an error. A failing event SHALL be logged and SHALL NOT stop the worker. Entries left unprocessed by a restart SHALL be processed at startup.

#### Scenario: Restart with pending events
- **WHEN** the service restarts with unprocessed inbox entries, some of which were already notified
- **THEN** all are processed and no duplicate mail is queued

### Requirement: Event semantics
`stream.online` SHALL set stream id (= event id) and start time, then fetch current category and title from the channel endpoint and run the check. `channel.update` SHALL store category and title and run the check only if the streamer is live. `stream.offline` SHALL clear the stream id. Every live-state change SHALL be published to live clients.

#### Scenario: Offline category change
- **WHEN** `channel.update` arrives for an offline streamer with a matching category
- **THEN** no mail is queued

### Requirement: Category matching
The check SHALL run once per account whose list contains the streamer as active. For that account a category matches when the mode is `any`; or `custom` and the category is in the account's single games for that streamer or in the games of one of the groups the account assigned to it; or `default` and the category is in the account's default group.

#### Scenario: Mode any
- **WHEN** a streamer in mode `any` goes live in any category
- **THEN** one mail is queued

#### Scenario: Mode default
- **WHEN** a streamer in mode `default` goes live in a game of the default group
- **THEN** one mail is queued

#### Scenario: Custom via group
- **WHEN** a streamer in mode `custom` without single games but with group "Soulslikes" goes live in a game of that group
- **THEN** one mail is queued

#### Scenario: Paused streamer
- **WHEN** a paused streamer goes live in a matching category
- **THEN** no mail is queued

### Requirement: Exactly once per stream and category
On a match for an account the service SHALL, in one transaction, record (stream id, category id, account) as notified (unique) and enqueue an outbox mail for that account; if already recorded, nothing happens.

#### Scenario: Live with matching game
- **WHEN** a streamer goes live in a matching game
- **THEN** exactly one mail is queued

#### Scenario: Switch into matching game
- **WHEN** a streamer goes live in "Just Chatting" and later switches to a matching game
- **THEN** exactly one mail is queued, at the switch

#### Scenario: Away and back
- **WHEN** within the same stream the streamer switches away from and back to the matching game
- **THEN** no second mail is queued

#### Scenario: New stream same game
- **WHEN** a new stream (new stream id) starts in the same matching game
- **THEN** a new mail is queued

#### Scenario: Two accounts
- **WHEN** two accounts have the same streamer active and both match the category
- **THEN** exactly one mail per account is queued

### Requirement: Durable outbox with retries
The outbox worker SHALL send due pending mails; on failure it SHALL increment attempts, store the error and reschedule with backoff (1 min, 5 min, 30 min); after the 3rd failed attempt the mail SHALL be `failed`. A manual retry SHALL reset it to pending and due now. State SHALL survive restarts.

#### Scenario: Transient failure
- **WHEN** the first send fails
- **THEN** attempts is 1, the error is stored, and the next attempt is ~1 minute later

#### Scenario: Permanent failure and retry
- **WHEN** three attempts fail and the admin then retries
- **THEN** the mail is `failed` after the third, and pending and due immediately after the retry

### Requirement: Mail content
Mails SHALL be rendered in the owning account's mail language (`de` default, or `en`). The German subject SHALL be `🔴 {display name} spielt jetzt {game}`, the English one `🔴 {display name} is now playing {game}`; the body SHALL exist as text and HTML (simple, light/dark-safe, optional box art) with display name, game, stream title, `https://twitch.tv/{login}`, and time formatted `dd.MM.yyyy HH:mm` (both languages) in the configured time zone. Recipients are the owning account's recipients at the time the mail is queued. Title comes from the channel endpoint on go-live and from the event on category change.

#### Scenario: Rendered mail
- **WHEN** a mail is queued for streamer "Gronkh" in "Elden Ring"
- **THEN** its subject is `🔴 Gronkh spielt jetzt Elden Ring` and both bodies contain the title and `https://twitch.tv/gronkh`
