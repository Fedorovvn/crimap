import { loadPublicIncidents } from "../../incidents-data";

export const dynamic = "force-dynamic";

/** Public, no-cache feed endpoint for the map and incident cards. */
export async function GET() {
  const incidents = await loadPublicIncidents();
  return Response.json(
    { incidents },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
