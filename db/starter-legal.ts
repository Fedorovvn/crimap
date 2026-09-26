import type { LegalAssessment } from "../app/legal-model";

const law = { code: "criminal", act: "2012. évi C. törvény", url: "https://njt.jog.gov.hu/jogszabaly/2012-100-00-00", versionDate: "2026-08-26" } as const;
const attackSource = { kind: "official", label: "BRFK / police.hu", url: "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/emberoles-erzsebetvarosban-a-nyomozok-mindket", publishedAt: "2026-09-21T09:52:00+02:00" } as const;
const common = { jurisdiction: "HU", qualification: "official", stage: "investigation", statuteMatch: "editorial", reviewStatus: "approved", checkedAt: "2026-09-26T12:00:00+02:00" } as const;

// Police reports and the NJT edition above were read together on 2026-09-26.
// Reports describe offenses, but do not explicitly cite these paragraph numbers.
export const starterLegal: Record<string, LegalAssessment[]> = {
  "akacfa-homicide": [
    { ...common, key: "suspect-40-homicide", subjectLabel: "40-летний подозреваемый", participantKey: "suspect-40", offense: "убийство", source: attackSource,
      statutes: [{ ...law, section: "§ 160 (1)" }], penalties: [{ kind: "imprisonment", min: 5, max: 15, unit: "years" }],
      condition: "Если будет применён основной состав убийства. Часть статьи в сообщении полиции не названа; квалифицирующие обстоятельства могут изменить санкцию." },
    { ...common, key: "suspect-48-attempt", subjectLabel: "48-летний подозреваемый", participantKey: "suspect-48", offense: "покушение на причинение тяжких телесных повреждений", source: attackSource,
      statutes: [{ ...law, section: "§ 164 (3)" }, { ...law, section: "§ 10 (2)" }], penalties: [{ kind: "imprisonment", max: 3, unit: "years" }],
      condition: "Для основного состава; при покушении применяется санкция оконченного преступления. Часть статьи в сообщении полиции не названа." },
  ],
  "soroksari-fatal-crash": [
    { ...common, key: "driver-drug-impaired-fatal", subjectLabel: "Водитель Mitsubishi", participantKey: "mitsubishi-driver", offense: "управление под воздействием одурманивающих веществ, повлёкшее смерть",
      source: { kind: "official", label: "BRFK / police.hu", url: "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/orizetben-a-soroksari-uti-halalos", publishedAt: "2026-09-04T11:50:00+02:00" },
      statutes: [{ ...law, section: "§ 237 (2) c)" }], penalties: [{ kind: "imprisonment", min: 2, max: 8, unit: "years" }],
      condition: "Если суд установит этот состав преступления. Полиция сообщает о подозрении; виновность ещё не установлена." },
  ],
};
