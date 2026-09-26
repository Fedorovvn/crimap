CREATE TABLE IF NOT EXISTS incident_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  incident_id INTEGER NOT NULL REFERENCES incidents(id),
  claim_key TEXT NOT NULL,
  details TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS incident_context_event_key_unique ON incident_context(incident_id, claim_key);
