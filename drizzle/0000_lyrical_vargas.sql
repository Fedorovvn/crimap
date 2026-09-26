CREATE TABLE `incident_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`outlet` text NOT NULL,
	`source_url` text NOT NULL,
	`published_at` text NOT NULL,
	`note` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_sources_url_unique` ON `incident_sources` (`source_url`);--> statement-breakpoint
CREATE INDEX `idx_incident_sources_incident_id` ON `incident_sources` (`incident_id`);--> statement-breakpoint
CREATE TABLE `incident_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`published_at` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`verification` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_updates_unique` ON `incident_updates` (`incident_id`,`published_at`,`title`);--> statement-breakpoint
CREATE INDEX `idx_incident_updates_incident_id_published_at` ON `incident_updates` (`incident_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`status` text NOT NULL,
	`verification` text NOT NULL,
	`district` text NOT NULL,
	`location_label` text NOT NULL,
	`location_precision` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`occurred_at` text NOT NULL,
	`summary` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_slug_unique` ON `incidents` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_incidents_occurred_at` ON `incidents` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_incidents_district_occurred_at` ON `incidents` (`district`,`occurred_at`);