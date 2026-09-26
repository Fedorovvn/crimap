import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { starterParticipants } from "./starter-participants";
import { starterContext } from "./starter-context";
import { isPublishableContext } from "../app/context-model";
import { isPublishableLegal } from "../app/legal-model";
import { starterLegal } from "./starter-legal";

export async function getIncidentLegal(incidentId: number) {
  const result = await getRawDb().prepare("SELECT details FROM incident_legal WHERE incident_id = ? ORDER BY id").bind(incidentId).all<{ details: string }>();
  return result.results.map((row) => JSON.parse(row.details) as unknown).filter(isPublishableLegal);
}

export async function getIncidentContext(incidentId: number) {
  const result = await getRawDb().prepare("SELECT details FROM incident_context WHERE incident_id = ? ORDER BY id").bind(incidentId).all<{ details: string }>();
  return result.results.map((row) => JSON.parse(row.details) as import("../app/context-model").ContextClaim).filter(isPublishableContext);
}

export async function getIncidentParticipants(incidentId: number) {
  const result = await getRawDb().prepare("SELECT details FROM incident_participants WHERE incident_id = ? ORDER BY id").bind(incidentId).all<{ details: string }>();
  return result.results.map((row) => JSON.parse(row.details) as import("../app/participants-model").Participant);
}

function getRawDb() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }

  return env.DB;
}

export function getDb() {
  return drizzle(getRawDb(), { schema });
}

