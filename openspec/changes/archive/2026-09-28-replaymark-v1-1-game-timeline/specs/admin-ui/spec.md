# Spec Delta

## ADDED Requirements

### Requirement: Timeline page
The UI SHALL provide a Timeline page ("Timeline" / "Zeitleiste") in the main navigation. It has these parts:
- **Game picker:** the existing debounced Twitch category search, plus quick picks for the categories already recorded (box art, stream count, last played).
- **Filters:** an optional multi-select of streamers and an optional date range.
- **Results:** one card per stream, newest first. Each card shows the streamer avatar and name, the stream date, start, end and total duration, the VOD state, and one row per segment of the chosen game with its time window (in the browser's local time zone), its duration, the approximate and muted hints, and a "Watch from here" / "Ab hier ansehen" link.
- **Stream detail:** opened from a card. It shows every segment of that stream as a proportional horizontal strip plus a list, with the chosen game highlighted.

The filter state SHALL live in the URL so a view can be bookmarked. The page SHALL follow the existing design direction (ink buttons, tally red only for live), work at 375 px without horizontal scrolling, and have all strings in both languages. With no recorded data, it SHALL explain that recording starts at deployment and only covers tracked streamers.

#### Scenario: Find a session
- **WHEN** the operator picks game G
- **THEN** the page lists every recorded stream with G segments, and each segment's link opens the VOD in a new tab at the segment start

#### Scenario: No VOD
- **WHEN** a stream has VOD state `none`
- **THEN** its time windows are shown without links, with the hint "no VOD saved" / "kein VOD gespeichert"

#### Scenario: Live stream
- **WHEN** a listed stream is still live
- **THEN** its card shows the live badge, and its open segment updates without reloading

### Requirement: Retention setting in the UI
The Settings page SHALL let the operator edit the segment retention in days (0 = keep forever), with validation and both languages.

#### Scenario: Keep forever
- **WHEN** the operator sets the retention to 0 and saves
- **THEN** the setting is stored and the hint reads "keep forever" / "unbegrenzt behalten"
