# Tasks

Gate for every task (repo root): `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (bogus "ESLint JSON parse failed" from rtk → rerun `rtk proxy pnpm lint`).

## 1. Components

- [x] 1.1 Add shadcn `select`, `checkbox`, `alert`, `toggle-group` to `apps/web/src/components/ui/` per design.md; replace both native `<select>` in `apps/web/src/routes/_app/users.tsx` with `Select` and delete `SELECT_CLASS`; replace the native checkboxes in `apps/web/src/components/streamer-dialog.tsx` (group picker) and `apps/web/src/routes/_app/timeline.index.tsx` (filter) with `Checkbox`, keeping labels clickable and accessible. Done: gate green, `grep -rn '<select\|type="checkbox"' apps/web/src --include=*.tsx | grep -v components/ui` empty.

## 2. Errors

- [x] 2.1 Replace the repeated crimson error paragraphs and hand-set `role="alert"` blocks with `Alert` (form/page level) or `FieldError` (field level) in `routes/_app/{users,settings,history,index,games,timeline.$streamId}.tsx`, `components/streamer-dialog.tsx`, `routes/{login,setup,change-password}.tsx`; adjust `components/field-error.tsx` if needed. Done: gate green, `grep -rn 'text-crimson' apps/web/src --include=*.tsx` only hits status/failure indicators (status-tiles, attention-list, roster-row, history status), `ui/alert.tsx` and `field-error.tsx`.

## 3. Buttons and labels

- [x] 3.1 Replace raw `<button>` with `Button` in `routes/change-password.tsx`, `components/roster-row.tsx`, `components/timeline.tsx`, `routes/_app/timeline.index.tsx`; the theme/language switcher in `components/app-shell.tsx` becomes `ToggleGroup` with unchanged look; raw `<label>` in `routes/_app/history.tsx`, `routes/_app/index.tsx`, `routes/_app/timeline.index.tsx` becomes `Label`. Done: gate green, `grep -rn '<button\|<label' apps/web/src --include=*.tsx | grep -v components/ui` empty.

## 6. Integration

- [x] 6.1 Operator checks in the browser (dark and light, 375 px): role select on the users page, group checkboxes in the streamer dialog, timeline filter, an error alert (wrong login), theme/language switcher. Done: all look consistent.

## 5. Review fixes

- [x] 5.1 Fix review findings (apps/web): `components/roster-row.tsx:82` drop `relative` so the whole row stays the click target; `components/app-shell.tsx` language ToggleGroup items keep the old active look in light and dark (`aria-pressed:bg-white/15`, hover keeps band-ink text) and get a visible focus ring on the band; `routes/login.tsx` field "required" errors use `FieldError`, only the form error uses `Alert`; `routes/_app/users.tsx` create-user server error uses `Alert`; `routes/_app/timeline.index.tsx` chips add `dark:hover:bg-paper`, filter Label adds `leading-normal`; `routes/_app/index.tsx` search Label keeps the kicker weight/line-height; `components/timeline.tsx` hint keeps `hover:text-muted-foreground`. Done: gate green.
