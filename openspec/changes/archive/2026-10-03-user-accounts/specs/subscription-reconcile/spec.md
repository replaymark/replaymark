# Spec Delta

## MODIFIED Requirements

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
