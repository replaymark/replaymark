# Proposal

## Why

A security audit of credential handling found no critical or high issues, but one medium issue (the event stream sends every account's live, notification and sync events to every logged-in user) and several low hardening gaps.

## What Changes

- Event stream scoped per account; sync and subscription events only for administrators.
- Absolute session lifetime of 90 days.
- Rate limiting also per username, bounded limiter memory; password length limit and admin body limit before hashing.
- Log redaction also covers setup codes and short secrets; dummy hash precomputed at start; `Cache-Control: no-store` on API responses; scrypt cost raised with rehash on login.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `admin-api`: sessions, login rate limit, server-sent events.

## Impact

`apps/server/src/http/{sse,auth,admin}.ts`, `apps/server/src/log.ts`, `apps/server/src/shared/schemas.ts`, `apps/server/src/index.ts`, tests.
