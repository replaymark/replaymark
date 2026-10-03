# Spec Delta

## MODIFIED Requirements

### Requirement: Mail content
Mails SHALL be rendered in the owning account's mail language (`en` or `de`); new accounts get the instance default language (`DEFAULT_LANGUAGE`, `en` unless configured), existing accounts keep theirs. The German subject SHALL be `🔴 {display name} spielt jetzt {game}`, the English one `🔴 {display name} is now playing {game}`; the body SHALL exist as text and HTML (simple, light/dark-safe, optional box art) with display name, game, stream title, `https://twitch.tv/{login}`, and time formatted `dd.MM.yyyy HH:mm` (both languages) in the configured time zone. Recipients are the owning account's recipients at the time the mail is queued. Title comes from the channel endpoint on go-live and from the event on category change.

#### Scenario: Rendered mail
- **WHEN** a mail is queued for streamer "Gronkh" in "Elden Ring"
- **THEN** its subject is `🔴 Gronkh spielt jetzt Elden Ring` and both bodies contain the title and `https://twitch.tv/gronkh`

#### Scenario: New account language
- **WHEN** an administrator creates an account on an instance without `DEFAULT_LANGUAGE`
- **THEN** the account's mail language is English
