-- Reminder fees become one-off charges the agreement's next avi bills (`fee_charge_id`). The
-- composite foreign key needs a rebuilt table; nothing references payment_reminder, so dropping
-- the old one cascades nowhere. Earlier fees stay posted to their avier, without a charge.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_payment_reminder` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`sent_on` text NOT NULL,
	`due_date` text NOT NULL,
	`owed_ore` integer NOT NULL,
	`fee_ore` integer DEFAULT 0 NOT NULL,
	`fee_charge_id` text,
	`fee_waived_on` text,
	`fee_waiver` text,
	`recipient_email` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`fee_charge_id`) REFERENCES `charge`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_payment_reminder`("id", "organization_id", "invoice_id", "sequence", "sent_on", "due_date", "owed_ore", "fee_ore", "fee_charge_id", "fee_waived_on", "fee_waiver", "recipient_email", "created_at") SELECT "id", "organization_id", "invoice_id", "sequence", "sent_on", "due_date", "owed_ore", "fee_ore", NULL, "fee_waived_on", "fee_waiver", "recipient_email", "created_at" FROM `payment_reminder`;--> statement-breakpoint
DROP TABLE `payment_reminder`;--> statement-breakpoint
ALTER TABLE `__new_payment_reminder` RENAME TO `payment_reminder`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reminder_org_id_uq` ON `payment_reminder` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_reminder_invoice_sequence_uq` ON `payment_reminder` (`invoice_id`,`sequence`);