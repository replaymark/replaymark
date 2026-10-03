# Spec Delta

## MODIFIED Requirements

### Requirement: CLI
`node src/cli.ts <command>` SHALL support `status` (table: id, active/paused, live, current game, subscription state), `sync` (runs and prints result), `test-mail` (to the first administrator's recipients), `reset-password <username>` (sets a random temporary password, prints it once, requires a change at next login and ends the account's sessions) and `import <file.yaml>` (old format, into the first administrator's lists; resolves logins and game names case-insensitively, reports unknown ones clearly, imports the rest, then syncs). All commands talk to the running server over `127.0.0.1:8082/internal/*`.

#### Scenario: Import with unknowns
- **WHEN** a YAML file contains one unknown login and one unknown game
- **THEN** both are reported, everything else is imported, and a sync runs

#### Scenario: Reset a forgotten password
- **WHEN** `reset-password mia` runs while the server is up
- **THEN** a temporary password is printed, Mia's sessions end, and her next login requires a password change

#### Scenario: Unknown account
- **WHEN** `reset-password nobody` runs
- **THEN** it exits non-zero with a clear message and changes nothing
