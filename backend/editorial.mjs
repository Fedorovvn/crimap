import { DatabaseSync } from 'node:sqlite';
import { eventSchema, applyTranslation, translationStrings, validateEvidence } from './contract.mjs';
import { hash } from './store.mjs';

export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function documentsFor(store, id) {
  return store.db.prepare(`SELECT DISTINCT d.id,d.url,d.source_kind,v.title,v.text,v.language,v.image_urls,v.fetched_at
    FROM observations o JOIN documents d ON d.id=o.document_id
    JOIN document_versions v ON v.document_id=o.document_id AND v.content_hash=o.content_hash
    WHERE o.event_id=? ORDER BY v.fetched_at DESC`).all(id).map(d => ({
      ...d, id:String(d.id), sourceKind:d.source_kind, imageUrls:JSON.parse(d.image_urls),
    }));
}
export function currentPublic(path, slug) {
  if (!path) return null;
  const db = new DatabaseSync(path, { readOnly:true });
  try {
    const event = db.prepare('SELECT * FROM incidents WHERE slug=?').get(slug);
    if (!event) return null;
    const counts = {};
    for (const kind of ['sources','updates','media','participants','context','legal']) {
      counts[kind] = db.prepare(`SELECT count(*) n FROM incident_${kind} WHERE incident_id=?`).get(event.id).n;
    }
    return { ...event, counts };
  } finally { db.close(); }
}
export function eventDetail(store, id, publicPath) {
  const row = store.event(id); if (!row) fail(404, 'Событие не найдено');
  const ru = store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,row.revision);
  const review = store.db.prepare('SELECT * FROM quality_reviews WHERE event_id=? AND revision=?').get(id,row.revision);
  const russian = ru ? JSON.parse(ru.payload) : null;
  const quality = review ? {...review,payload:JSON.parse(review.payload)} : null;
  const documents = documentsFor(store,id);
  const prepared=store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(id,row.revision);
  const preparation=prepared?JSON.parse(prepared.payload):null;
  const blockers = [];
  if (!russian) blockers.push('Нет русского перевода текущей версии');
  if (quality?.payload.verdict !== 'pass') blockers.push('Нужна успешная проверка Pro текущей версии');
  if (!row.canonical.occurredAt) blockers.push('Нужно уточнить дату события');
  if (row.canonical.location.latitude === undefined) blockers.push('Нужно указать проверенные координаты');
  if (!documents.length) blockers.push('Нет сохранённых источников');
  return { ...row, russian, strings:russian ? translationStrings(russian) : null, quality, documents, blockers, preparation,
    approvalToken:hash({revision:row.revision,ru:ru?.payload,review:review?.payload,preparation:prepared?.payload}),
    published:currentPublic(publicPath,row.slug),
    jobs:store.db.prepare("SELECT kind,state,last_error,due_at FROM jobs WHERE state!='done' AND json_extract(payload,'$.eventId')=?").all(id),
  };
}
export function reviseEvent(store, id, {revision,canonical,strings}, reviewer) {
  return store.transaction(() => {
    const old = store.event(id); if (!old) fail(404,'Событие не найдено');
    if (old.revision !== revision) fail(409,'Событие уже изменилось. Обновите страницу и повторите правку.');
    let event, translated;
    try {
      event = validateEvidence(eventSchema.parse(canonical),documentsFor(store,id));
      translated = strings ? applyTranslation(event,{language:'ru',strings}) : null;
    } catch(e) { fail(422,'Проверьте заполнение и подтверждение полей: '+e.message); }
    const next = revision+1, now = new Date().toISOString();
    store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',review_reason='Editorial revision' WHERE id=?").run(JSON.stringify(event),event.occurredAt,next,id);
    store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,next,JSON.stringify(event),'editorial: '+reviewer,now);
    // All edited versions return through automatic address/photo preparation before final review.
    if (translated) {
      store.db.prepare('INSERT INTO translations VALUES(?,?,?,?,?,?)').run(id,next,'ru',JSON.stringify(translated),'editorial',now);
      // Cancel a queued automatic translation so it cannot overwrite the editor's Russian text.
      // An in-flight old revision stays isolated from this new revision.
      store.db.prepare("UPDATE jobs SET state='done' WHERE kind='translate' AND job_key=? AND state='queued'").run(String(id));
    }
    store.enqueue('prepare',id,{eventId:id,campaignId:old.campaign_id});
    store.log('editorial-revision',id,{revision:next,reviewer});
    return {revision:next};
  });
}
