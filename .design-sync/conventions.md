## Brand direction: "Bauchbinde"

The UI borrows from the broadcast lower-third (German: *Bauchbinde*): a dark caption band with condensed capitals over the programme.

- **Display type:** Big Shoulders Display (variable, 100–900), condensed; headings, page titles, streamer names — usually bold/extra-bold, often uppercase. Utility: `font-display`.
- **Body type:** Atkinson Hyperlegible Next (variable); everything else. Utility: `font-sans` (default). Use `tabular` for times, durations, counts.
- **Palette:** paper (page background), sheet (cards/popups), ink (text, primary buttons, highlights), rule (hairlines), band (dark caption band) with band-ink text.
- **Tally red (`--live`) is reserved strictly for "live"** — the `TallyLamp` and `LiveBadge`. Never use it for errors, CTAs or emphasis. Errors use crimson (`--crimson` / `destructive`), always with an icon.
- Hairlines before shadows; shadows are whisper-quiet. Radius 8px everywhere; only dialogs use 10px (`rounded-xl`).
- Dark mode: `class="dark"` on `<html>` (or any wrapper). Every colour is a token, so components switch automatically.

## Tokens (tokens/tokens.css)

| Token | Light | Dark | Tailwind |
| --- | --- | --- | --- |
| --paper | #eceef2 | #10141d | bg-paper, = background / muted / secondary / accent |
| --sheet | #ffffff | #191f2c | bg-sheet, = card / popover |
| --ink | #161c28 | #e8ecf3 | text-ink, bg-ink, = foreground / primary / ring |
| --muted-ink | #556072 | #9aa5b8 | text-muted-foreground |
| --rule | #d5dae2 | #2a3244 | border-rule, = border / input |
| --band | #1a2130 | #0a0d14 | bg-band |
| --band-ink | #f3f5f9 | #e8ecf3 | text-band-ink |
| --live | #e5322d | #e5322d | bg-live (live only!) |
| --crimson | #b4232c | #f07178 | text-crimson, = destructive / status-error |
| --status-enabled | #2e9e6a | same | text-status-enabled |
| --status-pending | #d99a1e | same | text-status-pending |
| --radius / --radius-dialog | 8px / 10px | | rounded-md/lg, rounded-xl |

Semantic shadcn names (background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring) map onto these.

## Layout patterns (classes in _ds_bundle.css)

- **Page title** — `<h1 className="page-title">Timeline</h1>`: condensed caps display type, 36px, with a 5px ink tab on the left like a lower-third caption.
- **Kicker** — `<p className="kicker">Einstellungen</p>`: 11px bold tracked caps in muted ink, above titles and sections.
- **Surface card** — `<section className="surface p-4">…</section>`: white sheet on paper, hairline border, 8px radius, soft lift (flat in dark). Lists inside use `divide-y`.
- **Empty state** — `<div className="empty-state">Noch keine Streamer.</div>`: dashed frame with a faint scanline texture, centred muted text.
- **Band** — `<header className="bg-band text-band-ink">`: the dark caption band (app header, emphasis strips).
- Page: `bg-background text-foreground`, content column ~`max-w-4xl`, spacing in 4px steps.
