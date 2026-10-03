## MODIFIED Requirements

### Requirement: Timeline query
The service SHALL answer timeline queries with an optional category id and optional filters for streamer ids and a date range. Results are grouped by stream, newest first, and paginated at 20 streams per page. Without a category id, every recorded stream in the filter matches. With a category id, only streams with at least one segment of that category match. Each stream contains its broadcaster, start, end, VOD state, and all of its segments in order; each segment carries its category, start, end, duration, approximate flag, muted flag, deep link and a `match` flag that is true when a category id was queried and the segment belongs to it. It SHALL also list, for a single stream, all of its segments in order, and list the categories that appear in the recorded data, with the number of streams and the last time each was played.

#### Scenario: Two streamers, one game
- **WHEN** streamers A and B both played game G in different streams, and the query is for G with no streamer filter
- **THEN** both streams are returned, newest first, each with all of its segments and exactly its G segments flagged `match`

#### Scenario: Played twice in one stream
- **WHEN** a streamer played G, switched away, and came back to G within one stream
- **THEN** that stream lists two G segments flagged `match`

#### Scenario: No category
- **WHEN** the query has no category id
- **THEN** the most recent streams of all games are returned, newest first, with no segment flagged `match`
