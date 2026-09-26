CREATE TABLE `incident_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`participant_key` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incident_participants_incident_key_unique` ON `incident_participants` (`incident_id`,`participant_key`);