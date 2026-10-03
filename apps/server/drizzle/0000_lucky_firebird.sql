CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`category_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`box_art_url` text
);
--> statement-breakpoint
CREATE TABLE `default_games` (
	`category_id` text PRIMARY KEY NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eventsub_inbox` (
	`message_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `eventsub_inbox_processed_received_idx` ON `eventsub_inbox` (`processed_at`,`received_at`);--> statement-breakpoint
CREATE TABLE `live_state` (
	`broadcaster_id` text PRIMARY KEY NOT NULL,
	`stream_id` text,
	`category_id` text,
	`category_name` text,
	`title` text,
	`started_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stream_id` text NOT NULL,
	`category_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_outbox_status_next_idx` ON `mail_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `sent_notifications` (
	`stream_id` text NOT NULL,
	`category_id` text NOT NULL,
	`broadcaster_id` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sent_notifications_stream_category_uq` ON `sent_notifications` (`stream_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `streamer_games` (
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `category_id`),
	FOREIGN KEY (`user_id`) REFERENCES `streamers`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `streamers` (
	`user_id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`game_mode` text DEFAULT 'default' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`twitch_sub_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`version` text NOT NULL,
	`broadcaster_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
