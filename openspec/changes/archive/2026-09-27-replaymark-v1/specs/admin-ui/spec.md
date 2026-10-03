# Spec Delta

## Purpose
A bilingual (English/German), responsive admin single-page app to manage and watch the notifier without reloading.

## ADDED Requirements

### Requirement: Bilingual interface
Every user-visible UI string SHALL exist in English and German. The initial language SHALL follow the browser language (German for `de*`, otherwise English); a visible switch SHALL change it instantly and persist the choice in the browser. Dates and numbers SHALL be formatted for the active language. API error messages shown to the user SHALL be translated via stable error codes.

#### Scenario: Switch language
- **WHEN** the admin switches from German to English on any page
- **THEN** all labels, empty states, toasts and dialogs appear in English without reload and remain English after reload

### Requirement: Theme and responsiveness
The UI SHALL support light and dark mode (following the system by default, switchable, persisted) and SHALL be usable on a phone-width screen.

#### Scenario: Phone
- **WHEN** the overview is opened at 375 px width
- **THEN** all content is reachable without horizontal scrolling

### Requirement: Pages
The UI SHALL provide: Login (password + error only); Overview (tiles: streamers total/live, active subscriptions, last sync with result, failed mails; streamer list with avatar, name, pulsing red live badge, current game with box art, title, "matches" marker, subscription indicator green=all enabled / yellow=pending / red=error or missing); Streamer add/edit (login → preview with avatar and name before saving, mode default/custom/any, debounced category search combobox with box art and removable chips, active switch, delete with confirmation); Subscriptions (table, "sync now" with loading state, last result); History (time, streamer, game, status, error, status filter, retry for failed); Settings (default games combobox, recipients add/remove with validation, interval, mail language, test mail button, read-only callback URL).

#### Scenario: Empty state
- **WHEN** no streamers exist
- **THEN** the overview shows a hint to add the first streamer

### Requirement: Behaviour
The UI SHALL update from server-sent events without reload and reconnect automatically; SHALL apply optimistic updates with rollback for the active switch; SHALL show success/error toasts; SHALL redirect to login on any `401`; SHALL only allow games chosen from search results (no free text).

#### Scenario: Live update
- **WHEN** a streamer goes live while the overview is open
- **THEN** the live badge appears without reload

#### Scenario: Session expired
- **WHEN** any API call returns `401`
- **THEN** the user lands on the login page
