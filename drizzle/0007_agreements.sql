-- Leases become agreements (hyresavtal or bostadsrätt). Hand-written so existing data is kept:
-- lease terms move to `lease_terms`, the tenant to `agreement_party`, and `agreement.end_date`
-- becomes the last billed day. D1 can't turn foreign keys off, and dropping a table deletes its
-- rows (with cascades), so tables that others reference are renamed rather than rebuilt, and the
-- rebuilt `agreement` is dropped only after its cascading children were copied aside.
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
-- Renaming first makes the invoice foreign key point at `agreement`.
ALTER TABLE `lease` RENAME TO `agreement`;
--> statement-breakpoint
CREATE TABLE `__old_lease` AS SELECT * FROM `agreement`;
--> statement-breakpoint
CREATE TABLE `__old_lease_unit` AS SELECT * FROM `lease_unit`;
--> statement-breakpoint
DROP TABLE `lease_unit`;
--> statement-breakpoint
DROP TABLE `agreement`;
--> statement-breakpoint
CREATE TABLE `agreement` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`rent_ore` integer NOT NULL,
	`rent_interval` text NOT NULL,
	`invoice_interval` text NOT NULL,
	`vat` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- The last billed day: the move-out, else the end of a fixed term that is not extended.
INSERT INTO `agreement` (`id`, `organization_id`, `number`, `kind`, `start_date`, `end_date`, `rent_ore`, `rent_interval`, `invoice_interval`, `vat`, `created_at`)
SELECT `id`, `organization_id`, `number`, 'lease', `start_date`,
	coalesce(`move_out_date`, CASE WHEN `extension_months` IS NULL THEN `end_date` END),
	`rent_ore`, `rent_interval`, `invoice_interval`, `vat`, `created_at`
FROM `__old_lease`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_org_number_uq` ON `agreement` (`organization_id`,`number`);
--> statement-breakpoint
CREATE TABLE `agreement_unit` (
	`agreement_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`organization_id` text NOT NULL,
	PRIMARY KEY(`agreement_id`, `unit_id`),
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `agreement_unit` (`agreement_id`, `unit_id`, `organization_id`)
SELECT `lease_id`, `unit_id`, `organization_id` FROM `__old_lease_unit`;
--> statement-breakpoint
CREATE INDEX `agreement_unit_unit_idx` ON `agreement_unit` (`unit_id`);
--> statement-breakpoint
CREATE TABLE `agreement_party` (
	`agreement_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`share_percent` integer,
	`receives_invoices` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`agreement_id`, `tenant_id`),
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `agreement_party` (`agreement_id`, `tenant_id`, `organization_id`, `role`, `share_percent`, `receives_invoices`, `position`)
SELECT `id`, `tenant_id`, `organization_id`, 'tenant', NULL, 1, 1 FROM `__old_lease`;
--> statement-breakpoint
CREATE INDEX `agreement_party_org_tenant_idx` ON `agreement_party` (`organization_id`,`tenant_id`);
--> statement-breakpoint
CREATE TABLE `lease_terms` (
	`agreement_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`term_end_date` text,
	`extension_months` integer,
	`notice_period_months` integer NOT NULL,
	`notice_date` text,
	`move_out_date` text,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `lease_terms` (`agreement_id`, `organization_id`, `term_end_date`, `extension_months`, `notice_period_months`, `notice_date`, `move_out_date`)
SELECT `id`, `organization_id`, `end_date`, `extension_months`, `notice_period_months`, `notice_date`, `move_out_date` FROM `__old_lease`;
--> statement-breakpoint
CREATE TABLE `ownership_terms` (
	`agreement_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`share_ratio` real,
	`deposit_ore` integer,
	`granted_on` text,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `__old_lease`;
--> statement-breakpoint
DROP TABLE `__old_lease_unit`;
--> statement-breakpoint
-- Renaming the column keeps the invoice rows (and their lines, credit notes and payments).
ALTER TABLE `invoice` RENAME COLUMN `lease_id` TO `agreement_id`;
--> statement-breakpoint
DROP INDEX `invoice_lease_period_uq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_agreement_period_uq` ON `invoice` (`agreement_id`,`period_start`) WHERE "invoice"."voided_at" is null and "invoice"."credited_ore" < "invoice"."total_ore";
