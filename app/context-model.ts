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

export const contextTopics: Record<ContextTopic, string> = {
  motive: "Возможный мотив", circumstances: "Обстоятельства", citizenship: "Гражданство",
  occupation: "Занятие", "visitor-status": "Пребывание в городе", "housing-status": "Жилищная ситуация", appearance: "Описание очевидца",
};

/** Editorial approval and evidence are required; personal attributes are never model guesses. */
export function isPublishableContext(claim: ContextClaim) {
  if (claim.reviewStatus !== "approved" || !claim.text.trim() || !Number.isFinite(Date.parse(claim.asOf))) return false;
  if (!claim.evidence.length || claim.evidence.some((e) => !/^https?:\/\//i.test(e.url) || !e.label.trim())) return false;
  if (claim.origin === "model") return claim.subject.kind === "event" && claim.topic === "circumstances"
    && claim.verification !== "corroborated" && !!claim.rationale?.trim();
  return claim.evidence.some((e) => e.relation === "supports");
}

export function contextOriginLabel(claim: ContextClaim) {
  if (claim.origin === "model") return "Гипотеза модели";
  return claim.evidence.some((e) => e.kind === "official" && e.relation === "supports")
    ? "Официальный источник" : "Неофициально";
}
