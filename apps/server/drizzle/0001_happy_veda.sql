ALTER TABLE `mail_outbox` ADD `broadcaster_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `updated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_outbox` ADD `sent_at` integer;