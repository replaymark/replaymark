# Spec Delta

## Purpose

Lets the operator define named, reusable sets of games once and assign them to many streamers, including the built-in default game set.

## ADDED Requirements

### Requirement: Game groups
The system SHALL store game groups, each with a unique, non-empty name (max 60 characters, unique case-insensitively) and a set of Twitch categories (0 to 100). Games SHALL only be chosen from Twitch category search results; every stored game carries id, name and box-art URL.

#### Scenario: Create a group
- **WHEN** the operator creates the group "Soulslikes" with Elden Ring and Dark Souls III
- **THEN** the group is stored with both games and listed on the Games page

#### Scenario: Duplicate name
- **WHEN** a group is created or renamed to a name that another group already has, ignoring case
- **THEN** the request is rejected with a clear message and nothing changes

### Requirement: Default group
Exactly one group SHALL be the default group. It SHALL always exist, SHALL NOT be deletable or renamable, and SHALL be shown under the translated label "Default games" / "Standard-Spiele". Streamers in mode `default` SHALL use its games. On upgrade, the previously stored default games SHALL become the games of the default group.

#### Scenario: Upgrade keeps default games
- **WHEN** an installation with default games Minecraft and Tetris is upgraded
- **THEN** the default group contains exactly Minecraft and Tetris and streamers in mode `default` notify as before

#### Scenario: Delete default group
- **WHEN** deletion of the default group is requested
- **THEN** the request is rejected and the group stays

### Requirement: Assign groups to streamers
A streamer in mode `custom` SHALL have any number of assigned groups in addition to its single games. Its effective games SHALL be the union of the single games and the games of all assigned groups, evaluated at match time, so a change to a group applies to every streamer it is assigned to without further action. Deleting a group SHALL remove it from every streamer; the streamers' single games stay.

#### Scenario: Group change applies immediately
- **WHEN** streamer A has group "Soulslikes" assigned and the operator adds Lies of P to that group
- **THEN** A's next go-live in Lies of P is a match

#### Scenario: Delete assigned group
- **WHEN** the group "Soulslikes" assigned to streamers A and B is deleted
- **THEN** neither A nor B has the group anymore and their single games are unchanged
