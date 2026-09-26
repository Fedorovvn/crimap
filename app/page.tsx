import { asc, desc, eq } from "drizzle-orm";
import { ensureStarterIncidents, getDb, getIncidentParticipants, getIncidentContext, getIncidentLegal, getIncidentMetadata } from "../db";
import { incidentMedia, incidents, incidentSources, incidentUpdates } from "../db/schema";
import { IncidentsView, type IncidentView } from "./incidents-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureStarterIncidents();
  const db = getDb();
  const rows = await db.select().from(incidents).orderBy(desc(incidents.occurredAt));

  const initialIncidents: IncidentView[] = await Promise.all(
    rows.map(async (incident) => {
      const [sources, updates, media, participants, context, legal, metadata] = await Promise.all([
        db.select().from(incidentSources).where(eq(incidentSources.incidentId, incident.id)).orderBy(desc(incidentSources.publishedAt)),
        db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, incident.id)).orderBy(asc(incidentUpdates.publishedAt)),
        db.select().from(incidentMedia).where(eq(incidentMedia.incidentId, incident.id)).orderBy(asc(incidentMedia.id)),
        getIncidentParticipants(incident.id),
        getIncidentContext(incident.id),
        getIncidentLegal(incident.id),
        getIncidentMetadata(incident.id),
      ]);
      return { ...incident, ...metadata, sources, updates, media, participants, context, legal };
    }),
  );

  return <IncidentsView incidents={initialIncidents} />;
}
