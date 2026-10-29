CREATE TABLE `late_interest` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`days` integer NOT NULL,
	`amount_ore` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`,`invoice_id`) REFERENCES `invoice`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`charge_id`) REFERENCES `charge`(`organization_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `late_interest_org_id_uq` ON `late_interest` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `late_interest_invoice_uq` ON `late_interest` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `reference_rate` (
	`from_date` text PRIMARY KEY NOT NULL,
	`basis_points` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `late_interest` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `late_interest_minimum_ore` integer;--> statement-breakpoint
-- Riksbanken's referensränta per half-year (räntelagen 9 §), from riksbank.se. Add each new
-- half-year's rate, decided on the last weekday before it starts, in a migration of its own.
INSERT INTO `reference_rate` (`from_date`, `basis_points`) VALUES
  ('2022-01-01', 0),
  ('2022-07-01', 50),
  ('2023-01-01', 250),
  ('2023-07-01', 350),
  ('2024-01-01', 400),
  ('2024-07-01', 400),
  ('2025-01-01', 300),
  ('2025-07-01', 200),
  ('2026-01-01', 200),
  ('2026-07-01', 200);
