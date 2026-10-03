# design-sync notes (replaymark)

- **Source shape:** `apps/web` is an app, not a library. `.design-sync/ds-package/` is a thin DS package that /design-sync converts:
  `src/index.ts` re-exports the presentational components from `apps/web/src/components` (+ `toast` from sonner and a
  `ReplaymarkProvider` = Theme + I18n + Tooltip providers, the app root minus router/query). New DS components must be added there.
- **Build first:** `node .design-sync/ds-package/build.mjs` (cfg.buildCmd) emits the `.d.ts` tree (tsc, aliases `@/`, `@shared/`
  rewritten to relative paths), `dist/css/replaymark.css` (Tailwind compiled via vite from `ds.css`) and `dist/tokens/tokens.css`.
  Then `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules apps/web/node_modules --out ./ds-bundle`.
- **Install:** `pnpm i --frozen-lockfile --ignore-scripts` (better-sqlite3 needs node-gyp, which isn't installed; server types are
  still needed for tsc). `COREPACK_ENABLE_STRICT=0` if pnpm self-provisioning complains.
- `.design-sync/ds-package/node_modules` is a symlink to `../../apps/web/node_modules` (gitignored); build.mjs needs it for tsc
  to resolve react from `src/provider.tsx` - recreate per clone: `ln -sfn ../../apps/web/node_modules .design-sync/ds-package/node_modules`.
- **--tw-* tokens (Claude Design complaint):** build.mjs drops Tailwind's `@layer properties` fallback (`*{--tw-…:initial}`) and
  rewrites single-class utilities that set `--tw-*` to `:is(.x)` (same specificity) so they don't register as token scopes/themes.
  `@property --tw-*` rules stay, so every var still has its initial value.
- **`/* @kind other */` markers (Claude Design request after the 2026-09-28 sync):** build.mjs appends a same-line
  `/* @kind other */` to (a) Tailwind's non-theme defaults in `@layer theme` (`--animate-*`, `--aspect-*`, `--ease-*`,
  `--perspective-*`, `--default-transition-*`) and (b) every `--tw-*` declaration inside a utility rule. Claude Design flagged
  them as "unassigned tokens" / "variables under utility selectors" - warnings only, rendering is unaffected. If the
  app still lists them, check which annotation placement it expects (same line after `;` is the current guess).
- **--tw-* inlining (Claude Design still reported 221 "--tw-* on utility classes" after the markers):** build.mjs now
  substitutes and deletes every --tw-* var whose value can't depend on another class (always equal to its @property
  initial-value, e.g. `--tw-space-*-reverse`; or set and read only inside the same rules, e.g. `--tw-font-weight`,
  `--tw-tracking`). 221 -> ~79. Verified lossless: computed styles of every element in all 23 cards identical
  before/after (pixel diffs only from caret/timing noise, which also shows up bundle-vs-itself).
  The rest genuinely compose across classes and can't be removed without changing rendering: ring/ring-color/shadow
  (focus rings, shadows), translate-x + translate-y (Dialog/Popover/Tooltip centering, Switch thumb), duration +
  transition, tw-animate enter/exit (overlay animations), text-* + leading-*, border-style/outline-style. Expect Claude
  Design to keep reporting those (warning only).
- **Decision 2026-09-29: the remaining 79 --tw-* warnings stay.** Claude Design's hint (drop every --tw-* outside
  :root and write literal values per class) was built and diffed: 11/23 cards changed - RadioGroup dot off-centre
  (`translate: -50% -50%` -> `0 -50%`), Dialog/Popover/Combobox lose their `ring-1 ring-foreground/10` border and open
  animation, Input/Textarea/Switch lose the focus ring. `@kind other` comments don't silence the check. The user chose
  to keep correct rendering over a clean warning list - don't retry this on later syncs.
- **Tokens:** the unlayered `:root` / `.dark` palette is moved out of the compiled CSS into `tokens/tokens.css`; aliases are repeated in
  `.dark` so a nested `.dark` wrapper works. cfg.tokensPkg points at the ds-package via `../../../.design-sync/ds-package` (relative to
  apps/web/node_modules) - a path hack, the log prints `@undefined` as version.
- **Tailwind safelist:** `ds.css` safelists everyday layout/typography/colour utilities and the app's `@utility` classes
  (surface, empty-state, page-title, kicker) so designs can use them; the compiled CSS otherwise only holds classes the app uses.
- Sub-parts (DialogContent, TableRow, ComboboxItem, …) and providers are in the bundle but excluded from cards via
  `componentSrcMap: null`; their composition is documented in `.design-sync/docs/<Root>.md` (which also sets the card group).
- Docs replace the synthesized prompt, so each doc carries its own `## Example`; previews live in `.design-sync/previews/`.
- Headless render: playwright must match the cached chromium (`/opt/pw-browsers/chromium-1194` -> `playwright@1.56.1` in `.ds-sync`).

## Known render warns
- `[RENDER_THIN] Dialog` - portal content measures 0px; the screenshot shows the open dialog correctly.
- `[TOKENS_MISSING]` for `--anchor-width`, `--available-*`, `--transform-origin` (Base UI sets them at runtime) and
  `--tw-ring-offset-*` / `--tw-inset-*` (declared via `@property`, which the validator doesn't count).

## Re-sync risks
- The barrel in `ds-package/src/index.ts` is hand-maintained: new/renamed components in apps/web don't sync until added there.
- Docs in `.design-sync/docs/` describe props by hand; re-check them when component APIs change.
- Timeline previews use fixed fixture data shaped like `TimelineStream` / `TimelineSegment` from `apps/server/src/shared/schemas.ts`.
- Headless locale is English, so i18n strings in timeline cards render in English there; the app picks de/en from the browser.
- Project also holds `templates/replaymark-redesign/` (authored in Claude Design, not from this repo) plus app-generated
  `_ds_manifest.json`, `_adherence.oxlintrc.json`, `github.md` - never delete these on sync.
