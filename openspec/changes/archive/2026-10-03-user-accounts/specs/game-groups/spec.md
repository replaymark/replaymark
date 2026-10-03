# Spec Delta

## MODIFIED Requirements

### Requirement: Game groups
The system SHALL store game groups per account, each with a non-empty name (max 60 characters, unique case-insensitively within the account) and a set of Twitch categories (0 to 100). Games SHALL only be chosen from Twitch category search results; every stored game carries id, name and box-art URL.

#### Scenario: Create a group
- **WHEN** the operator creates the group "Soulslikes" with Elden Ring and Dark Souls III
- **THEN** the group is stored with both games and listed on the Games page

#### Scenario: Duplicate name
- **WHEN** a group is created or renamed to a name that another group already has, ignoring case
- **THEN** the request is rejected with a clear message and nothing changes

#### Scenario: Same name, other account
- **WHEN** Mia and Tom each create a group named "Soulslikes"
- **THEN** both groups are stored and each sees only their own

### Requirement: Default group
Every account SHALL have exactly one default group, created with the account. It SHALL always exist, SHALL NOT be deletable or renamable, and SHALL be shown under the translated label "Default games" / "Standard-Spiele". Streamers in mode `default` in that account's list SHALL use its games. On upgrade, the previously stored default games SHALL become the games of the first administrator's default group.

#### Scenario: Upgrade keeps default games
- **WHEN** an installation with default games Minecraft and Tetris is upgraded
- **THEN** the default group contains exactly Minecraft and Tetris and streamers in mode `default` notify as before

#### Scenario: Delete default group
- **WHEN** deletion of the default group is requested
- **THEN** the request is rejected and the group stays
