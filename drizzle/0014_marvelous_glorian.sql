CREATE TABLE `bookkeeping_export` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`voucher_count` integer NOT NULL,
	`exported_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exported_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `bookkeeping_export_org_idx` ON `bookkeeping_export` (`organization_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `financial_year_start_month` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `bookkeeping_accounts` text;