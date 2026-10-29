ALTER TABLE `organization_settings` ADD `portal_contact_edits` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `portal_contact_email` text;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `portal_contact_phone` text;