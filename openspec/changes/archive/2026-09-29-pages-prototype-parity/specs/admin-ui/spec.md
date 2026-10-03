## MODIFIED Requirements

### Requirement: Pages
The UI SHALL provide: Login (password + error only); Overview (page header with date kicker and "add streamer" as the single primary action; link tiles for live now, active/expected subscriptions, last sync with result, failed mails; a "needs attention" list; live cards showing avatar, a LIVE badge, start time and duration, box art with game and stream title, a reason line and a link to watch the channel on Twitch; a searchable, filterable streamer list with avatar and live dot, name, plain-text state with the current game when live, mode with its game list, a subscription issue text when not all subscriptions are enabled, the active switch and an edit button); Streamer add/edit (login → preview with avatar and name before saving, mode default/custom/any, debounced category search combobox with box art and removable chips, active switch, delete with confirmation); Subscriptions (tiles for last sync with result, active/expected subscriptions and next sync with a link to the interval setting; one row per streamer with avatar and the state of each event type, including missing subscriptions, an explanation and a "create again" action for failing ones, a legend, rows for subscriptions without a known streamer; "sync now" as the single primary action with loading state); History (status filter with counts per status, failed mails grouped first under "needs attention", then the rest; each row with box art, streamer, game, stream title, time, status, attempts, error, next attempt time for pending mails and retry for failed; "retry all failed" as the single primary action, shown only when mails failed); Settings (default games combobox, recipients add/remove with validation, interval with its allowed range, mail language, test mail button naming the number of recipients, callback URL with a copy button, and a save bar at the bottom that shows unsaved changes and offers save and discard).

Every page SHALL have a visible page title, SHALL use at most one solid ink button (its primary action), SHALL convey no state by colour alone, and SHALL work at 375 px without horizontal scrolling and without truncating status text.

#### Scenario: Empty state
- **WHEN** no streamers exist
- **THEN** the overview shows a hint to add the first streamer

#### Scenario: Tile navigates
- **WHEN** the operator activates the failed-mails tile
- **THEN** the History page opens filtered to failed mails

#### Scenario: Watch a live streamer
- **WHEN** the operator activates "Watch" on a live card
- **THEN** the streamer's Twitch channel opens in a new tab

#### Scenario: Missing image
- **WHEN** a streamer has no avatar or the current game has no box art
- **THEN** a neutral placeholder (initial letter, game icon) is shown and the layout does not shift

#### Scenario: Missing subscription visible
- **WHEN** an enabled streamer has no `stream.offline` subscription
- **THEN** the Subscriptions page shows that streamer's row with "missing" for that event, an explanation and a "create again" action that starts a sync

#### Scenario: Retry all
- **WHEN** three mails failed and the operator activates "retry all failed"
- **THEN** all three are queued again, the failed count drops to 0 and the button disappears

#### Scenario: Unsaved settings
- **WHEN** the operator changes the interval without saving
- **THEN** the save bar says there are unsaved changes, and "discard" restores the stored values

### Requirement: Timeline page
The UI SHALL provide a Timeline page ("Timeline" / "Zeitleiste") in the main navigation. It has these parts:
- **Header:** the page title and a kicker naming since when data is recorded.
- **Game picker:** the existing debounced Twitch category search, plus quick picks for the categories already recorded (box art, stream count, last played).
- **Filters:** an optional multi-select of streamers as a compact dropdown with checkboxes, and an optional date range.
- **Results:** without a chosen game, the most recent streams of all games; with a game, the streams that contain it. One card per stream, newest first. Each card shows the streamer avatar and name, the stream date, start, end and total duration, the VOD state, a proportional strip of all segments of the stream with the chosen game highlighted, and one row per segment of the chosen game (every segment when no game is chosen) with its time window (in the browser's local time zone), its duration, the approximate and muted hints, and an outlined "Watch from here" / "Ab hier ansehen" link.
- **Stream detail:** opened from a card, with the stream as page title. It shows every segment of that stream as a proportional horizontal strip with visible labels (game name where it fits, otherwise in a legend) and start and end times on an axis, plus a list, with the chosen game highlighted.

The filter state SHALL live in the URL so a view can be bookmarked. The page SHALL follow the existing design direction (at most one solid ink button, tally red only for live), work at 375 px without horizontal scrolling, and have all strings in both languages. With no recorded data, it SHALL explain that recording starts at deployment and only covers tracked streamers.

#### Scenario: Find a session
- **WHEN** the operator picks game G
- **THEN** the page lists every recorded stream with G segments, and each segment's link opens the VOD in a new tab at the segment start

#### Scenario: Recent streams
- **WHEN** the operator opens the Timeline without picking a game
- **THEN** the most recent recorded streams of all games are listed with their full segment strips

#### Scenario: No VOD
- **WHEN** a stream has VOD state `none`
- **THEN** its time windows are shown without links, with the hint "no VOD saved" / "kein VOD gespeichert"

#### Scenario: Live stream
- **WHEN** a listed stream is still live
- **THEN** its card shows the live badge, and its open segment updates without reloading
