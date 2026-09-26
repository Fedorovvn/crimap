/** Budapest Signal — снимок модели 2026-09-26, версия документа 1.2.
 * Самостоятельный контракт; пока не подключён к проверке данных сайта.
 * Неизвестное необязательное поле пропускается: null не используется.
 */
export const PARTICIPANT_ROLES = ["suspect", "victim", "convicted", "involved"] as const;
export const PARTICIPANT_STATUSES = [
  "detained", "wanted", "in-custody", "charged", "convicted",
  "released", "deceased", "injured", "unknown",
] as const;
export const GENDERS = ["male", "female"] as const;
export const AGE_GROUPS = ["child", "adult", "older"] as const;
export const PROFILE_KINDS = ["person", "group"] as const;
export const GROUP_DISPLAY_MINIMUM = 5;

export type ParticipantRole = typeof PARTICIPANT_ROLES[number];
export type ParticipantStatus = typeof PARTICIPANT_STATUSES[number];
export type Gender = typeof GENDERS[number];
export type AgeGroup = typeof AGE_GROUPS[number];
/** ISO 8601 / RFC 3339 со смещением или Z. В текущем приложении это string. */
export type DateTime = string;
/** Ссылка на источник; рекомендуются абсолютные HTTP(S) URL. */
export type SourceUrl = string;
/** URL фотографии: абсолютный HTTP(S) или локальный путь от корня сайта. */
export type ImageUrl = string;

export interface Citizenship {
  /** Двухбуквенный код страны в верхнем регистре, например HU. */
  code: string;
  name: string;
}
export interface PersonProfile {
  kind: "person";
  name?: string;
  gender?: Gender;
  age?: number;
  /** Используется для выбора силуэта, если точный возраст неизвестен. */
  ageGroup?: AgeGroup;
  citizenship?: Citizenship;
}
export interface GroupLeader {
  person: PersonProfile;
  status: ParticipantStatus;
  sourceUrl: SourceUrl;
}
export interface GroupProfile {
  kind: "group";
  /** Общая численность, включая лидера. 1–4 разворачиваются в отдельные карточки. */
  count?: number;
  gender?: Gender;
  leader?: GroupLeader;
}
export interface Participant {
  key: string;
  role: ParticipantRole;
  label: string;
  status: ParticipantStatus;
  profile: PersonProfile | GroupProfile;
  note?: string;
  sourceUrl: SourceUrl;
  sourceLabel: string;
  asOf: DateTime;
}

export interface IncidentSourceInput {
  /** Свободный текст, не enum. */
  sourceType: string;
  outlet: string;
  sourceUrl: SourceUrl;
  publishedAt: DateTime;
  note: string;
}
export interface IncidentUpdateInput {
  publishedAt: DateTime;
  title: string;
  detail: string;
  /** Свободный текст, не enum. */
  verification: string;
}
export interface IncidentMediaInput {
  imageUrl: ImageUrl;
  sourceUrl: SourceUrl;
  outlet: string;
  credit: string;
  caption: string;
  /** В контракте передаётся явно; в БД default false. */
  isSensitive: boolean;
}
/** Поля, которые можно заполнять. Это не существующий HTTP endpoint. */
export interface IncidentInput {
  /** Атрибутированные сведения и версии о событии и конкретных участниках. */
  context?: ContextClaim[];
  /** Квалификация и санкции со ссылками на закон и сообщение по делу. */
  legal?: LegalAssessment[];
  slug: string;
  title: string;
  /** Свободный текст. Отображаемый тип происшествия вычисляется отдельно. */
  category: string;
  /** Текстовый статус всего события; отличается от enum статуса участника. */
  status: string;
  verification: string;
  district: string;
  locationLabel: string;
  locationPrecision: string;
  latitude: number;
  longitude: number;
  occurredAt: DateTime;
  summary: string;
  updatedAt: DateTime;
  sources: IncidentSourceInput[];
  updates: IncidentUpdateInput[];
  media: IncidentMediaInput[];
  /** Необязательное для совместимости с текущим UI; рекомендуется []. */
  participants?: Participant[];
}
export interface StoredChild {
  id: number;
  /** Приходит из БД, но UI не требует это поле. */
  incidentId?: number;
}
export interface IncidentSource extends IncidentSourceInput, StoredChild {}
export interface IncidentUpdate extends IncidentUpdateInput, StoredChild {}
export interface IncidentMedia extends IncidentMediaInput, StoredChild {}
/** Полный объект, передаваемый интерфейсу. */
export interface IncidentEvent extends Omit<IncidentInput, "sources" | "updates" | "media"> {
  id: number;
  sources: IncidentSource[];
  updates: IncidentUpdate[];
  media: IncidentMedia[];
}

// Вычисляемые значения интерфейса. НЕ дополнительные поля входного события.
export type DerivedIncidentType = "ДТП" | "Драка" | "Ограбление" | "Несчастный случай" | "Нападение" | "Происшествие";
export type DerivedIncidentSignal = "death" | "suspect-detained" | "suspect-wanted";
export type DerivedAvatar = "adult-male" | "adult-female" | "elderly-male" | "elderly-female" | "boy" | "girl" | "person-neutral" | "child-neutral" | "group";

export type ContextTopic = "motive" | "circumstances" | "citizenship" | "occupation" | "visitor-status" | "housing-status" | "appearance";
export type ContextEvidence = {
  kind: "official" | "media" | "eyewitness" | "social";
  label: string;
  url: string;
  attribution?: string;
  relation: "supports" | "disputes" | "background";
};
export type ContextClaim = {
  key: string;
  subject: { kind: "event" } | { kind: "participant"; participantKey: string };
  topic: ContextTopic;
  text: string;
  origin: "source" | "model";
  verification: "unverified" | "corroborated" | "disputed" | "retracted";
  reviewStatus: "pending" | "approved";
  evidence: ContextEvidence[];
  asOf: string;
  rationale?: string;
};

export type LegalPenalty =
  | { kind: "imprisonment"; min?: number; max: number; unit: "years" | "months" }
  | { kind: "fine"; min?: number; max: number; unit: "HUF" }
  | { kind: "detention"; min?: number; max: number; unit: "days" }
  | { kind: "community-service"; min?: number; max: number; unit: "hours" }
  | { kind: "life-imprisonment" }
  | { kind: "driving-ban" | "other"; text: string };
export interface LegalAssessment {
  key: string;
  jurisdiction: "HU";
  subjectLabel: string;
  participantKey?: string;
  offense: string;
  qualification: "official" | "reported" | "possible";
  stage: "investigation" | "charged" | "trial" | "judgment";
  source: { label: string; url: string; kind: "official" | "media"; publishedAt: DateTime };
  statuteMatch: "source-explicit" | "editorial";
  statutes: { code: "criminal" | "petty-offense" | "administrative"; act: string; section: string; url: string; versionDate: string }[];
  penalties: LegalPenalty[];
  condition: string;
  reviewStatus: "pending" | "approved";
  checkedAt: DateTime;
}
