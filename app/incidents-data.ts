import { asc, desc, eq, sql } from "drizzle-orm";
import { ensureStarterIncidents, getDb, getIncidentParticipants, getIncidentContext, getIncidentLegal, getIncidentMetadata } from "../db";
import { incidentMedia, incidents, incidentSources, incidentUpdates } from "../db/schema";
import starterTranslations from "../db/starter-translations.json";
import type { IncidentView } from "./incidents-view";

/** The public projection used by the map, feed and lightweight live refresh. */
export async function loadPublicIncidents(): Promise<IncidentView[]> {
  await ensureStarterIncidents();
  const db = getDb();
  const rows = await db.select().from(incidents)
    .where(sql`NOT EXISTS (SELECT 1 FROM incident_metadata m WHERE m.incident_id = ${incidents.id} AND json_extract(m.details, '$.hidden') = 1)`)
    .orderBy(desc(incidents.occurredAt));

  return Promise.all(rows.map(async (incident) => {
    const [sources, updates, media, participants, context, legal, metadata] = await Promise.all([
      db.select().from(incidentSources).where(eq(incidentSources.incidentId, incident.id)).orderBy(desc(incidentSources.publishedAt)),
      db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, incident.id)).orderBy(asc(incidentUpdates.publishedAt)),
      db.select().from(incidentMedia).where(eq(incidentMedia.incidentId, incident.id)).orderBy(asc(incidentMedia.id)),
      getIncidentParticipants(incident.id),
      getIncidentContext(incident.id),
      getIncidentLegal(incident.id),
      getIncidentMetadata(incident.id),
    ]);
    const translations = metadata.translations
      ?? (starterTranslations as Record<string, IncidentView["translations"]>)[incident.slug];
    return { ...incident, ...metadata, translations, sources, updates, media, participants, context, legal };
  }));
}
