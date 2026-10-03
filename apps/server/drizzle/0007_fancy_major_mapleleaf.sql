CREATE TABLE `follows` (
	`owner_id` integer NOT NULL,
	`broadcaster_id` text NOT NULL,
	`game_mode` text DEFAULT 'default' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `broadcaster_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`broadcaster_id`) REFERENCES `streamers`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_recipients` (
	`user_id` integer NOT NULL,
	`email` text NOT NULL,
	PRIMARY KEY(`user_id`, `email`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'user' NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`mail_language` text DEFAULT 'de' NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (lower("username"));--> statement-breakpoint
-- Table rebuilds below need `foreign_keys` OFF; PRAGMA is a no-op inside the
-- migration transaction, so `openDb` turns it off around `migrate`.
INSERT INTO `users` (`id`, `username`, `email`, `role`, `mail_language`, `created_at`)
VALUES (
	1,
	'admin',
	COALESCE((SELECT json_extract(`value`, '$[0]') FROM `settings` WHERE `key` = 'recipients'), ''),
	'admin',
	CASE (SELECT json_extract(`value`, '$') FROM `settings` WHERE `key` = 'mailLanguage') WHEN 'en' THEN 'en' ELSE 'de' END,
	CAST(unixepoch('subsec') * 1000 AS integer)
);--> statement-breakpoint
INSERT OR IGNORE INTO `user_recipients` (`user_id`, `email`)
SELECT 1, `j`.`value` FROM `settings` AS `s`, json_each(`s`.`value`) AS `j`
WHERE `s`.`key` = 'recipients' AND json_valid(`s`.`value`) AND `j`.`type` = 'text' AND `j`.`value` <> '';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('recipients', 'mailLanguage');--> statement-breakpoint
INSERT INTO `follows` (`owner_id`, `broadcaster_id`, `game_mode`, `enabled`, `created_at`)
SELECT 1, `user_id`, `game_mode`, `enabled`, `created_at` FROM `streamers`;--> statement-breakpoint
CREATE TABLE `__new_streamer_games` (
	`owner_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `user_id`, `category_id`),
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`user_id`) REFERENCES `follows`(`owner_id`,`broadcaster_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_streamer_games` (`owner_id`, `user_id`, `category_id`) SELECT 1, `user_id`, `category_id` FROM `streamer_games`;--> statement-breakpoint
DROP TABLE `streamer_games`;--> statement-breakpoint
ALTER TABLE `__new_streamer_games` RENAME TO `streamer_games`;--> statement-breakpoint
CREATE TABLE `__new_streamer_groups` (
	`owner_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `user_id`, `group_id`),
	FOREIGN KEY (`group_id`) REFERENCES `game_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`user_id`) REFERENCES `follows`(`owner_id`,`broadcaster_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_streamer_groups` (`owner_id`, `user_id`, `group_id`) SELECT 1, `user_id`, `group_id` FROM `streamer_groups`;--> statement-breakpoint
DROP TABLE `streamer_groups`;--> statement-breakpoint
ALTER TABLE `__new_streamer_groups` RENAME TO `streamer_groups`;--> statement-breakpoint
CREATE TABLE `__new_game_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_game_groups` (`id`, `owner_id`, `name`, `is_default`, `created_at`) SELECT `id`, 1, `name`, `is_default`, `created_at` FROM `game_groups`;--> statement-breakpoint
DROP TABLE `game_groups`;--> statement-breakpoint
ALTER TABLE `__new_game_groups` RENAME TO `game_groups`;--> statement-breakpoint
CREATE UNIQUE INDEX `game_groups_owner_name_idx` ON `game_groups` (`owner_id`,lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `game_groups_default_idx` ON `game_groups` (`owner_id`) WHERE "game_groups"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `__new_sent_notifications` (
	`stream_id` text NOT NULL,
	`category_id` text NOT NULL,
	`broadcaster_id` text NOT NULL,
	`owner_id` integer NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sent_notifications` (`stream_id`, `category_id`, `broadcaster_id`, `owner_id`, `sent_at`) SELECT `stream_id`, `category_id`, `broadcaster_id`, 1, `sent_at` FROM `sent_notifications`;--> statement-breakpoint
DROP TABLE `sent_notifications`;--> statement-breakpoint
ALTER TABLE `__new_sent_notifications` RENAME TO `sent_notifications`;--> statement-breakpoint
CREATE UNIQUE INDEX `sent_notifications_stream_category_uq` ON `sent_notifications` (`stream_id`,`category_id`,`owner_id`);--> statement-breakpoint
CREATE TABLE `__new_mail_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`stream_id` text NOT NULL,
	`broadcaster_id` text DEFAULT '' NOT NULL,
	`category_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_mail_outbox` (`id`, `owner_id`, `stream_id`, `broadcaster_id`, `category_id`, `payload`, `attempts`, `next_attempt_at`, `last_error`, `status`, `created_at`, `updated_at`, `sent_at`) SELECT `id`, 1, `stream_id`, `broadcaster_id`, `category_id`, `payload`, `attempts`, `next_attempt_at`, `last_error`, `status`, `created_at`, `updated_at`, `sent_at` FROM `mail_outbox`;--> statement-breakpoint
DROP TABLE `mail_outbox`;--> statement-breakpoint
ALTER TABLE `__new_mail_outbox` RENAME TO `mail_outbox`;--> statement-breakpoint
CREATE INDEX `mail_outbox_status_next_idx` ON `mail_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `mail_outbox_stream_idx` ON `mail_outbox` (`stream_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (`id`, `user_id`, `created_at`, `expires_at`, `last_seen_at`) SELECT `id`, 1, `created_at`, `expires_at`, `last_seen_at` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
ALTER TABLE `streamers` DROP COLUMN `game_mode`;--> statement-breakpoint
ALTER TABLE `streamers` DROP COLUMN `enabled`;
