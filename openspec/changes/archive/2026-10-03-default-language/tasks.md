# Tasks

Gate (repo root): `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## 1. Server

- [x] 1.1 `DEFAULT_LANGUAGE` in `apps/server/src/env.ts` (validated, default `en`), passed through `app.ts` deps; `GET /api/auth/setup` returns `defaultLanguage`; account creation in setup (`http/auth.ts`) and user management (`http/admin.ts`) sets `mail_language` to it; `.env.example` and `docs/configuration.md` document it. Tests: env validation (`fr` rejected, missing → `en`), setup response field, new account language for both creation paths. Done: tests pass, gate green.

## 2. Web

- [x] 2.1 `apps/web/src/i18n/i18n.tsx`: initial language = saved choice → supported browser language → `defaultLanguage` from the setup query → English; German wording per design.md in `apps/web/src/i18n/de.ts` and German mail strings on the server (find them, e.g. `apps/server/src/mail/`); update tests that assert German strings. Done: `grep -rn "Abgleich" apps` empty, gate green.
