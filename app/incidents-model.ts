export type TimedIncident = {
  slug: string;
  occurredAt: string;
};

export const PERIODS = [
  { label: "24 ч", hours: 24 },
  { label: "7 дней", hours: 24 * 7 },
  { label: "Месяц", hours: 24 * 31 },
] as const;

export const REFERENCE_TIME = new Date("2026-09-25T00:00:00+02:00").getTime();

export function filterIncidents<T extends TimedIncident>(
  incidents: T[],
  hours: number,
  now = Date.now(),
) {
  return incidents.filter((incident) => {
    const age = now - new Date(incident.occurredAt).getTime();
    return age >= 0 && age <= hours * 60 * 60 * 1000;
  });
}

export function selectVisibleIncident<T extends { slug: string }>(
  incidents: T[],
  requestedSlug: string,
) {
  return incidents.find((incident) => incident.slug === requestedSlug) ?? incidents[0];
}
