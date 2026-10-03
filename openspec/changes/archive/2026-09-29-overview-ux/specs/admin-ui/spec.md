# Spec Delta

## MODIFIED Requirements

### Requirement: Pages
The UI SHALL provide: Login (password + error only); Overview (page header with date kicker and "add streamer" as the single primary action; link tiles for live now, active/expected subscriptions, last sync with result, failed mails; a "needs attention" list; live cards with a reason line; a searchable, filterable streamer list with avatar, name, plain-text state, mode, a subscription issue text when not all subscriptions are enabled, and the active switch); Streamer add/edit (login → preview with avatar and name before saving, mode default/custom/any, debounced category search combobox with box art and removable chips, active switch, delete with confirmation); Subscriptions (table, "sync now" with loading state, last result); History (time, streamer, game, status, error, status filter, retry for failed); Settings (default games combobox, recipients add/remove with validation, interval, mail language, test mail button, read-only callback URL).

#### Scenario: Empty state
- **WHEN** no streamers exist
- **THEN** the overview shows a hint to add the first streamer

#### Scenario: Tile navigates
- **WHEN** the operator activates the failed-mails tile
- **THEN** the History page opens filtered to failed mails

## ADDED Requirements

### Requirement: Overview triage
The Overview SHALL list, above the streamers, every condition that needs the operator: failed mails, enabled streamers with a subscription in state error or missing, and a failed last sync. Each item SHALL name the cause in text and link to the page that resolves it. The list SHALL be hidden when there is nothing to show. Every live card SHALL state in text whether the stream matched and, for a match, the mail state (sent with time, queued, failed, none yet); for no match, the reason (not a default game, not in the custom list); for a paused streamer, that it triggers no mails. No state SHALL be conveyed by colour alone, and tally red SHALL stay reserved for live.

#### Scenario: Failed mail
- **WHEN** a mail for a live match has failed
- **THEN** the live card reads "Match · mail failed" / "Treffer · Mail fehlgeschlagen" with an error icon, and the attention list links to the History page filtered to failed mails

#### Scenario: Broken subscription
- **WHEN** an enabled streamer's `stream.online` subscription is in state error
- **THEN** the attention list names the streamer and links to the Subscriptions page

#### Scenario: All fine
- **WHEN** there are no failed mails, no failing subscriptions and the last sync succeeded
- **THEN** no attention list is shown

### Requirement: Roster search and filter
The streamer list on the Overview SHALL offer a search by display name or login and a filter All / Live / Active / Paused with the count per option. Search and filter SHALL live in the URL. When nothing matches, the list SHALL say so and offer to reset the filter.

#### Scenario: Filter live
- **WHEN** the operator selects "Live"
- **THEN** only live streamers are listed and the URL contains `filter=live`

#### Scenario: No result
- **WHEN** the search matches no streamer
- **THEN** the list shows a no-match message with a "Reset filter" action
