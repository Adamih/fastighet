CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`trial_start` integer,
	`trial_end` integer,
	`cancel_at_period_end` integer DEFAULT false,
	`cancel_at` integer,
	`canceled_at` integer,
	`ended_at` integer,
	`seats` integer,
	`billing_interval` text,
	`stripe_schedule_id` text
);
--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `plan_override` text;--> statement-breakpoint
ALTER TABLE `organization` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `stripe_customer_id` text;--> statement-breakpoint
-- Companies from before subscriptions keep everything they could do: their type's top tier,
-- set by us, until they choose a plan.
INSERT INTO `organization_settings` (`organization_id`) SELECT `id` FROM `organization` WHERE `id` NOT IN (SELECT `organization_id` FROM `organization_settings`);--> statement-breakpoint
UPDATE `organization_settings` SET `plan_override` = CASE `kind` WHEN 'brf' THEN 'brf_pro' ELSE 'landlord_pro' END;
