CREATE TABLE `pledge` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agreement_id` text NOT NULL,
	`creditor_name` text NOT NULL,
	`creditor_organization_number` text,
	`reference` text,
	`notified_on` text NOT NULL,
	`note` text,
	`registered_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`released_on` text,
	`release_note` text,
	`released_by` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`registered_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`released_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pledge_org_id_uq` ON `pledge` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `pledge_org_agreement_idx` ON `pledge` (`organization_id`,`agreement_id`);