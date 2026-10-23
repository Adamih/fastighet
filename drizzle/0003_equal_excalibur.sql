CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`import_id` text NOT NULL,
	`bank_reference` text NOT NULL,
	`booking_date` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`reference` text,
	`payer_name` text,
	`status` text NOT NULL,
	`note` text,
	`invoice_id` text,
	`marks_invoice_paid` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`import_id`) REFERENCES `payment_import`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_org_bank_reference_uq` ON `payment` (`organization_id`,`bank_reference`);--> statement-breakpoint
CREATE INDEX `payment_org_status_idx` ON `payment` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_invoice_idx` ON `payment` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payment_import` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`file_name` text NOT NULL,
	`message_id` text,
	`imported_by_user_id` text,
	`payment_count` integer NOT NULL,
	`duplicate_count` integer NOT NULL,
	`total_ore` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payment_import_org_idx` ON `payment_import` (`organization_id`,`created_at`);