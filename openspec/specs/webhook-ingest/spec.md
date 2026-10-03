# webhook-ingest Specification

## Purpose
Accept Twitch EventSub webhook deliveries on the public listener, authenticate them, persist them exactly once, and answer Twitch within its deadline.

## Requirements

### Requirement: Public listener exposes only the webhook
The public listener (port 8080) SHALL answer only `POST /webhook`; every other method or path SHALL return `404`.

#### Scenario: Other path on public port
- **WHEN** a client sends `GET /` or `GET /api/overview` to port 8080
- **THEN** the response is `404`

### Requirement: Signature verification before anything else
The service SHALL read the raw body unparsed and verify `sha256=` + hex(HMAC-SHA256(webhook secret, message-id + timestamp + raw body)) against `Twitch-Eventsub-Message-Signature` using a constant-time comparison with a prior length check. Missing required headers or a mismatch SHALL return `403` and nothing is stored.

#### Scenario: Valid signature
- **WHEN** a notification arrives with a correct signature and fresh timestamp
- **THEN** it is accepted (`204`) and stored in the inbox

#### Scenario: Invalid signature
- **WHEN** the signature does not match
- **THEN** the response is `403` and no inbox row exists

#### Scenario: Missing headers
- **WHEN** any of message id, timestamp or signature header is absent
- **THEN** the response is `403`

### Requirement: Timestamp freshness
Messages whose timestamp is more than 10 minutes in the past or future SHALL be rejected with `403`.

#### Scenario: Stale message
- **WHEN** a correctly signed message has a timestamp 11 minutes old
- **THEN** the response is `403`

### Requirement: Durable dedup by message id
After verification the message id SHALL be inserted into the inbox with insert-or-ignore semantics before any parsing; an already known id SHALL return `204` immediately without reprocessing.

#### Scenario: Duplicate delivery
- **WHEN** the same valid notification is delivered twice
- **THEN** both responses are `204` and the event is processed once

### Requirement: Message type handling
For `webhook_callback_verification` the service SHALL respond `200`, `Content-Type: text/plain`, body exactly the `challenge`. For `notification` it SHALL respond `204` right after persistence and wake the inbox worker. For `revocation` it SHALL log the reason, update the stored subscription status, trigger a reconcile, and respond `204`.

#### Scenario: Challenge
- **WHEN** a valid verification message with challenge `abc123` arrives
- **THEN** the response is `200`, `text/plain`, body exactly `abc123`

#### Scenario: Revocation
- **WHEN** a valid revocation arrives
- **THEN** the subscription row's status is updated, a reconcile is requested, and the response is `204`
