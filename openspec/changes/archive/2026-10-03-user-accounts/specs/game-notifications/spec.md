# Spec Delta

## MODIFIED Requirements

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

### Requirement: Mail content
Mails SHALL be rendered in the owning account's mail language (`de` default, or `en`). The German subject SHALL be `🔴 {display name} spielt jetzt {game}`, the English one `🔴 {display name} is now playing {game}`; the body SHALL exist as text and HTML (simple, light/dark-safe, optional box art) with display name, game, stream title, `https://twitch.tv/{login}`, and time formatted `dd.MM.yyyy HH:mm` (both languages) in the configured time zone. Recipients are the owning account's recipients at the time the mail is queued. Title comes from the channel endpoint on go-live and from the event on category change.

#### Scenario: Rendered mail
- **WHEN** a mail is queued for streamer "Gronkh" in "Elden Ring"
- **THEN** its subject is `🔴 Gronkh spielt jetzt Elden Ring` and both bodies contain the title and `https://twitch.tv/gronkh`
