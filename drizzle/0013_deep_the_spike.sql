CREATE TABLE `payment_reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`sent_on` text NOT NULL,
	`due_date` text NOT NULL,
	`owed_ore` integer NOT NULL,
	`fee_ore` integer DEFAULT 0 NOT NULL,
	`recipient_email` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reminder_invoice_sequence_uq` ON `payment_reminder` (`invoice_id`,`sequence`);--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `reminder_fee_ore` integer;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `reminder_interval_days` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `reminder_due_days` integer DEFAULT 10 NOT NULL;