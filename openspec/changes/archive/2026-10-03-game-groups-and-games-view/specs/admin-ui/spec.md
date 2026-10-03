# Spec Delta

## MODIFIED Requirements

### Requirement: Pages
The UI SHALL provide: Login (password + error only); Overview (page header with date kicker and "add streamer" as the single primary action; link tiles for live now, active/expected subscriptions, last sync with result, failed mails; a "needs attention" list; live cards showing avatar, a LIVE badge, start time and duration, box art with game and stream title, a reason line and a link to watch the channel on Twitch; a searchable, filterable streamer list with avatar and live dot, name, plain-text state with the current game when live, mode with its groups and game list, a subscription issue text when not all subscriptions are enabled, the active switch and an edit button); Streamer add/edit (login → preview with avatar and name before saving, mode default/custom/any, for mode custom a multi-select of game groups showing each group's game count plus a debounced category search combobox with box art and removable chips for single games, active switch, delete with confirmation); Games (the default group first, labelled "Default games" / "Standard-Spiele", then the other groups by name; each group shows its name, its games as removable chips with box art, a debounced category search to add games and the number of streamers using it; rename and delete with confirmation naming the number of affected streamers for non-default groups; "new group" as the single primary action; an empty state explaining groups when only the default group exists); History (status filter with counts per status, failed mails grouped first under "needs attention", then the rest; each row with box art, streamer, game, stream title, time, status, attempts, error, next attempt time for pending mails and retry for failed; "retry all failed" as the single primary action, shown only when mails failed); Settings (recipients add/remove with validation, interval with its allowed range, mail language, test mail button naming the number of recipients, callback URL with a copy button, a Twitch sync section with last sync and its result, active/expected subscriptions, next sync, a "sync now" button with loading state and a list of failing or missing subscriptions per streamer and event with an explanation, and a save bar at the bottom that shows unsaved changes and offers save and discard). The former Subscriptions page path SHALL redirect to the Settings sync section.

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
- **THEN** the Settings sync section lists that streamer with "missing" for that event and an explanation, and "sync now" starts a sync

#### Scenario: Old subscriptions link
- **WHEN** the operator opens `/subscriptions`
- **THEN** the Settings page opens scrolled to the Twitch sync section

#### Scenario: Assign a group
- **WHEN** the operator edits a streamer, picks mode custom, selects the group "Soulslikes" and saves
- **THEN** the streamer row shows "Soulslikes" in its mode line and the Games page counts one more streamer for that group

#### Scenario: Delete a used group
- **WHEN** the operator deletes a group used by 2 streamers
- **THEN** the confirmation names the 2 streamers before anything is deleted

#### Scenario: Retry all
- **WHEN** three mails failed and the operator activates "retry all failed"
- **THEN** all three are queued again, the failed count drops to 0 and the button disappears

#### Scenario: Unsaved settings
- **WHEN** the operator changes the interval without saving
- **THEN** the save bar says there are unsaved changes, and "discard" restores the stored values

### Requirement: Overview triage
The Overview SHALL list, above the streamers, every condition that needs the operator: failed mails, enabled streamers with a subscription in state error or missing, and a failed last sync. Each item SHALL name the cause in text, SHALL add a detail line where one is known (the newest mail error; what the subscription state means and what resolves it), and SHALL link to the page that resolves it (subscription and sync problems link to the Settings sync section). The list SHALL be hidden when there is nothing to show. Every live card SHALL state in text whether the stream matched and, for a match, the mail state (sent with time, queued, failed, none yet); for no match, the reason (not a default game, not in the streamer's games or groups); for a paused streamer, that it triggers no mails. The reason line icon MAY carry a state colour (sent, queued, failed, neutral). No state SHALL be conveyed by colour alone, and tally red SHALL stay reserved for live.

#### Scenario: Failed mail
- **WHEN** a mail for a live match has failed with error "SMTP 550"
- **THEN** the live card reads "Match · mail failed" / "Treffer · Mail fehlgeschlagen" with an error icon, and the attention item names the failed mails, shows "SMTP 550" as its detail and links to the History page filtered to failed mails

#### Scenario: Broken subscription
- **WHEN** an enabled streamer's `stream.online` subscription is in state error
- **THEN** the attention list names the streamer and the affected event, explains that Twitch rejected the subscription, and links to the Settings sync section

#### Scenario: All fine
- **WHEN** there are no failed mails, no failing subscriptions and the last sync succeeded
- **THEN** no attention list is shown

### Requirement: Roster search and filter
The streamer list on the Overview SHALL offer a labelled search by display name, login, current game, a game of the streamer's effective game list (single games and games of assigned groups) or the name of an assigned group, and a labelled filter All / Live / Active / Paused with the count per option. Search and filter SHALL live in the URL. The section headings SHALL show the total number of streamers and of live streamers. When nothing matches, the list SHALL say so and offer to reset the filter.

#### Scenario: Filter live
- **WHEN** the operator selects "Live"
- **THEN** only live streamers are listed and the URL contains `filter=live`

#### Scenario: Search by game
- **WHEN** the operator searches "elden" and one streamer has Elden Ring in its custom list
- **THEN** that streamer is listed

#### Scenario: Search by group game
- **WHEN** the operator searches "elden" and one streamer has only the group "Soulslikes" containing Elden Ring
- **THEN** that streamer is listed

#### Scenario: No result
- **WHEN** the search matches no streamer
- **THEN** the list shows a no-match message with a "Reset filter" action
