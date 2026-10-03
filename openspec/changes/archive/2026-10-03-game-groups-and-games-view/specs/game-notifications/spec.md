# Spec Delta

## MODIFIED Requirements

### Requirement: Category matching
The check SHALL apply only to active streamers. A category matches when the mode is `any`; or `custom` and the category is in the streamer's single games or in the games of one of its assigned groups; or `default` and the category is in the default group.

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
