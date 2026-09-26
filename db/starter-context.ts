import type { ContextClaim } from "../app/context-model";

const indexUrl = "https://index.hu/belfold/2026/09/18/budapest-gyilkossag-bokszolo-tamadok-azonositas-rendorseg/";
const indexEvidence = [{ kind: "media", label: "Index.hu", url: indexUrl, relation: "supports", attribution: "со слов знакомого погибшего; личность собеседника не раскрыта" }] satisfies ContextClaim["evidence"];

// Source statements inspected 2026-09-26. These are attributed reports, not verified biography.
export const starterContext: Record<string, ContextClaim[]> = {
  "akacfa-homicide": [
    { key: "victim-housing-report", subject: { kind: "participant", participantKey: "victim" }, topic: "housing-status",
      text: "По сообщению Index со слов знакомого погибшего, мужчина предположительно не имел постоянного жилья.",
      origin: "source", verification: "unverified", reviewStatus: "approved", evidence: indexEvidence, asOf: "2026-09-26T00:00:00+02:00" },
    { key: "victim-boxing-report", subject: { kind: "participant", participantKey: "victim" }, topic: "occupation",
      text: "Знакомый погибшего, на которого ссылается Index, рассказал, что мужчина раньше занимался боксом.",
      origin: "source", verification: "unverified", reviewStatus: "approved", evidence: indexEvidence, asOf: "2026-09-26T00:00:00+02:00" },
  ],
  "soroksari-fatal-crash": [
    { key: "crossing-cause-unresolved", subject: { kind: "event" }, topic: "circumstances",
      text: "24.hu со ссылкой на сообщение BRFK пишет: причина выезда Mitsubishi на встречную полосу на момент публикации оставалась невыясненной.",
      origin: "source", verification: "unverified", reviewStatus: "approved",
      evidence: [{ kind: "media", label: "24.hu", url: "https://24.hu/belfold/2026/09/04/soroksari-ut-frontalis-baleset-vallomas/", relation: "supports", attribution: "пересказ сообщения полиции; прямая проверка этого утверждения по первоисточнику не выполнена" }],
      asOf: "2026-09-04T12:31:00+02:00" },
  ],
};
