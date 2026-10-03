# Tasks

Gate (repo root): `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## 1. Hardening

- [x] 1.1 Fix the audit findings per specs/admin-api: SSE filtering per account/role (`http/sse.ts` and event payloads, M1); session absolute cap 90 days (`http/auth.ts`, L2); limiter keyed by IP and by lower-cased username with a size bound (L4); `password` max 200 in login/setup/change schemas and `bodyLimit` 64 KiB on the admin `/api/*` (L5); dummy hash computed at module start (L6); `Cache-Control: no-store` on all `/api/*` responses (L8); redaction adds `^code$`/`setupCode` keys and redacts configured secrets of any length ≥ 4 (L1, L7); scrypt N=2^17 for new hashes with transparent rehash on successful login when stored parameters are lower (L3, keep verification of old hashes). Tests for each. Done: tests pass, gate green.
