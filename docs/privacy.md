# Data and privacy

replaymark stores everything in the SQLite database under `/data`. Nothing leaves your host except the Twitch API calls and the mails you configure.

## What is stored

- Accounts: login names, password hashes, roles.
- Recipients' email addresses (per account) and the mail language.
- Followed streamers and the game groups used for matching.
- Stream and category history (the timeline, with VOD links). It is pruned by the retention setting `segmentRetentionDays` (default 365, `0` keeps everything forever); choose a value that fits your obligations.
- The mail outbox (queued and sent notifications, including recipient addresses).

## Telemetry

replaymark sends no telemetry and no analytics.

## Third-party requests from the browser

The admin UI loads streamer avatars and game box art from Twitch's CDN (`static-cdn.jtvnw.net`), so the visitor's browser contacts Twitch and exposes its IP address to it. If you let other people use the UI, mention this in your privacy notice.

## Operator responsibility

Each operator registers their own Twitch application and is bound by the [Twitch Developer Services Agreement](https://legal.twitch.com/en/legal/developer-agreement/). You are responsible for the data you collect from the people who use your instance.

replaymark is not affiliated with or endorsed by Twitch Interactive, Inc. Twitch is a trademark of Twitch Interactive, Inc.
