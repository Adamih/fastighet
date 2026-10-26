-- The receivables ledger. Hand-written so existing money facts become postings: avier, voids,
-- credit notes, bank payments, their matches to avier, payments registered by hand and refunds.
-- Afterwards `invoice.paid_on`, `payment.invoice_id`/`marks_invoice_paid` and the refund fields
-- on credit notes are gone; all of it is derived from the entries.
PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
CREATE TABLE `__payment_links` AS SELECT `id`, `organization_id`, `invoice_id`, `marks_invoice_paid`, `status`, `amount_ore`, `booking_date` FROM `payment`;
--> statement-breakpoint
-- Nothing references `payment` yet, so it can be rebuilt without its invoice link.
CREATE TABLE `__new_payment` (
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
	FOREIGN KEY (`import_id`) REFERENCES `payment_import`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payment` (`id`, `organization_id`, `import_id`, `bank_reference`, `booking_date`, `amount_ore`, `reference`, `payer_name`, `status`, `note`, `created_at`)
SELECT `id`, `organization_id`, `import_id`, `bank_reference`, `booking_date`, `amount_ore`, `reference`, `payer_name`, `status`, `note`, `created_at` FROM `payment`;
--> statement-breakpoint
DROP TABLE `payment`;
--> statement-breakpoint
ALTER TABLE `__new_payment` RENAME TO `payment`;
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_org_bank_reference_uq` ON `payment` (`organization_id`,`bank_reference`);
--> statement-breakpoint
CREATE INDEX `payment_org_status_idx` ON `payment` (`organization_id`,`status`);
--> statement-breakpoint
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
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_note`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reverses_posting_id`) REFERENCES `posting`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `posting_org_date_idx` ON `posting` (`organization_id`,`date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `posting_reverses_uq` ON `posting` (`reverses_posting_id`) WHERE "posting"."reverses_posting_id" is not null;
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
	FOREIGN KEY (`posting_id`) REFERENCES `posting`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agreement_id`) REFERENCES `agreement`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_entry_posting_idx` ON `ledger_entry` (`posting_id`);
--> statement-breakpoint
CREATE INDEX `ledger_entry_org_invoice_idx` ON `ledger_entry` (`organization_id`,`invoice_id`);
--> statement-breakpoint
CREATE INDEX `ledger_entry_org_payment_idx` ON `ledger_entry` (`organization_id`,`payment_id`);
--> statement-breakpoint
CREATE INDEX `ledger_entry_org_party_idx` ON `ledger_entry` (`organization_id`,`party_id`);
--> statement-breakpoint
-- Avier: the receivable against income per line and VAT per rate.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `created_at`)
SELECT 'inv-' || `id`, `organization_id`, `issue_date`, 'invoice', 'Avi ' || `number`, `id`, `created_at` FROM `invoice`;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`)
SELECT 'inv-r-' || `id`, `organization_id`, 'inv-' || `id`, 'receivable', `total_ore`, `party_id`, `agreement_id`, `id` FROM `invoice`;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `charge_kind`, `vat_rate_percent`)
SELECT 'inv-l-' || l.`id`, l.`organization_id`, 'inv-' || l.`invoice_id`, 'income', -l.`net_ore`, i.`party_id`, i.`agreement_id`, l.`invoice_id`, l.`kind`, l.`vat_rate_percent`
FROM `invoice_line` l JOIN `invoice` i ON i.`id` = l.`invoice_id` WHERE l.`net_ore` <> 0;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `vat_rate_percent`)
SELECT 'inv-v-' || l.`invoice_id` || '-' || l.`vat_rate_percent`, i.`organization_id`, 'inv-' || l.`invoice_id`, 'output_vat', -sum(l.`vat_ore`), i.`party_id`, i.`agreement_id`, l.`invoice_id`, l.`vat_rate_percent`
FROM `invoice_line` l JOIN `invoice` i ON i.`id` = l.`invoice_id` WHERE l.`vat_ore` <> 0
GROUP BY l.`invoice_id`, l.`vat_rate_percent`;
--> statement-breakpoint
-- Voided avier: a reversal of the avi's posting.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `reverses_posting_id`, `created_at`)
SELECT 'void-' || `id`, `organization_id`, date(`voided_at` / 1000, 'unixepoch'), 'void', 'Makulering av avi ' || `number`, `id`, 'inv-' || `id`, `voided_at`
FROM `invoice` WHERE `voided_at` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `charge_kind`, `vat_rate_percent`)
SELECT 'void-' || e.`id`, e.`organization_id`, 'void-' || e.`invoice_id`, e.`account`, -e.`amount_ore`, e.`party_id`, e.`agreement_id`, e.`invoice_id`, e.`charge_kind`, e.`vat_rate_percent`
FROM `ledger_entry` e JOIN `invoice` i ON i.`id` = e.`invoice_id`
WHERE e.`posting_id` = 'inv-' || i.`id` AND i.`voided_at` IS NOT NULL;
--> statement-breakpoint
-- Credit notes: the reverse of what they credit, against the avi's receivable.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `credit_note_id`, `created_at`)
SELECT 'cn-' || n.`id`, n.`organization_id`, n.`issue_date`, 'credit_note', 'Kreditfaktura ' || n.`number`, n.`invoice_id`, n.`id`, n.`created_at`
FROM `credit_note` n;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`)
SELECT 'cn-r-' || n.`id`, n.`organization_id`, 'cn-' || n.`id`, 'receivable', -n.`total_ore`, i.`party_id`, i.`agreement_id`, n.`invoice_id`
FROM `credit_note` n JOIN `invoice` i ON i.`id` = n.`invoice_id`;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `charge_kind`, `vat_rate_percent`)
SELECT 'cn-l-' || l.`id`, l.`organization_id`, 'cn-' || n.`id`, 'income', l.`net_ore`, i.`party_id`, i.`agreement_id`, n.`invoice_id`, l.`kind`, l.`vat_rate_percent`
FROM `credit_note_line` l JOIN `credit_note` n ON n.`id` = l.`credit_note_id` JOIN `invoice` i ON i.`id` = n.`invoice_id`
WHERE l.`net_ore` <> 0;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `vat_rate_percent`)
SELECT 'cn-v-' || n.`id` || '-' || l.`vat_rate_percent`, n.`organization_id`, 'cn-' || n.`id`, 'output_vat', sum(l.`vat_ore`), i.`party_id`, i.`agreement_id`, n.`invoice_id`, l.`vat_rate_percent`
FROM `credit_note_line` l JOIN `credit_note` n ON n.`id` = l.`credit_note_id` JOIN `invoice` i ON i.`id` = n.`invoice_id`
WHERE l.`vat_ore` <> 0
GROUP BY n.`id`, l.`vat_rate_percent`;
--> statement-breakpoint
-- Bank payments come in unallocated.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `payment_id`)
SELECT 'pay-' || `id`, `organization_id`, `booking_date`, 'payment', 'Inbetalning', `id` FROM `__payment_links`;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `payment_id`)
SELECT 'pay-b-' || `id`, `organization_id`, 'pay-' || `id`, 'bank', `amount_ore`, `id` FROM `__payment_links`;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `payment_id`)
SELECT 'pay-u-' || `id`, `organization_id`, 'pay-' || `id`, 'unallocated', -`amount_ore`, `id` FROM `__payment_links`;
--> statement-breakpoint
-- Matched payments settle the avi they were matched to.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `payment_id`)
SELECT 'alloc-' || p.`id`, p.`organization_id`, p.`booking_date`, 'allocation', 'Betalning av avi ' || i.`number`, p.`invoice_id`, p.`id`
FROM `__payment_links` p JOIN `invoice` i ON i.`id` = p.`invoice_id`
WHERE p.`status` = 'matched';
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `payment_id`)
SELECT 'alloc-u-' || p.`id`, p.`organization_id`, 'alloc-' || p.`id`, 'unallocated', p.`amount_ore`, p.`id`
FROM `__payment_links` p WHERE p.`status` = 'matched' AND p.`invoice_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`, `payment_id`)
SELECT 'alloc-r-' || p.`id`, p.`organization_id`, 'alloc-' || p.`id`, 'receivable', -p.`amount_ore`, i.`party_id`, i.`agreement_id`, i.`id`, p.`id`
FROM `__payment_links` p JOIN `invoice` i ON i.`id` = p.`invoice_id`
WHERE p.`status` = 'matched';
--> statement-breakpoint
-- Avier marked paid by hand, with no bank payment behind them: what was owed on that day.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `created_at`)
SELECT 'man-' || i.`id`, i.`organization_id`, i.`paid_on`, 'manual_payment', 'Betalning av avi ' || i.`number`, i.`id`, i.`created_at`
FROM `invoice` i
WHERE i.`paid_on` IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM `__payment_links` p WHERE p.`invoice_id` = i.`id` AND p.`marks_invoice_paid` = 1);
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`)
SELECT 'man-b-' || i.`id`, i.`organization_id`, 'man-' || i.`id`, 'bank',
	i.`total_ore` - coalesce((SELECT sum(n.`total_ore`) FROM `credit_note` n WHERE n.`invoice_id` = i.`id` AND n.`issue_date` <= i.`paid_on`), 0)
