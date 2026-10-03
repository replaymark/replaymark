ALTER TABLE `eventsub_inbox` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `eventsub_inbox` ADD `next_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `live_state` ADD `event_at` integer;