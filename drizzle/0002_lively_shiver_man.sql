CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`ocr` text NOT NULL,
	`lease_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_street_address` text,
	`recipient_postal_code` text,
	`recipient_city` text,
	`recipient_email` text,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	`total_ore` integer NOT NULL,
	`sent_at` integer,
	`paid_on` text,
	`voided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lease_id`) REFERENCES `lease`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_org_number_uq` ON `invoice` (`organization_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_lease_period_uq` ON `invoice` (`lease_id`,`period_start`);--> statement-breakpoint
CREATE INDEX `invoice_org_due_idx` ON `invoice` (`organization_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_rate_percent` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`organization_number` text,
	`bankgiro` text,
	`street_address` text,
	`postal_code` text,
	`city` text,
	`email` text,
	`phone` text,
	`f_skatt` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
