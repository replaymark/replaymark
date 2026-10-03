# Spec Delta

## Purpose

Gives every person their own account with their own streamers, games and mails, lets administrators manage accounts, and creates the first administrator in the browser on first start.

## ADDED Requirements

### Requirement: First-run setup
While no account has a password, the service SHALL generate a random one-time setup code at every start and log it with a clear hint. `GET /api/auth/setup` SHALL report whether setup is required, without a session. `POST /api/auth/setup` SHALL accept the code, a username, an email and a password; with a correct code it SHALL create the first account with role `admin`, start a session and answer like a login. A wrong code SHALL be rejected and count as a failed login for the rate limit. Once any account has a password, setup SHALL be reported as not required and every setup request SHALL be rejected with `409`, regardless of the code; the setup page SHALL not be reachable anymore.

#### Scenario: Fresh install
- **WHEN** the service starts with an empty database
- **THEN** a setup code is logged, `GET /api/auth/setup` reports `required: true`, and the UI shows the setup page instead of the login

#### Scenario: Setup completed
- **WHEN** setup succeeded once and someone posts to `/api/auth/setup` again with the code from the log
- **THEN** the response is `409` and no account is created or changed

#### Scenario: Wrong code
- **WHEN** setup is posted with a wrong code
- **THEN** the response is `401`, nothing is created, and the attempt counts towards the login rate limit

### Requirement: Accounts and login
Each account SHALL have a unique username (3–32 characters of `a-z`, `0-9`, `.`, `_`, `-`, compared case-insensitively), an email, a password (8–200 characters, stored only as scrypt hash), a role `admin` or `user`, and a flag that a password change is required. Login SHALL take username and password. A session SHALL belong to one account; the role SHALL be read on every request, so a role change applies immediately. Changing one's own password SHALL require the current password and SHALL end all other sessions of that account.

#### Scenario: Login with username
- **WHEN** user "Mia" logs in as "mia" with the right password
- **THEN** a session for Mia's account is created

#### Scenario: Password change ends other sessions
- **WHEN** Mia is logged in on two devices and changes her password on one
- **THEN** the other device's next request gets `401`

### Requirement: Forced password change
An account with the password-change flag SHALL only be able to call auth endpoints and the own password change; every other API request SHALL get `403` with code `password_change_required`, and the UI SHALL show only the change-password page. A successful change SHALL clear the flag.

#### Scenario: First login with temporary password
- **WHEN** a user created by an admin logs in with the temporary password
- **THEN** the UI shows the change-password page and the overview API answers `403 password_change_required` until the password is changed

### Requirement: User management
Administrators SHALL be able to list accounts (username, email, role, created at, number of streamers), create an account with username, email, role and a temporary password (flag set), reset an account's password to a new temporary password (flag set, all its sessions ended), change an account's role and delete an account. Deleting an account SHALL delete its streamer list, groups, recipients, mails and sessions. An administrator SHALL NOT delete their own account. The last administrator SHALL NOT be deleted or demoted (`409`, code `last_admin`). Accounts with role `user` SHALL get `403` on every user-management request.

#### Scenario: Create a user
- **WHEN** an admin creates user "mia" with role user and a temporary password
- **THEN** Mia can log in with it, must change it, and then sees an empty streamer list and only the default group

#### Scenario: Last admin
- **WHEN** the only admin tries to change their own role to user
- **THEN** the request is rejected with `last_admin` and nothing changes

#### Scenario: User blocked
- **WHEN** an account with role user calls `GET /api/users`
- **THEN** the response is `403`

### Requirement: Per-user data
Each account SHALL have its own streamer list (per streamer: mode, single games, groups, active flag), its own game groups including its own default group (created with the account), its own mail recipients (at least one; the account email when created) and its own mail language. Every API that reads or changes these SHALL act only on the caller's own data; ids of other accounts' groups SHALL be treated as unknown. The timeline SHALL only show streams of streamers in the caller's list. The notification history SHALL show the caller's own mails; for administrators it SHALL show every mail with the owning username. Live state, recorded streams and Twitch subscriptions SHALL stay shared per broadcaster.

#### Scenario: Separate lists
- **WHEN** Mia adds streamer "Gronkh" in mode any and Tom has no streamers
- **THEN** Tom's overview and timeline do not show Gronkh and Tom gets no mail when Gronkh goes live

#### Scenario: Same streamer, two users
- **WHEN** Mia (mode any, recipients mia@x) and Tom (mode custom with Elden Ring, recipients tom@y, language en) both follow Gronkh and Gronkh goes live in Elden Ring
- **THEN** one mail in German goes to mia@x and one mail in English to tom@y, and only one set of Twitch subscriptions exists for Gronkh

#### Scenario: Foreign group id
- **WHEN** Tom patches his streamer with the id of one of Mia's groups
- **THEN** the response is `400 unknown_group` and nothing is stored

#### Scenario: Admin history
- **WHEN** an admin opens the history
- **THEN** mails of all accounts are listed, each with its username

### Requirement: Upgrade to accounts
On upgrade, all existing streamers with their modes, games and groups, the default group, the recipients, the mail language and the mail history SHALL belong to the first administrator. If `ADMIN_PASSWORD_HASH` is set while no account has a password, its hash SHALL become the password of that administrator with username `admin` and setup SHALL not be required; afterwards the variable SHALL have no effect and a hint SHALL say it can be removed.

#### Scenario: Upgrade with existing hash
- **WHEN** an installation with `ADMIN_PASSWORD_HASH`, 5 streamers and recipients a@x, b@y is upgraded
- **THEN** login as `admin` with the old password works, and that account has the 5 streamers and recipients a@x, b@y
