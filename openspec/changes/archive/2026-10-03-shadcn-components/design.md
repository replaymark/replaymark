# Design

## Context

shadcn config: `apps/web/components.json`, style `base-nova`, Base UI primitives, Tailwind 4 CSS-first (`src/styles.css`). Existing ui components: badge, button, combobox, dialog, input-group, input, label, popover, radio-group, separator, sonner, switch, table, textarea, tooltip. Error colour token is `crimson`; `live` stays reserved for live.

## Goals / Non-Goals

**Goals:** standard components everywhere a shadcn equivalent exists; one error presentation.
**Non-Goals:** cards (`surface` utility stays), the mobile bottom nav layout, Skeleton/Spinner, colour token changes.

## Decisions

- Components are added with `pnpm dlx shadcn@latest add <name>` from `apps/web` so they match the configured style; generated files are kept as generated except for import paths and lint fixes. If the CLI cannot run offline/non-interactively, copy the base-nova variants from the shadcn registry by hand and say so.
- `Alert` destructive variant uses the `crimson` token (adjust the generated variant to `text-crimson` if it uses `destructive`, and map `--destructive` to crimson only if the token is missing).
- Field-level errors keep `FieldError`; page- and form-level errors use `Alert`.
- `ToggleGroup` for the theme and language switch keeps the current look (active item styled like the active nav item, per commit 7183d2d).

## Risks / Trade-offs

- [Visual drift from generated defaults] → each task checks the page in `pnpm build` and keeps existing classes where the look must stay.
