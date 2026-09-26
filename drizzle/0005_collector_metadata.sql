CREATE TABLE IF NOT EXISTS incident_metadata (
  incident_id INTEGER PRIMARY KEY REFERENCES incidents(id),
  details TEXT NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS incident_sources_url_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS incident_sources_event_url_unique ON incident_sources(incident_id,source_url);
--> statement-breakpoint
DROP INDEX IF EXISTS incident_media_image_url_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS incident_media_event_image_unique ON incident_media(incident_id,image_url);
