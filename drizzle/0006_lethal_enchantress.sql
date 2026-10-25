DROP INDEX `invoice_lease_period_uq`;--> statement-breakpoint
ALTER TABLE `invoice` ADD `replaces_invoice_id` text REFERENCES invoice(id);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_lease_period_uq` ON `invoice` (`lease_id`,`period_start`) WHERE "invoice"."voided_at" is null and "invoice"."credited_ore" < "invoice"."total_ore";--> statement-breakpoint
ALTER TABLE `credit_note` ADD `refund` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `credit_note` ADD `refunded_on` text;--> statement-breakpoint
-- Credit notes issued after their invoice was paid are paid back to the tenant.
UPDATE `credit_note` SET `refund` = 1 WHERE EXISTS (SELECT 1 FROM `invoice` WHERE `invoice`.`id` = `credit_note`.`invoice_id` AND `invoice`.`paid_on` IS NOT NULL AND `invoice`.`paid_on` <= `credit_note`.`issue_date`);
