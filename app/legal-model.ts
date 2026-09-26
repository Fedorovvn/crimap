import { z } from "zod";

const httpUrl = z.string().url().refine((url) => /^https?:\/\//i.test(url));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
const nonempty = z.string().trim().min(1);
const range = { min: z.number().finite().nonnegative().optional(), max: z.number().finite().positive() };
const penalty = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("imprisonment"), ...range, unit: z.enum(["years", "months"]) }).strict(),
  z.object({ kind: z.literal("fine"), ...range, unit: z.literal("HUF") }).strict(),
  z.object({ kind: z.literal("detention"), ...range, unit: z.literal("days") }).strict(),
  z.object({ kind: z.literal("community-service"), ...range, unit: z.literal("hours") }).strict(),
  z.object({ kind: z.literal("life-imprisonment") }).strict(),
  z.object({ kind: z.literal("driving-ban"), text: nonempty }).strict(),
  z.object({ kind: z.literal("other"), text: nonempty }).strict(),
]).refine((value) => !("min" in value) || value.min === undefined || value.min <= value.max);

export const legalAssessmentSchema = z.object({
  key: nonempty,
  jurisdiction: z.literal("HU"),
  // A descriptive scope is required even when no individual participant key is known.
  subjectLabel: nonempty,
  participantKey: nonempty.optional(),
  offense: nonempty,
  qualification: z.enum(["official", "reported", "possible"]),
  stage: z.enum(["investigation", "charged", "trial", "judgment"]),
  source: z.object({ label: nonempty, url: httpUrl, kind: z.enum(["official", "media"]), publishedAt: z.string().datetime({ offset: true }) }).strict(),
  // The authority's offense description and our matching of a statute are separate.
  statuteMatch: z.enum(["source-explicit", "editorial"]),
  statutes: z.array(z.object({
    code: z.enum(["criminal", "petty-offense", "administrative"]),
    act: nonempty, section: nonempty, url: httpUrl, versionDate: date,
  }).strict()).min(1),
  penalties: z.array(penalty),
  condition: nonempty,
  reviewStatus: z.enum(["pending", "approved"]),
  checkedAt: z.string().datetime({ offset: true }),
}).strict().refine((value) => value.qualification !== "official" || value.source.kind === "official");

export type LegalAssessment = z.infer<typeof legalAssessmentSchema>;
export type LegalPenalty = LegalAssessment["penalties"][number];

export function isPublishableLegal(value: unknown): value is LegalAssessment {
  const result = legalAssessmentSchema.safeParse(value);
  return result.success && result.data.reviewStatus === "approved";
}

export function penaltyLabel(value: LegalPenalty) {
  if (value.kind === "life-imprisonment") return "пожизненное лишение свободы";
  if (value.kind === "other" || value.kind === "driving-ban") return value.text;
  const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
  const amount = value.min === undefined ? `до ${number(value.max)}` : `${number(value.min)}-${number(value.max)}`;
  const plural = (forms: string[]) => forms[value.max % 10 === 1 && value.max % 100 !== 11 ? 0 : value.max % 10 >= 2 && value.max % 10 <= 4 && !(value.max % 100 >= 12 && value.max % 100 <= 14) ? 1 : 2];
  const genitive = (one: string, many: string) => value.max % 10 === 1 && value.max % 100 !== 11 ? one : many;
  if (value.kind === "fine") return `штраф ${amount} HUF`;
  // After «до» all count nouns use genitive; a range follows the upper bound.
  if (value.kind === "detention") return `${amount} ${value.min === undefined ? genitive("дня", "дней") : plural(["день", "дня", "дней"])} ареста`;
  if (value.kind === "community-service") return `${amount} ${value.min === undefined ? genitive("часа", "часов") : plural(["час", "часа", "часов"])} общественных работ`;
  return `${amount} ${value.unit === "years" ? (value.min === undefined ? genitive("года", "лет") : plural(["год", "года", "лет"])) : (value.min === undefined ? genitive("месяца", "месяцев") : plural(["месяц", "месяца", "месяцев"]))} лишения свободы`;
}
