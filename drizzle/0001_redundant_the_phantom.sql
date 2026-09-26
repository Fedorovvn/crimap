CREATE TABLE `incident_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`source_url` text NOT NULL,
	`outlet` text NOT NULL,
	`credit` text NOT NULL,
	`caption` text NOT NULL,
	`is_sensitive` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_media_image_url_unique` ON `incident_media` (`image_url`);--> statement-breakpoint
CREATE INDEX `idx_incident_media_incident_id` ON `incident_media` (`incident_id`);