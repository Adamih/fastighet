CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`user_name` text NOT NULL,
	`actor_organization_id` text,
	`actor_organization_name` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_event_org_id_uq` ON `audit_event` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_event_org_created_idx` ON `audit_event` (`organization_id`,`created_at`);