/** Adds the two verified starter records once, after the schema migration exists. */
export async function ensureStarterIncidents() {
  const rawDb = getRawDb();
  const existing = await rawDb
    .prepare("SELECT id FROM incidents WHERE slug = ? LIMIT 1")
    .bind("soroksari-fatal-crash")
    .first();

  if (!existing) {
    await rawDb.batch([
    rawDb
      .prepare(
        "INSERT INTO incidents (slug, title, category, status, verification, district, location_label, location_precision, latitude, longitude, occurred_at, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "soroksari-fatal-crash",
        "Смертельное столкновение на Soroksári út",
        "ДТП",
        "В расследовании",
        "Официальный источник",
        "IX · Ferencváros",
        "Soroksári út 160",
        "Точный адрес из сообщения полиции",
        47.4639,
        19.0808,
        "2026-09-03T05:55:00+02:00",
        "По данным BRFK, Mitsubishi выехал на встречную полосу и столкнулся с Ford. Водитель Ford, 62-летний мужчина, погиб на месте; пассажира госпитализировали с тяжёлыми травмами. Полиция расследует подозрение в управлении автомобилем в состоянии опьянения.",
        "2026-09-04T11:50:00+02:00",
      ),
    rawDb
      .prepare(
        "INSERT INTO incidents (slug, title, category, status, verification, district, location_label, location_precision, latitude, longitude, occurred_at, summary, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "akacfa-homicide",
        "Убийство на Akácfa utca",
        "Насильственное преступление",
        "Подозреваемые задержаны",
        "Официальный источник",
        "VII · Erzsébetváros",
        "Akácfa utca",
        "Улица; точный номер не раскрыт",
        47.4992,
        19.0664,
        "2026-09-18T01:40:00+02:00",
        "По данным BRFK, 36-летнего мужчину избили на Akácfa utca; он умер на месте, несмотря на помощь медиков. Позже полиция сообщила о задержании двух подозреваемых. Расследование продолжается.",
        "2026-09-21T09:52:00+02:00",
      ),
    ]);
  }

  const found = await rawDb
    .prepare("SELECT id, slug FROM incidents WHERE slug IN (?, ?)")
    .bind("soroksari-fatal-crash", "akacfa-homicide")
    .all<{ id: number; slug: string }>();
  const incidentIds = Object.fromEntries(
    (found.results ?? []).map((incident) => [incident.slug, incident.id]),
  );

  await rawDb.batch(Object.entries(starterLegal).flatMap(([slug, assessments]) => assessments.map((entry) => rawDb.prepare(
    "INSERT OR IGNORE INTO incident_legal (incident_id, assessment_key, details) VALUES (?, ?, ?)",
  ).bind(incidentIds[slug], entry.key, JSON.stringify(entry)))));

  await rawDb.batch(Object.entries(starterContext).flatMap(([slug, claims]) => claims.map((claim) => rawDb.prepare(
    "INSERT OR IGNORE INTO incident_context (incident_id, claim_key, details) VALUES (?, ?, ?)",
  ).bind(incidentIds[slug], claim.key, JSON.stringify(claim)))));

  await rawDb.batch(Object.entries(starterParticipants).flatMap(([slug, participants]) =>
    participants.map((participant) => rawDb.prepare(
      "INSERT OR IGNORE INTO incident_participants (incident_id, participant_key, details) VALUES (?, ?, ?)",
    ).bind(incidentIds[slug], participant.key, JSON.stringify(participant))),
  ));

  await rawDb.batch([
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_sources (incident_id, source_type, outlet, source_url, published_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["soroksari-fatal-crash"], "Официально", "BRFK / police.hu", "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/orizetben-a-soroksari-uti-halalos", "2026-09-04T11:50:00+02:00", "Сообщение о ходе расследования и задержании водителя."),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_sources (incident_id, source_type, outlet, source_url, published_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "Официально", "BRFK / police.hu", "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/emberoles-erzsebetvarosban-1", "2026-09-18T09:12:00+02:00", "Первое официальное сообщение."),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_sources (incident_id, source_type, outlet, source_url, published_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "Официально", "BRFK / police.hu", "https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/bunugyek/emberoles-erzsebetvarosban-a-nyomozok-mindket", "2026-09-21T09:52:00+02:00", "Обновление о задержании двух подозреваемых."),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_sources (incident_id, source_type, outlet, source_url, published_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["soroksari-fatal-crash"], "Неофициально", "24.hu", "https://24.hu/belfold/2026/09/04/soroksari-ut-frontalis-baleset-vallomas/", "2026-09-04T12:31:00+02:00", "Фото с места ДТП; 24.hu указывает police.hu как источник снимка."),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_sources (incident_id, source_type, outlet, source_url, published_at, note) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "Неофициально", "Index.hu / MTI", "https://index.hu/belfold/2026/09/18/budapest-gyilkossag-bokszolo-tamadok-azonositas-rendorseg/", "2026-09-18T12:00:00+02:00", "Фото следственных действий на Akácfa utca; Mihádák Zoltán / MTI."),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_updates (incident_id, published_at, title, detail, verification) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["soroksari-fatal-crash"], "2026-09-03T05:55:00+02:00", "Два автомобиля столкнулись на Soroksári út", "Ford после столкновения вылетел к обочине; водитель погиб, пассажир получил тяжёлые травмы.", "Официальный источник"),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_updates (incident_id, published_at, title, detail, verification) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["soroksari-fatal-crash"], "2026-09-04T11:50:00+02:00", "Водитель задержан", "BRFK сообщила о подозрении в управлении автомобилем в состоянии опьянения; расследование продолжается.", "Официальный источник"),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_updates (incident_id, published_at, title, detail, verification) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "2026-09-18T09:12:00+02:00", "На Akácfa utca погиб мужчина", "Полиция начала расследование по подозрению в убийстве.", "Официальный источник"),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_updates (incident_id, published_at, title, detail, verification) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "2026-09-21T09:52:00+02:00", "Двое подозреваемых задержаны", "BRFK сообщила, что двоих мужчин задержали, допросили как подозреваемых и ходатайствовали об их заключении под стражу.", "Официальный источник"),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_media (incident_id, image_url, source_url, outlet, credit, caption, is_sensitive) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["soroksari-fatal-crash"], "https://s.24.hu/app/uploads/2026/09/57a508b5-6aa8-452a-9c83-de1bd555dc2b-1-e1788517489423-1024x562.jpg", "https://24.hu/belfold/2026/09/04/soroksari-ut-frontalis-baleset-vallomas/", "24.hu", "police.hu via 24.hu", "Разбитый Ford на месте столкновения на Soroksári út.", 1),
    rawDb
      .prepare(
        "INSERT OR IGNORE INTO incident_media (incident_id, image_url, source_url, outlet, credit, caption, is_sensitive) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(incidentIds["akacfa-homicide"], "https://kep.cdn.index.hu/1/0/7161/71616/716163/71616355_5280089_17953875d8d6b7716988fbf1c14f3f84_wm.jpg", "https://index.hu/belfold/2026/09/18/budapest-gyilkossag-bokszolo-tamadok-azonositas-rendorseg/", "Index.hu", "Mihádák Zoltán / MTI", "Следователи на Akácfa utca; часть места происшествия закрыта экраном.", 1),
  ]);
}
