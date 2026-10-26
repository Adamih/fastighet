CREATE TABLE `management_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`managing_organization_id` text NOT NULL,
	`managed_organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`managing_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managed_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_assignment_uq` ON `management_assignment` (`managing_organization_id`,`managed_organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `management_code_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `management_code_attempt_user_idx` ON `management_code_attempt` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `management_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`managed_organization_id` text NOT NULL,
	`managing_organization_id` text NOT NULL,
	`permissions` text NOT NULL,
	`request_id` text,
	`granted_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`managed_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`managing_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `management_request`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_grant_active_uq` ON `management_grant` (`managed_organization_id`,`managing_organization_id`) WHERE "management_grant"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `management_grant_managing_idx` ON `management_grant` (`managing_organization_id`);--> statement-breakpoint
CREATE TABLE `management_request` (
	`id` text PRIMARY KEY NOT NULL,
	`managing_organization_id` text NOT NULL,
	`label` text NOT NULL,
	`email` text,
	`permissions` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`used_at` integer,
	`used_by_organization_id` text,
	`withdrawn_at` integer,
	FOREIGN KEY (`managing_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `management_request_code_hash_unique` ON `management_request` (`code_hash`);--> statement-breakpoint
CREATE INDEX `management_request_managing_idx` ON `management_request` (`managing_organization_id`,`created_at`);