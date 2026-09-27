import { translate, type Locale } from "./locale";

export type PersonProfile = {
  kind: "person";
  name?: string;
  gender?: "male" | "female";
  age?: number;
  ageGroup?: "child" | "adult" | "older";
  citizenship?: { code: string; name: string };
};

export type GroupProfile = {
  kind: "group";
  count?: number;
  gender?: "male" | "female";
  leader?: { person: PersonProfile; status: ParticipantStatus; sourceUrl: string };
};

export type ParticipantStatus = "detained" | "wanted" | "in-custody" | "charged" | "convicted" | "released" | "deceased" | "injured" | "unknown";
export type Participant = {
  key: string;
  role: "suspect" | "victim" | "convicted" | "involved";
  label: string;
  status: ParticipantStatus;
  profile: PersonProfile | GroupProfile;
  note?: string;
  wantedNotice?: { description: string; sourceUrl?: string; isDemo?: boolean };
  sourceUrl: string;
  sourceLabel: string;
  asOf: string;
};

export const GROUP_DISPLAY_MINIMUM = 5;

/** Expand known small groups without inventing individual identities or ages. */
export type DisplayParticipant = Participant & { sourceParticipantKey?: string };
export function participantsForDisplay(participants: Participant[], locale: Locale = "ru"): DisplayParticipant[] {
  const labels = { suspect: "Подозреваемый", victim: "Потерпевший", convicted: "Осуждённый", involved: "Участник" };
  const femaleLabels = { suspect: "Подозреваемая", victim: "Потерпевшая", convicted: "Осуждённая", involved: "Участница" };
  return participants.flatMap((participant) => {
    const group = participant.profile;
    if (group.kind !== "group" || group.count == null || !Number.isInteger(group.count) || group.count < 1 || group.count >= GROUP_DISPLAY_MINIMUM) return [participant];
    return Array.from({ length: group.count }, (_, index): DisplayParticipant => {
      const leader = index === 0 ? group.leader : undefined;
      const profile: PersonProfile = leader?.person ?? { kind: "person", gender: group.gender };
      return {
        ...participant,
        key: `${participant.key}-person-${index + 1}`,
        sourceParticipantKey: participant.key,
        label: `${translate((profile.gender === "female" ? femaleLabels : labels)[participant.role],locale)} ${index + 1}`,
        profile,
        status: leader?.status ?? participant.status,
        note: participant.note || translate(leader ? "Предполагаемый лидер." : "Индивидуальные сведения не опубликованы.",locale),
        sourceUrl: leader?.sourceUrl ?? participant.sourceUrl,
        sourceLabel: leader ? translate("Источник сведений о лидере",locale) : participant.sourceLabel,
      };
    });
  });
}

export const participantStatuses: Record<ParticipantStatus, string> = {
  detained: "Задержан", wanted: "В розыске", "in-custody": "Под стражей",
  charged: "Предъявлено обвинение", convicted: "Осуждён", released: "Освобождён",
  deceased: "Погиб", injured: "Пострадал", unknown: "Статус не указан",
};

export function participantStatusLabel(status: ParticipantStatus, profile: Participant["profile"]) {
  const base = participantStatuses[status];
  const inflections: Partial<Record<ParticipantStatus, [string, string]>> = {
    detained: ["Задержана", "Задержаны"], convicted: ["Осуждена", "Осуждены"],
    released: ["Освобождена", "Освобождены"], deceased: ["Погибла", "Погибли"],
    injured: ["Пострадала", "Пострадали"],
  };
  const forms = inflections[status];
  if (!forms) return base;
  if (profile.kind === "group") return forms[1];
  return profile.gender === "female" ? forms[0] : base;
}

export function avatarFor(profile: Participant["profile"]): string {
  if (profile.kind === "group") return (profile.count ?? 0) >= GROUP_DISPLAY_MINIMUM ? "group" : "person-neutral";
  const ageGroup = profile.age != null
    ? profile.age < 18 ? "child" : profile.age >= 60 ? "older" : "adult"
    : profile.ageGroup;
  if (!profile.gender) return ageGroup === "child" ? "child-neutral" : "person-neutral";
  if (ageGroup === "child") return profile.gender === "male" ? "boy" : "girl";
  if (ageGroup === "older") return profile.gender === "male" ? "elderly-male" : "elderly-female";
  return profile.gender === "male" ? "adult-male" : "adult-female";
}

export function ageLabel(age: number, locale: Locale = "ru") {
  if(locale!=="ru") return locale==="hu"?`${age} éves`:`${age} ${age===1?"year":"years"} old`;
  const mod100 = age % 100;
  const ending = mod100 >= 11 && mod100 <= 14 ? "лет" : age % 10 === 1 ? "год" : [2, 3, 4].includes(age % 10) ? "года" : "лет";
  return `${age} ${ending}`;
}

export function countryFlag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((letter) => letter.charCodeAt(0) + 127397));
}
