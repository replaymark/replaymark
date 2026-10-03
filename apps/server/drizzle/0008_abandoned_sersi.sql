CREATE INDEX `follows_broadcaster_idx` ON `follows` (`broadcaster_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_owner_idx` ON `mail_outbox` (`owner_id`);--> statement-breakpoint
CREATE INDEX `sent_notifications_owner_idx` ON `sent_notifications` (`owner_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);