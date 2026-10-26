-- Effective-dated agreement terms. Hand-written so existing data is kept:
-- * each agreement's rent (or fee) becomes its first charge, from the agreement's start;
-- * party and unit links get their own id and apply from the agreement's start;
-- * avi and credit note lines get the kind of what they bill;
-- * a bostadsrätt's andelstal, insats and upplåtelsedatum move to the apartment register.
-- Only `agreement_party` and `agreement_unit` are rebuilt; nothing references them, so dropping
-- them can't cascade.
PRAGMA defer_foreign_keys = on;
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
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `charge_agreement_idx` ON `charge` (`agreement_id`);
--> statement-breakpoint
INSERT INTO `charge` (`id`, `organization_id`, `agreement_id`, `kind`, `unit_id`, `description`, `amount_ore`, `interval`, `vat`, `from_date`, `to_date`, `created_at`)
SELECT lower(hex(randomblob(16))), `organization_id`, `id`,
	CASE `kind` WHEN 'tenant_ownership' THEN 'fee' ELSE 'rent' END,
	NULL, NULL, `rent_ore`, `rent_interval`, `vat`, `start_date`, NULL, `created_at`
FROM `agreement`;
--> statement-breakpoint
ALTER TABLE `agreement` DROP COLUMN `rent_ore`;
--> statement-breakpoint
ALTER TABLE `agreement` DROP COLUMN `rent_interval`;
--> statement-breakpoint
ALTER TABLE `agreement` DROP COLUMN `vat`;
--> statement-breakpoint
CREATE TABLE `__new_agreement_party` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`party_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`share_percent` integer,
	`receives_invoices` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agreement_party` (`id`, `agreement_id`, `party_id`, `organization_id`, `role`, `share_percent`, `receives_invoices`, `position`, `from_date`, `to_date`)
SELECT lower(hex(randomblob(16))), p.`agreement_id`, p.`party_id`, p.`organization_id`, p.`role`, p.`share_percent`, p.`receives_invoices`, p.`position`, a.`start_date`, NULL
FROM `agreement_party` p JOIN `agreement` a ON a.`id` = p.`agreement_id`;
--> statement-breakpoint
DROP TABLE `agreement_party`;
--> statement-breakpoint
ALTER TABLE `__new_agreement_party` RENAME TO `agreement_party`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_party_from_uq` ON `agreement_party` (`agreement_id`,`party_id`,`from_date`);
--> statement-breakpoint
CREATE INDEX `agreement_party_org_party_idx` ON `agreement_party` (`organization_id`,`party_id`);
--> statement-breakpoint
CREATE TABLE `__new_agreement_unit` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agreement_unit` (`id`, `agreement_id`, `unit_id`, `organization_id`, `from_date`, `to_date`)
SELECT lower(hex(randomblob(16))), u.`agreement_id`, u.`unit_id`, u.`organization_id`, a.`start_date`, NULL
FROM `agreement_unit` u JOIN `agreement` a ON a.`id` = u.`agreement_id`;
--> statement-breakpoint
DROP TABLE `agreement_unit`;
--> statement-breakpoint
ALTER TABLE `__new_agreement_unit` RENAME TO `agreement_unit`;
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_unit_from_uq` ON `agreement_unit` (`agreement_id`,`unit_id`,`from_date`);
--> statement-breakpoint
CREATE INDEX `agreement_unit_unit_idx` ON `agreement_unit` (`unit_id`);
--> statement-breakpoint
-- Lines name what they bill. Existing lines are all the base charge of their agreement.
ALTER TABLE `invoice_line` ADD `kind` text NOT NULL DEFAULT 'rent';
--> statement-breakpoint
ALTER TABLE `invoice_line` ADD `charge_id` text REFERENCES charge(id);
--> statement-breakpoint
UPDATE `invoice_line` SET
	`kind` = (SELECT CASE a.`kind` WHEN 'tenant_ownership' THEN 'fee' ELSE 'rent' END
		FROM `invoice` i JOIN `agreement` a ON a.`id` = i.`agreement_id` WHERE i.`id` = `invoice_line`.`invoice_id`),
	`charge_id` = (SELECT c.`id` FROM `invoice` i JOIN `charge` c ON c.`agreement_id` = i.`agreement_id`
		WHERE i.`id` = `invoice_line`.`invoice_id`);
--> statement-breakpoint
CREATE INDEX `invoice_line_charge_idx` ON `invoice_line` (`charge_id`);
--> statement-breakpoint
ALTER TABLE `credit_note_line` ADD `kind` text NOT NULL DEFAULT 'rent';
--> statement-breakpoint
UPDATE `credit_note_line` SET `kind` = (SELECT CASE a.`kind` WHEN 'tenant_ownership' THEN 'fee' ELSE 'rent' END
	FROM `credit_note` n JOIN `invoice` i ON i.`id` = n.`invoice_id` JOIN `agreement` a ON a.`id` = i.`agreement_id`
	WHERE n.`id` = `credit_note_line`.`credit_note_id`);
--> statement-breakpoint
CREATE TABLE `brf_apartment` (
	`unit_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`share_ratio` real,
	`deposit_ore` integer,
	`grant_fee_ore` integer,
	`granted_on` text,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- The apartment of each bostadsrätt; after a sale both rights name the same apartment and values.
INSERT OR IGNORE INTO `brf_apartment` (`unit_id`, `organization_id`, `share_ratio`, `deposit_ore`, `grant_fee_ore`, `granted_on`)
SELECT u.`unit_id`, o.`organization_id`, o.`share_ratio`, o.`deposit_ore`, NULL, o.`granted_on`
FROM `ownership_terms` o
JOIN `agreement_unit` u ON u.`agreement_id` = o.`agreement_id`
JOIN `unit` ON `unit`.`id` = u.`unit_id` AND `unit`.`kind` = 'apartment';
--> statement-breakpoint
ALTER TABLE `ownership_terms` DROP COLUMN `share_ratio`;
--> statement-breakpoint
ALTER TABLE `ownership_terms` DROP COLUMN `deposit_ore`;
--> statement-breakpoint
ALTER TABLE `ownership_terms` DROP COLUMN `granted_on`;
