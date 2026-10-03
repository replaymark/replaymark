# Design

## Context

UI language: `apps/web/src/i18n/i18n.tsx` picks the saved choice or the browser language (German for `de*`, else English). Mail language: per account (`users.mail_language`), new accounts get `de` (setup in `auth.ts`, user creation in `admin.ts`, migration default). Env validation in `apps/server/src/env.ts`.

## Decisions

- `DEFAULT_LANGUAGE` (`en`|`de`, default `en`) in `env.ts`, passed to the app deps.
- The SPA learns it without a session from `GET /api/auth/setup`, which gains `defaultLanguage`; the UI only needs it when neither a saved choice nor a supported browser language exists. Until the response arrives the UI uses English (no flicker in the common case because the browser language usually decides).
- New accounts (setup, user management) get `mail_language = DEFAULT_LANGUAGE`; the DB column default stays as is (code always sets it explicitly); existing accounts are not changed.
- German wording: review all of `de.ts` and the German mail strings; replace Germanised technical terms with the loanwords German users use (Sync, Webhook, Callback-URL, Stream, Streamer, Live, Login stays; "Abgleich" → "Sync" everywhere incl. compounds like "Sync-Intervall", "Letzter Sync"). Keep plain German where natural ("Einstellungen", "Verlauf", "Benutzer").

## Risks / Trade-offs

- [German users of existing installations see changed labels] → only wording; no behaviour change.
