CREATE TABLE `party_access` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`party_id` text NOT NULL,
	`user_id` text NOT NULL,
	`invitation_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`party_id`) REFERENCES `party`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_access_org_id_uq` ON `party_access` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `party_access_open_uq` ON `party_access` (`party_id`,`user_id`) WHERE "party_access"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX `party_access_user_idx` ON `party_access` (`user_id`);--> statement-breakpoint
CREATE TABLE `portal_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`party_id` text NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`revoked_at` integer,
	`revoked_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`party_id`) REFERENCES `party`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_invitation_code_hash_unique` ON `portal_invitation` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `portal_invitation_org_id_uq` ON `portal_invitation` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `portal_invitation_party_idx` ON `portal_invitation` (`organization_id`,`party_id`);