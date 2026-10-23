CREATE TABLE `lease` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`extension_months` integer,
	`notice_period_months` integer NOT NULL,
	`rent_ore` integer NOT NULL,
	`rent_interval` text NOT NULL,
	`invoice_interval` text NOT NULL,
	`vat` integer DEFAULT false NOT NULL,
	`notice_date` text,
	`move_out_date` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lease_org_number_uq` ON `lease` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `lease_org_tenant_idx` ON `lease` (`organization_id`,`tenant_id`);--> statement-breakpoint
CREATE TABLE `lease_unit` (
	`lease_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`organization_id` text NOT NULL,
	PRIMARY KEY(`lease_id`, `unit_id`),
	FOREIGN KEY (`lease_id`) REFERENCES `lease`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lease_unit_unit_idx` ON `lease_unit` (`unit_id`);--> statement-breakpoint
CREATE TABLE `tenant` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`organization_number` text,
	`email` text,
	`phone` text,
	`street_address` text,
	`postal_code` text,
	`city` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tenant_org_name_idx` ON `tenant` (`organization_id`,`name`);