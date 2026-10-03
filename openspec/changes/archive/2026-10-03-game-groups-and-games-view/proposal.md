# Proposal

## Why

The Subscriptions page only shows Twitch EventSub state and one sync button, so it duplicates what the Overview already surfaces and offers nothing to do. Games, the thing the operator actually curates, are hidden as a single "default games" field in Settings, and every streamer with its own selection needs its games picked one by one — there is no way to reuse a set of games across streamers.

## What Changes

- New **game groups**: named sets of games, managed on a new **Games** page ("Spiele") that replaces the Subscriptions entry in the navigation.
- A streamer in mode `custom` can be assigned any number of groups **in addition to** single games. A category matches when it is in one of the assigned groups or in the single games. Editing a group takes effect immediately for every streamer that has it.
- The **default games become a group**: existing default games are migrated into one built-in default group (shown as "Default games" / "Standard-Spiele"). It cannot be deleted or renamed; streamers in mode `default` use it.
- **BREAKING (admin API)**: `PUT /api/settings` no longer accepts `defaultCategoryIds` and `GET /api/settings` no longer returns default games; the default group is edited through the new group endpoints.
- The Settings page loses the default-games field and gains a **Twitch sync** section: last sync with result, active/expected subscriptions, next sync, "sync now", and the list of failing or missing subscriptions with their explanation.
- The Subscriptions page is removed; `/subscriptions` redirects to the Settings sync section. Attention items for broken subscriptions link there.
- The import (`defaultGames` in the import file) keeps working and fills the default group.

## Capabilities

### New Capabilities
- `game-groups`: named, reusable sets of games, the built-in default group, and assigning groups to streamers.

### Modified Capabilities
- `game-notifications`: category matching includes games from a streamer's assigned groups; default mode reads the default group.
- `admin-api`: group endpoints, `groupIds` on streamer patch, settings without default games.
- `admin-ui`: Games page, streamer dialog with group selection, Subscriptions page folded into a Settings sync section, attention links updated.

## Impact

- Server: `apps/server/src/db/schema.ts` + new drizzle migration (0006), `src/notify/match.ts`, `src/http/admin.ts`, `src/http/internal.ts`, `src/shared/schemas.ts`, tests in `apps/server/test/`.
- Web: new `apps/web/src/routes/_app/games.tsx`, removed `subscriptions.tsx`, `settings.tsx`, `components/streamer-dialog.tsx`, `components/app-shell.tsx`, `lib/streamers.ts`, `lib/queries.ts`, i18n `de.ts`/`en.ts`.
- `GET /api/subscriptions` and `POST /api/sync` stay unchanged.
