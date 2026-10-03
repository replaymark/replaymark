# Proposal

## Why

Some UI is hand-built where the project's shadcn setup (style `base-nova`, Base UI) has a standard component: native selects and checkboxes that ignore the dark theme, about 15 copies of the same error line, raw buttons and labels. This makes the look inconsistent (the light native role dropdown) and duplicates class strings.

## What Changes

- Add shadcn `select`, `checkbox`, `alert` and `toggle-group` via the shadcn CLI.
- Replace native `<select>` (users page) with `Select`; drop `SELECT_CLASS`.
- Replace native checkboxes (streamer dialog group picker, timeline filter) with `Checkbox`.
- Replace repeated crimson error paragraphs and hand-set `role="alert"` blocks with `Alert` (destructive) or the existing `FieldError` for field-level errors.
- Replace raw `<button>`/`<label>` with `Button`/`Label`; the theme/language switcher becomes a `ToggleGroup`.
- No behaviour change; no spec change (`skip_specs`).

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- none

## Impact

`apps/web/src/components/ui/` (new files), `routes/_app/users.tsx`, `components/streamer-dialog.tsx`, `routes/_app/timeline.index.tsx`, `routes/_app/{settings,history,index,games,timeline.$streamId}.tsx`, `routes/{login,setup,change-password}.tsx`, `components/{field-error,app-shell,roster-row,timeline}.tsx`.
