ALTER TABLE `organization_settings` ADD `waive_reminder_fee_by_due_date` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_reminder` ADD `fee_waived_on` text;--> statement-breakpoint
ALTER TABLE `payment_reminder` ADD `fee_waiver` text;