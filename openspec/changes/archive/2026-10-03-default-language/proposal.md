# Proposal

## Why

As a public project replaymark should default to English, and operators want to choose the default language of their instance. The German texts also translate terms that German-speaking users know and use in English (e.g. "Abgleich" for "Sync"), which reads unnatural.

## What Changes

- New environment variable `DEFAULT_LANGUAGE` (`en` | `de`, default `en`).
- UI: initial language is the saved choice, else the browser language if it is supported, else `DEFAULT_LANGUAGE`.
- Mails: new accounts get `DEFAULT_LANGUAGE` as mail language (existing accounts keep theirs).
- German UI and mail texts use established English loanwords where German users commonly do (Sync instead of Abgleich, etc.).

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `admin-ui`: initial language fallback from the server default.
- `game-notifications`: default mail language of new accounts from `DEFAULT_LANGUAGE`.
- `operations`: `DEFAULT_LANGUAGE` is a validated environment variable.

## Impact

`apps/server/src/env.ts`, account creation (setup, user management) in `apps/server/src/http/auth.ts`/`admin.ts`, an unauthenticated way for the SPA to learn the default (e.g. `GET /api/auth/setup` response), `apps/web/src/i18n/i18n.tsx`, `apps/web/src/i18n/de.ts`, mail templates, `.env.example`, `docs/configuration.md`.
