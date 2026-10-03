CREATE TABLE `game_group_categories` (
	`group_id` integer NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `category_id`),
	FOREIGN KEY (`group_id`) REFERENCES `game_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`category_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `game_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_groups_name_idx` ON `game_groups` (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX `game_groups_default_idx` ON `game_groups` (`is_default`) WHERE "game_groups"."is_default" = 1;--> statement-breakpoint
CREATE TABLE `streamer_groups` (
	`user_id` text NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`user_id`) REFERENCES `streamers`(`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `game_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `game_groups` (`name`, `is_default`, `created_at`) VALUES ('Default', 1, CAST(unixepoch('subsec') * 1000 AS integer));--> statement-breakpoint
INSERT INTO `game_group_categories` (`group_id`, `category_id`) SELECT (SELECT `id` FROM `game_groups` WHERE `is_default` = 1), `category_id` FROM `default_games`;--> statement-breakpoint
DROP TABLE `default_games`;