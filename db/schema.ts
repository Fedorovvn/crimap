import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Participant } from "../app/participants-model";
import type { ContextClaim } from "../app/context-model";
import type { LegalAssessment } from "../app/legal-model";

export const incidentLegal = sqliteTable("incident_legal", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull().references(() => incidents.id),
  assessmentKey: text("assessment_key").notNull(),
  details: text("details", { mode: "json" }).$type<LegalAssessment>().notNull(),
}, (table) => [uniqueIndex("incident_legal_event_key_unique").on(table.incidentId, table.assessmentKey)]);

export const incidentContext = sqliteTable("incident_context", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull().references(() => incidents.id),
  claimKey: text("claim_key").notNull(),
  details: text("details", { mode: "json" }).$type<ContextClaim>().notNull(),
}, (table) => [uniqueIndex("incident_context_event_key_unique").on(table.incidentId, table.claimKey)]);

export const incidentParticipants = sqliteTable("incident_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull().references(() => incidents.id),
  participantKey: text("participant_key").notNull(),
  details: text("details", { mode: "json" }).$type<Participant>().notNull(),
}, (table) => [uniqueIndex("incident_participants_incident_key_unique").on(table.incidentId, table.participantKey)]);

export const incidents = sqliteTable(
  "incidents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull(),
    verification: text("verification").notNull(),
    district: text("district").notNull(),
    locationLabel: text("location_label").notNull(),
    locationPrecision: text("location_precision").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    occurredAt: text("occurred_at").notNull(),
    summary: text("summary").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("incidents_slug_unique").on(table.slug),
    index("idx_incidents_occurred_at").on(table.occurredAt),
    index("idx_incidents_district_occurred_at").on(table.district, table.occurredAt),
  ],
);

export const incidentSources = sqliteTable(
  "incident_sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id),
    sourceType: text("source_type").notNull(),
    outlet: text("outlet").notNull(),
    sourceUrl: text("source_url").notNull(),
    publishedAt: text("published_at").notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("incident_sources_event_url_unique").on(table.incidentId, table.sourceUrl),
    index("idx_incident_sources_incident_id").on(table.incidentId),
  ],
);

export const incidentUpdates = sqliteTable(
  "incident_updates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id),
    publishedAt: text("published_at").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    verification: text("verification").notNull(),
  },
  (table) => [
    uniqueIndex("incident_updates_unique").on(table.incidentId, table.publishedAt, table.title),
    index("idx_incident_updates_incident_id_published_at").on(table.incidentId, table.publishedAt),
  ],
);

export const incidentMedia = sqliteTable(
  "incident_media",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    incidentId: integer("incident_id")
      .notNull()
      .references(() => incidents.id),
    imageUrl: text("image_url").notNull(),
    sourceUrl: text("source_url").notNull(),
    outlet: text("outlet").notNull(),
    credit: text("credit").notNull(),
    caption: text("caption").notNull(),
    isSensitive: integer("is_sensitive", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("incident_media_event_image_unique").on(table.incidentId, table.imageUrl),
    index("idx_incident_media_incident_id").on(table.incidentId),
  ],
);
