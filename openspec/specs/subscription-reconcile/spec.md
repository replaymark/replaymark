# subscription-reconcile Specification

## Purpose
Keep Twitch EventSub subscriptions exactly aligned with the set of active streamers, robust against rate limits, transient failures and restarts.

## Requirements

### Requirement: App access token lifecycle
The service SHALL obtain an app access token via client credentials, cache it in memory, renew it before expiry with a safety margin, and on a Helix `401` refresh once and retry the request once.

#### Scenario: Token expired server-side
- **WHEN** Helix answers `401`
- **THEN** a new token is fetched and the request is retried exactly once

### Requirement: Resilient Helix calls
All Helix calls SHALL send `Client-Id` and `Authorization: Bearer`. On `429` the client SHALL wait until `Ratelimit-Reset` (unix seconds) and retry; on `5xx` or network errors it SHALL retry with exponential backoff and jitter, at most 5 attempts in total.

#### Scenario: Rate limited
- **WHEN** Helix answers `429` with `Ratelimit-Reset` 2 seconds ahead
- **THEN** the client waits until then and the retried request succeeds

### Requirement: Desired-state reconcile
A reconcile SHALL (1) list all existing subscriptions across all pages, considering only those whose callback equals the configured callback URL; (2) compute the desired set of (type, broadcaster) — `stream.online` v1, `stream.offline` v1, `channel.update` v2 — for every streamer that is active in at least one account's list; (3) delete subscriptions that are unwanted, in any status other than `enabled` or `webhook_callback_verification_pending`, or duplicates beyond one per desired entry; (4) create missing ones; (5) mirror the result into the store, record time and outcome (counts active/created/deleted, errors), log it and publish it to live clients; (6) resync live state.

#### Scenario: Missing subscriptions created
- **WHEN** an active streamer has no subscriptions
- **THEN** three subscriptions are created with webhook transport, our callback and secret

#### Scenario: Paused or removed streamer
- **WHEN** a streamer is paused or deleted
- **THEN** its subscriptions are deleted by the next reconcile without restart

#### Scenario: Failed status replaced
- **WHEN** an existing wanted subscription has status `notification_failures_exceeded`
- **THEN** it is deleted and a new one is created

#### Scenario: Duplicates and foreign callbacks
- **WHEN** two identical subscriptions exist and a third subscription uses another callback URL
- **THEN** one duplicate is deleted and the foreign one is left untouched

#### Scenario: Partial failure
- **WHEN** creating one subscription fails
- **THEN** the others are still created and the error is recorded and visible in the UI

#### Scenario: Paused for one account only
- **WHEN** Mia pauses Gronkh while Tom still has Gronkh active
- **THEN** Gronkh's subscriptions stay

### Requirement: Reconcile triggers and single flight
Reconcile SHALL run at startup, after streamer/game changes (debounced ~2 s), at the configured interval (hours, default 6), after a revocation, and on demand (UI, CLI). At most one run SHALL execute at a time; any number of triggers during a run SHALL cause exactly one follow-up run.

#### Scenario: Triggers during a run
- **WHEN** three triggers arrive while a reconcile is running
- **THEN** exactly one additional reconcile runs afterwards

### Requirement: Live-state resync
At startup and after each reconcile the service SHALL query stream status for all active streamers (batches of up to 100), set or clear their live state, and run the notification check for those live — relying on dedup to avoid duplicate mails.

#### Scenario: Live at startup
- **WHEN** the service starts while an active streamer is live in a matching game
- **THEN** exactly one notification is queued for that stream