FROM `invoice` i WHERE EXISTS (SELECT 1 FROM `posting` WHERE `id` = 'man-' || i.`id`);
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`)
SELECT 'man-r-' || i.`id`, i.`organization_id`, 'man-' || i.`id`, 'receivable',
	-(i.`total_ore` - coalesce((SELECT sum(n.`total_ore`) FROM `credit_note` n WHERE n.`invoice_id` = i.`id` AND n.`issue_date` <= i.`paid_on`), 0)),
	i.`party_id`, i.`agreement_id`, i.`id`
FROM `invoice` i WHERE EXISTS (SELECT 1 FROM `posting` WHERE `id` = 'man-' || i.`id`);
--> statement-breakpoint
-- Refunds already paid back.
INSERT INTO `posting` (`id`, `organization_id`, `date`, `kind`, `description`, `invoice_id`, `credit_note_id`)
SELECT 'ref-' || n.`id`, n.`organization_id`, n.`refunded_on`, 'refund', 'Återbetalning, kreditfaktura ' || n.`number`, n.`invoice_id`, n.`id`
FROM `credit_note` n WHERE n.`refunded_on` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`, `party_id`, `agreement_id`, `invoice_id`)
SELECT 'ref-r-' || n.`id`, n.`organization_id`, 'ref-' || n.`id`, 'receivable', n.`total_ore`, i.`party_id`, i.`agreement_id`, n.`invoice_id`
FROM `credit_note` n JOIN `invoice` i ON i.`id` = n.`invoice_id` WHERE n.`refunded_on` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ledger_entry` (`id`, `organization_id`, `posting_id`, `account`, `amount_ore`)
SELECT 'ref-b-' || n.`id`, n.`organization_id`, 'ref-' || n.`id`, 'bank', -n.`total_ore`
FROM `credit_note` n WHERE n.`refunded_on` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `__payment_links`;
--> statement-breakpoint
ALTER TABLE `invoice` DROP COLUMN `paid_on`;
--> statement-breakpoint
ALTER TABLE `credit_note` DROP COLUMN `refund`;
--> statement-breakpoint
ALTER TABLE `credit_note` DROP COLUMN `refunded_on`;
