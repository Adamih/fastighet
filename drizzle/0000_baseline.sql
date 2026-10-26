CREATE TABLE `agreement` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`invoice_interval` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_org_id_uq` ON `agreement` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_org_number_uq` ON `agreement` (`organization_id`,`number`);--> statement-breakpoint
CREATE TABLE `agreement_party` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agreement_id` text NOT NULL,
	`party_id` text NOT NULL,
	`role` text NOT NULL,
	`share_percent` integer,
	`receives_invoices` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`party_id`) REFERENCES `party`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_party_org_id_uq` ON `agreement_party` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_party_from_uq` ON `agreement_party` (`agreement_id`,`party_id`,`from_date`);--> statement-breakpoint
CREATE INDEX `agreement_party_org_party_idx` ON `agreement_party` (`organization_id`,`party_id`);--> statement-breakpoint
CREATE TABLE `agreement_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agreement_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`unit_id`) REFERENCES `unit`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_unit_org_id_uq` ON `agreement_unit` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_unit_from_uq` ON `agreement_unit` (`agreement_id`,`unit_id`,`from_date`);--> statement-breakpoint
CREATE INDEX `agreement_unit_unit_idx` ON `agreement_unit` (`unit_id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `bookkeeping_export_org_id_uq` ON `bookkeeping_export` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `bookkeeping_export_org_idx` ON `bookkeeping_export` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `brf_apartment` (
	`unit_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`share_ratio` real,
	`deposit_ore` integer,
	`grant_fee_ore` integer,
	`granted_on` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`unit_id`) REFERENCES `unit`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `charge` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agreement_id` text NOT NULL,
	`kind` text NOT NULL,
	`unit_id` text,
	`description` text,
	`amount_ore` integer NOT NULL,
	`interval` text NOT NULL,
	`vat` integer DEFAULT false NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`unit_id`) REFERENCES `unit`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `charge_org_id_uq` ON `charge` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `charge_agreement_idx` ON `charge` (`agreement_id`);--> statement-breakpoint
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
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_org_id_uq` ON `credit_note` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_org_number_uq` ON `credit_note` (`organization_id`,`number`);--> statement-breakpoint
CREATE INDEX `credit_note_invoice_idx` ON `credit_note` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `credit_note_line` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`credit_note_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_rate_percent` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`credit_note_id`) REFERENCES `credit_note`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_note_line_org_id_uq` ON `credit_note_line` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `credit_note_line_note_idx` ON `credit_note_line` (`credit_note_id`);--> statement-breakpoint
CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`ocr` text NOT NULL,
	`agreement_id` text NOT NULL,
	`party_id` text NOT NULL,
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
	`voided_at` integer,
	`credited_ore` integer DEFAULT 0 NOT NULL,
	`replaces_invoice_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`party_id`) REFERENCES `party`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`replaces_invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_org_id_uq` ON `invoice` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_org_number_uq` ON `invoice` (`organization_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_agreement_period_uq` ON `invoice` (`agreement_id`,`period_start`) WHERE "invoice"."voided_at" is null and "invoice"."credited_ore" < "invoice"."total_ore";--> statement-breakpoint
CREATE INDEX `invoice_org_due_idx` ON `invoice` (`organization_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`charge_id` text,
	`description` text NOT NULL,
	`net_ore` integer NOT NULL,
	`vat_rate_percent` integer NOT NULL,
	`vat_ore` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`charge_id`) REFERENCES `charge`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_line_org_id_uq` ON `invoice_line` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `invoice_line_charge_idx` ON `invoice_line` (`charge_id`);--> statement-breakpoint
CREATE TABLE `lease_terms` (
	`agreement_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`term_end_date` text,
	`extension_months` integer,
	`notice_period_months` integer NOT NULL,
	`notice_date` text,
	`move_out_date` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ledger_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`posting_id` text NOT NULL,
	`account` text NOT NULL,
	`amount_ore` integer NOT NULL,
	`party_id` text,
	`agreement_id` text,
	`invoice_id` text,
	`payment_id` text,
	`charge_kind` text,
	`vat_rate_percent` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`posting_id`) REFERENCES `posting`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`party_id`) REFERENCES `party`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`payment_id`) REFERENCES `payment`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_entry_org_id_uq` ON `ledger_entry` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_posting_idx` ON `ledger_entry` (`posting_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_org_invoice_idx` ON `ledger_entry` (`organization_id`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_org_payment_idx` ON `ledger_entry` (`organization_id`,`payment_id`);--> statement-breakpoint
CREATE INDEX `ledger_entry_org_party_idx` ON `ledger_entry` (`organization_id`,`party_id`);--> statement-breakpoint
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
	`kind` text DEFAULT 'landlord' NOT NULL,
	`reminder_fee_ore` integer,
	`reminder_interval_days` integer DEFAULT 10 NOT NULL,
	`reminder_due_days` integer DEFAULT 10 NOT NULL,
	`financial_year_start_month` integer DEFAULT 1 NOT NULL,
	`bookkeeping_accounts` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ownership_terms` (
	`agreement_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`previous_agreement_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`previous_agreement_id`) REFERENCES `agreement`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `party` (
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
CREATE UNIQUE INDEX `party_org_id_uq` ON `party` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `party_org_name_idx` ON `party` (`organization_id`,`name`);--> statement-breakpoint
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
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`import_id`) REFERENCES `payment_import`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_org_id_uq` ON `payment` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_org_bank_reference_uq` ON `payment` (`organization_id`,`bank_reference`);--> statement-breakpoint
CREATE INDEX `payment_org_status_idx` ON `payment` (`organization_id`,`status`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `payment_import_org_id_uq` ON `payment_import` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `payment_import_org_idx` ON `payment_import` (`organization_id`,`created_at`);--> statement-breakpoint
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
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reminder_org_id_uq` ON `payment_reminder` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reminder_invoice_sequence_uq` ON `payment_reminder` (`invoice_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `posting` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`invoice_id` text,
	`credit_note_id` text,
	`payment_id` text,
	`reverses_posting_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`credit_note_id`) REFERENCES `credit_note`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`payment_id`) REFERENCES `payment`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`reverses_posting_id`) REFERENCES `posting`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posting_org_id_uq` ON `posting` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `posting_org_date_idx` ON `posting` (`organization_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `posting_reverses_uq` ON `posting` (`reverses_posting_id`) WHERE "posting"."reverses_posting_id" is not null;--> statement-breakpoint
CREATE TABLE `property` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`designation` text NOT NULL,
	`name` text,
	`street_address` text,
	`postal_code` text,
	`city` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `property_org_id_uq` ON `property` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `property_org_designation_uq` ON `property` (`organization_id`,`designation`);--> statement-breakpoint
CREATE TABLE `submission` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`, `operation`, `request_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `unit` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`property_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`area_sqm` real,
	`rooms` integer,
	`floor` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`property_id`) REFERENCES `property`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unit_org_id_uq` ON `unit` (`organization_id`,`id`);--> statement-breakpoint
CREATE INDEX `unit_org_property_idx` ON `unit` (`organization_id`,`property_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unit_property_label_uq` ON `unit` (`property_id`,`label`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);