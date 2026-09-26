import type { Participant } from "../app/participants-model";

// Archive facts plus the police update checked 2026-09-26.
// Citizenship and any leadership role remain unknown and are not inferred.
const crashSource = "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/orizetben-a-soroksari-uti-halalos";
const attackSource = "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/emberoles-erzsebetvarosban-a-nyomozok-mindket";
export const starterParticipants: Record<string, Participant[]> = {
  "soroksari-fatal-crash": [
    { key: "mitsubishi-driver", role: "suspect", label: "Водитель Mitsubishi", status: "detained", profile: { kind: "person" }, note: "Подозрение в управлении в состоянии опьянения. Расследование продолжается.", sourceUrl: crashSource, sourceLabel: "BRFK / police.hu", asOf: "2026-09-04T11:50:00+02:00" },
    { key: "ford-driver", role: "victim", label: "Водитель Ford", status: "deceased", profile: { kind: "person", gender: "male", age: 62 }, note: "Погиб на месте столкновения.", sourceUrl: crashSource, sourceLabel: "BRFK / police.hu", asOf: "2026-09-04T11:50:00+02:00" },
    { key: "ford-passenger", role: "victim", label: "Пассажир Ford", status: "injured", profile: { kind: "person" }, note: "Госпитализирован с тяжёлыми травмами.", sourceUrl: crashSource, sourceLabel: "BRFK / police.hu", asOf: "2026-09-04T11:50:00+02:00" },
  ],
  "akacfa-homicide": [
    { key: "suspect-40", role: "suspect", label: "40-летний подозреваемый", status: "detained", profile: { kind: "person", gender: "male", age: 40 }, note: "По сообщению BRFK, допрошен по подозрению в убийстве. Полиция ходатайствовала о заключении под стражу.", sourceUrl: attackSource, sourceLabel: "BRFK / police.hu", asOf: "2026-09-21T09:52:00+02:00" },
    { key: "suspect-48", role: "suspect", label: "48-летний подозреваемый", status: "detained", profile: { kind: "person", gender: "male", age: 48 }, note: "По сообщению BRFK, допрошен по подозрению в покушении на причинение тяжких телесных повреждений.", sourceUrl: attackSource, sourceLabel: "BRFK / police.hu", asOf: "2026-09-21T09:52:00+02:00" },
    { key: "victim", role: "victim", label: "Потерпевший", status: "deceased", profile: { kind: "person", gender: "male", age: 36 }, note: "Умер на месте, несмотря на помощь медиков.", sourceUrl: "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/emberoles-erzsebetvarosban-1", sourceLabel: "BRFK / police.hu", asOf: "2026-09-18T09:12:00+02:00" },
  ],
};
