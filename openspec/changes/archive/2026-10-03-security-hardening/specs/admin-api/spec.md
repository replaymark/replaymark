# Spec Delta

## MODIFIED Requirements

### Requirement: Authentication and sessions
Every route except login and setup SHALL require a valid session, else `401`; admin-only routes SHALL answer `403` to accounts with role `user`. Login SHALL look up the account by username (case-insensitive) and verify the password against its stored scrypt hash; an unknown username and a wrong password SHALL get the same `401`. Sessions SHALL use a random 32-byte id in a cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` per `ADMIN_COOKIE_SECURE`, 30-day sliding expiry capped at 90 days after login. Sessions SHALL belong to one account and end when the account is deleted. The admin listener SHALL start without any password configuration.

#### Scenario: No session
- **WHEN** `GET /api/overview` is called without a cookie
- **THEN** the response is `401`

#### Scenario: Wrong password
- **WHEN** login is attempted with a wrong password
- **THEN** the response is `401` and no cookie is set

#### Scenario: Unknown username
- **WHEN** login is attempted with a username that does not exist
- **THEN** the response is `401`, identical to a wrong password

#### Scenario: Absolute session lifetime
- **WHEN** a session is used daily for 91 days
- **THEN** it is rejected with `401` and the user has to log in again

### Requirement: Login rate limit
After 5 failed attempts (login, setup code, current password) from one IP, or 10 failed attempts for one username from any IP, within 15 minutes further attempts SHALL get `429`. The limiter SHALL use bounded memory. Passwords longer than 200 characters and admin request bodies over 64 KiB SHALL be rejected before any hashing.

#### Scenario: Sixth failure
- **WHEN** an IP fails 5 times and tries again within 15 minutes
- **THEN** the response is `429`

#### Scenario: Distributed guessing
- **WHEN** 10 wrong passwords for `admin` arrive from 10 different IPs within 15 minutes
- **THEN** the next login attempt for `admin` gets `429`

### Requirement: Server-sent events
`GET /api/events` SHALL stream events `live-state`, `subscriptions`, `notification`, `sync`, send a heartbeat comment every 20 s, and set `Cache-Control: no-cache` and `X-Accel-Buffering: no`.

#### Scenario: Live change pushed
- **WHEN** a streamer goes live while a client is connected
- **THEN** the client receives a `live-state` event Each client SHALL only receive events about broadcasters in its account's list; `sync` and `subscriptions` events SHALL only go to administrators.

#### Scenario: Foreign live event
- **WHEN** a streamer only in Mia's list goes live while Tom's UI is open
- **THEN** Tom's event stream receives no event about it
