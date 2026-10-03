# Spec Delta

## Purpose

Records which category every tracked streamer played and when, from the moment of deployment. For each stream it resolves the archive VOD through the official Twitch API, so that a past game session can be found and opened at the exact moment it started.

## ADDED Requirements

### Requirement: Official sources only
The service SHALL derive category history only from EventSub events it receives, from its own live sync, and from documented Helix endpoints. It MUST NOT scrape web pages, call undocumented Twitch APIs, or query third-party trackers. History from before the feature was deployed SHALL NOT be shown or fabricated.

#### Scenario: Stream before deployment
- **WHEN** the operator filters by a game that a streamer played only before the feature was deployed
- **THEN** no stream is listed for it, and the page explains that recording starts at the deployment date

### Requirement: Stream records
For every tracked streamer, the service SHALL keep one stream record per Twitch stream id, with broadcaster, start time and end time. `stream.online` SHALL create the record, using the event's `started_at` as the start. `stream.offline` SHALL set the end time. If the service learns from the live sync that a stream has ended without receiving `stream.offline` (for example after downtime, or when the streamer was paused), it SHALL set the end time to the time it observed this and mark the end as approximate.

#### Scenario: Normal stream
- **WHEN** `stream.online` and later `stream.offline` arrive for the same stream
- **THEN** one stream record exists with the start from the event and the end at the time `stream.offline` was received

#### Scenario: Missed offline
- **WHEN** the service was down while a stream ended and the live sync after restart reports the streamer offline
- **THEN** the stream record gets an end time marked as approximate

### Requirement: Category segments for all categories
While a tracked streamer is live, the service SHALL record a segment for every category they play, whether or not it matches their notification games. A segment has a category id, category name, a start, an end (open while it is current), and a flag for whether start or end is approximate. A category change (`channel.update` with a different category, or the category fetched after `stream.online`) SHALL close the current segment and open a new one, both at the same timestamp. A `channel.update` that changes only the title SHALL NOT create a segment. `stream.offline` SHALL close the open segment. Offline category changes SHALL NOT create segments.

#### Scenario: Switch after a long stream
- **WHEN** a streamer is live in "Just Chatting" for 9 h, switches to game A for 20 min, then back to "Just Chatting" and ends the stream
- **THEN** three segments exist for that stream, and the one for game A starts and ends at the two switch times

#### Scenario: Title change only
- **WHEN** `channel.update` arrives with the same category and a new title
- **THEN** no new segment is created

#### Scenario: Offline change
- **WHEN** `channel.update` arrives while the streamer is offline
- **THEN** no segment is created

### Requirement: Event time, not processing time
The start and end of segments and streams SHALL use the time the event was received from Twitch (or the event's own timestamp where one exists, such as `started_at`), not the time it was processed. A delayed or retried inbox event SHALL therefore not shift its segment boundaries. Events that are processed out of order for the same stream SHALL NOT leave overlapping segments.

#### Scenario: Retried event
- **WHEN** a `channel.update` is received at 20:00:00 and processed successfully only on a retry at 20:01:30
- **THEN** the boundary between the segments is at 20:00:00

### Requirement: Gap filling from the live sync
When the live sync observes a category or live state that differs from the recorded one, and no EventSub event has updated that streamer within the grace period, the service SHALL record the observed change at the observation time and mark that boundary as approximate. If the service was down, it SHALL NOT invent segments for the time it was down.

#### Scenario: Category changed during downtime
- **WHEN** the service restarts and the live sync reports a different category for a live streamer than the open segment
- **THEN** the open segment is closed and a new one opened at the sync time, both marked approximate

### Requirement: VOD resolution
For each stream, the service SHALL try to find its archive VOD with Helix `Get Videos` (type archive, filtered by the broadcaster). It SHALL match the VOD by `stream_id` and store the video id, creation time, duration and muted segments. Lookups SHALL be bounded and cached: a stream whose VOD was found is not looked up again, and one that was not found is retried at most once per hour and at most for 7 days after the stream ended. A failed lookup MUST NOT affect notifications or recording.

#### Scenario: Archiving disabled
- **WHEN** no archive video with a matching stream id exists for 7 days after the stream ended
- **THEN** the stream is marked "no VOD" and no further lookups are made

#### Scenario: Live stream
- **WHEN** the stream is still live and its archive already exists
- **THEN** the VOD id is stored and deep links are offered

### Requirement: Deep link offset
A deep link SHALL have the form `https://www.twitch.tv/videos/<video id>?t=<h>h<m>m<s>s`. The offset is the segment start minus the VOD creation time, clamped to between 0 and the VOD duration. A segment starting within the first 10 s SHALL link without an offset. If the segment start is approximate, the link SHALL start 60 s earlier, still clamped at 0.

#### Scenario: Offset
- **WHEN** a VOD was created at 18:00:05 and a segment starts at 20:12:35
- **THEN** the link ends with `?t=2h12m30s`

#### Scenario: Muted part
- **WHEN** a segment overlaps one of the VOD's muted segments
- **THEN** the segment is flagged as partly muted

### Requirement: VOD availability states
Each stream SHALL report one VOD state: `available`, `pending` (not found yet, still retrying), `none` (not found within the retry window), or `likely_expired` (found, but the stream ended more than 60 days ago). `likely_expired` SHALL still offer the link together with a warning. The link for an `available` VOD SHALL open in a new tab.

#### Scenario: Old VOD
- **WHEN** a stream with a known VOD ended 90 days ago
- **THEN** its state is `likely_expired` and the link is shown with a warning

### Requirement: Timeline query
The service SHALL answer timeline queries by category id, with optional filters for streamer ids and a date range. Results are grouped by stream, newest first, and paginated at 20 streams per page. Each stream contains its broadcaster, start, end, VOD state, and only the segments of the queried category. Each segment carries its start, end, duration, approximate flag, muted flag and deep link. It SHALL also list, for a single stream, all of its segments in order, and list the categories that appear in the recorded data, with the number of streams and the last time each was played.

#### Scenario: Two streamers, one game
- **WHEN** streamers A and B both played game G in different streams, and the query is for G with no streamer filter
- **THEN** both streams are returned, newest first, each containing only its G segments

#### Scenario: Played twice in one stream
- **WHEN** a streamer played G, switched away, and came back to G within one stream
- **THEN** that stream lists two G segments
