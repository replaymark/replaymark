CREATE TABLE `category_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`broadcaster_id` text NOT NULL,
	`category_id` text NOT NULL,
	`category_name` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`start_approx` integer DEFAULT false NOT NULL,
	`end_approx` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`stream_id`) REFERENCES `streams`(`stream_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `category_segments_category_started_idx` ON `category_segments` (`category_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `category_segments_stream_started_idx` ON `category_segments` (`stream_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `streams` (
	`stream_id` text PRIMARY KEY NOT NULL,
	`broadcaster_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`end_approx` integer DEFAULT false NOT NULL,
	`vod_id` text,
	`vod_created_at` integer,
	`vod_duration_s` integer,
	`vod_muted` text,
	`vod_state` text DEFAULT 'pending' NOT NULL,
	`vod_checked_at` integer
);
