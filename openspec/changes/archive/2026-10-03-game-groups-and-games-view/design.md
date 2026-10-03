# Design

## Context

Matching lives in `apps/server/src/notify/match.ts` (`categoryMatches`): `any` → true, `custom` → `streamerGames`, otherwise `defaultGames`. Default games are a separate table replaced wholesale by `PUT /api/settings`; per-streamer games are replaced by `PATCH /api/streamers/:id`. The import (`internal.ts`, `cli.ts`) writes both. The web app is React + TanStack Router (file routes) + TanStack Query over Hono RPC; the Subscriptions page (`routes/_app/subscriptions.tsx`) holds the sync tiles, sync mutation and per-streamer subscription rows.

## Goals / Non-Goals

**Goals:**
- One concept for game sets: the default games are just the default group.
- Matching stays a single query per check; no denormalised copies of group games on streamers.

**Non-Goals:**
- Groups in the import file (only `defaultGames` keeps working, mapped to the default group).
- Groups for mode `default` streamers or nested groups.
- Changes to `GET /api/subscriptions` or `POST /api/sync`.

## Decisions

- **Tables** (migration 0006): `game_groups (id integer pk autoincrement, name text not null, is_default integer not null default 0, created_at)` with a unique index on `lower(name)` and a partial unique index on `is_default` where `is_default = 1`; `game_group_categories (group_id → game_groups cascade, category_id → categories, pk(group_id, category_id))`; `streamer_groups (user_id → streamers cascade, group_id → game_groups cascade, pk(user_id, group_id))`. The migration inserts the default group (name `Default`), copies `default_games` into it and drops `default_games`. Alternative kept-separate default table rejected: two code paths for the same thing.
- **Matching**: `custom` → exists in `streamer_games` OR exists in `game_group_categories` joined via `streamer_groups`; `default` → exists in `game_group_categories` of the default group. Evaluated live, so group edits need no fan-out.
- **API**: `GET /api/game-groups` returns `{ id, name, isDefault, games: CategoryDto[], streamerCount }[]`, default first then by name. `POST` `{ name, categoryIds }`, `PATCH /:id` `{ name?, categoryIds? }` (name rejected for default with `400`), `DELETE /:id` (`400` for default, `404` unknown). Category ids are resolved/validated exactly like the streamer patch (same helper). Duplicate name → `409` with error code. Every mutation calls `reconciler.requestDebounced('game groups changed')` and emits the same SSE invalidation the streamer patch emits. `patchStreamerInput` gains `groupIds: number[]` (max 50); unknown id → `400`. The streamer DTO gains `groups: { id, name }[]`. `settingsInput` drops `defaultCategoryIds`; the settings DTO drops default games.
- **Import**: `defaultGames` adds to the default group's games (as before with the dropped table); a re-imported streamer's groups are cleared with its single games.
- **Web**: new route `_app/games.tsx` with query `gameGroupsQuery` and mutations in `lib/queries.ts`; nav item "Games"/"Spiele" replaces "Subscriptions"/"Abos" in `app-shell.tsx`. The Settings sync section reuses the tiles, sync mutation and row helpers moved out of `subscriptions.tsx` into `components/sync-status.tsx`; only failing/missing rows are listed. `routes/_app/subscriptions.tsx` becomes a redirect to `/settings#sync`. Streamer dialog: in mode custom a group multi-select (checkbox list or combobox with chips) above the single-game picker. `lib/streamers.ts` mode label and roster search include group names and group games (the client gets group games from `gameGroupsQuery`).
- **Default group label**: the UI always shows the translated label for `isDefault`, never the stored name, so the name needs no translation.

## Risks / Trade-offs

- [Dropping `default_games` makes rollback lossy] → the migration copies first; a rollback to the previous release would need the default games re-entered. Acceptable for a single-operator app; noted in the release notes.
- [Breaking settings API] → only the bundled web client uses it; client and server ship together.
- [Live card "no match" reason must consider groups] → the reason uses the same server match result, not a client recomputation.

## Migration Plan

Deploy as usual; drizzle runs 0006 on start. Verify on the Games page that the default group holds the former default games.
