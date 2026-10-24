CREATE TABLE `submission` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`operation` text NOT NULL,
	`request_id` text NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`, `operation`, `request_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
