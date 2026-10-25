-- The tenant register becomes the party register: tenants, co-tenants and the owners of a
-- bostadsrätt. Renames keep the data, and SQLite rewrites the foreign keys that point at it.
ALTER TABLE `tenant` RENAME TO `party`;
--> statement-breakpoint
DROP INDEX `tenant_org_name_idx`;
--> statement-breakpoint
CREATE INDEX `party_org_name_idx` ON `party` (`organization_id`,`name`);
--> statement-breakpoint
ALTER TABLE `agreement_party` RENAME COLUMN `tenant_id` TO `party_id`;
--> statement-breakpoint
DROP INDEX `agreement_party_org_tenant_idx`;
--> statement-breakpoint
CREATE INDEX `agreement_party_org_party_idx` ON `agreement_party` (`organization_id`,`party_id`);
--> statement-breakpoint
ALTER TABLE `invoice` RENAME COLUMN `tenant_id` TO `party_id`;
