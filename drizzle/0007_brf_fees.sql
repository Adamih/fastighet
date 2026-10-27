CREATE TABLE `price_base_amount` (
	`year` integer PRIMARY KEY NOT NULL,
	`amount_kr` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `pledge_fee_basis_points` integer;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `transfer_fee_basis_points` integer;--> statement-breakpoint
ALTER TABLE `pledge` ADD `confirmation_email` text;--> statement-breakpoint
ALTER TABLE `pledge` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `pledge` ADD `release_confirmed_at` integer;--> statement-breakpoint
INSERT INTO `price_base_amount` (`year`, `amount_kr`) VALUES (2020, 47300), (2021, 47600), (2022, 48300), (2023, 52500), (2024, 57300), (2025, 58800), (2026, 59200), (2027, 59600);
