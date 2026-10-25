CREATE TABLE `credit_note` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`invoice_id` text NOT NULL,
	`reason` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_street_address` text,
	`recipient_postal_code` text,
	`recipient_city` text,
	`recipient_email` text,
	`issue_date` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	`total_ore` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_org_number_uq` ON `credit_note` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `credit_note_invoice_idx` ON `credit_note` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `credit_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_rate_percent` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_note_line_note_idx` ON `credit_note_line` (`credit_note_id`);--> statement-breakpoint
ALTER TABLE `invoice` ADD `credited_ore` integer DEFAULT 0 NOT NULL;