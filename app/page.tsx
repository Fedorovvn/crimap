import { loadPublicIncidents } from "./incidents-data";
import { IncidentsView } from "./incidents-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialIncidents = await loadPublicIncidents();
  return <IncidentsView incidents={initialIncidents} />;
}
