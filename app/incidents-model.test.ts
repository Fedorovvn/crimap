import { describe, expect, it } from "vitest";
import { filterIncidents, selectVisibleIncident, matchesSeverity, REFERENCE_TIME } from "./incidents-model";

const incidents = [
  { slug: "soroksari-fatal-crash", occurredAt: "2026-09-03T05:55:00+02:00" },
  { slug: "akacfa-homicide", occurredAt: "2026-09-18T01:40:00+02:00" },
];

describe("incident filtering", () => {
  it('serious means assaults or deaths, not every injury or other crime',()=>{
    for(const eventType of ['traffic-accident','fire','accident','robbery','fight','other']){
      expect(matchesSeverity({eventType,signals:['injury']},'serious')).toBe(false);
      expect(matchesSeverity({eventType,signals:['death']},'serious')).toBe(true);
      expect(matchesSeverity({eventType,signals:['death']},'fatal')).toBe(true);
    }
    expect(matchesSeverity({eventType:'assault',signals:[]},'serious')).toBe(true);
    expect(matchesSeverity({eventType:'assault',signals:[]},'fatal')).toBe(false);
    expect(matchesSeverity({participants:[{status:'deceased'}]},'fatal')).toBe(true);
    expect(matchesSeverity({},'fatal')).toBe(false);
  });
  it("shows no seeded stories in the last 24 hours", () => {
    expect(filterIncidents(incidents, 24, REFERENCE_TIME)).toEqual([]);
  });

  it("shows only the Akácfa incident in the last seven days", () => {
    expect(filterIncidents(incidents, 24 * 7, REFERENCE_TIME).map((incident) => incident.slug)).toEqual([
      "akacfa-homicide",
    ]);
  });

  it("shows both seeded stories within a month", () => {
    expect(filterIncidents(incidents, 24 * 31, REFERENCE_TIME)).toHaveLength(2);
  });

  it("keeps an explicit selected story and falls back safely", () => {
    expect(selectVisibleIncident(incidents, "akacfa-homicide")?.slug).toBe("akacfa-homicide");
    expect(selectVisibleIncident(incidents, "missing")?.slug).toBe("soroksari-fatal-crash");
    expect(selectVisibleIncident([], "missing")).toBeUndefined();
  });

});
