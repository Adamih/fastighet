CREATE TABLE `admin_event` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text,
	`target_organization_id` text,
	`details` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_event_created_idx` ON `admin_event` (`created_at`);--> statement-breakpoint
ALTER TABLE `audit_event` ADD `impersonated_by_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `audit_event` ADD `impersonated_by_name` text;--> statement-breakpoint
ALTER TABLE `session` ADD `impersonated_by` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;