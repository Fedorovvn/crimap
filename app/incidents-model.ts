export type TimedIncident = {
  slug: string;
  occurredAt: string;
};

export const PERIODS = [
  { label: "24 ч", hours: 24 },
  { label: "7 дней", hours: 24 * 7 },
  { label: "Месяц", hours: 24 * 31 },
  { label: "Всё время", hours: Infinity },
] as const;

export const REFERENCE_TIME = new Date("2026-09-25T00:00:00+02:00").getTime();

export const SEVERITIES = [
  { value: "all", label: "Все" },
  { value: "serious", label: "Серьёзные" },
  { value: "fatal", label: "Смертельные" },
] as const;
export type Severity = (typeof SEVERITIES)[number]["value"];

export function matchesSeverity(incident: { eventType?: string; signals?: string[]; participants?: { status: string }[] }, severity: Severity) {
  const fatal = incident.signals?.includes("death") || incident.participants?.some(person => person.status === "deceased");
  return severity === "all" || !!fatal || (severity === "serious" && incident.eventType === "assault");
}

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
