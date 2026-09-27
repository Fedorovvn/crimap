import { eventSchema, applyTranslation, translationStrings, validateEvidence } from './contract.mjs';
import { hash } from './store.mjs';
import { siteTranslations } from './site-localization.mjs';
import { readPublication, comparisonFor } from './publication-comparison.mjs';
import {eventProcessing} from './activity.mjs';

export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function documentsFor(store, id) {
  return store.db.prepare(`SELECT DISTINCT d.id,d.url,d.source_kind,d.published_at,d.first_seen_at,v.title,v.text,v.language,v.image_urls,v.fetched_at
    FROM observations o JOIN documents d ON d.id=o.document_id
    JOIN document_versions v ON v.document_id=o.document_id AND v.content_hash=o.content_hash
    WHERE o.event_id=? ORDER BY v.fetched_at DESC`).all(id).map(d => ({
      ...d, id:String(d.id), sourceKind:d.source_kind, imageUrls:JSON.parse(d.image_urls),
    }));
}
export function currentPublic(path, slug) {
  return readPublication(path,slug);
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
  const languages=siteTranslations(store,id,row.revision);
  const published=currentPublic(publicPath,row.slug),comparison=comparisonFor(published,russian,documents,preparation,languages);
  if(comparison)comparison.reviewed=quality?.payload.publicationBaseline===published.fingerprint;
  const blockers = [];
  if(row.merged_into)blockers.push(`Объединено с событием №${row.merged_into}`);
  if(row.state==='excluded')blockers.push('Событие исключено из текущей тематики');
  if (!russian) blockers.push('Нет русского перевода текущей версии');
  if (quality?.payload.verdict !== 'pass') blockers.push('Нужна успешная проверка Pro текущей версии');
  if (!row.canonical.occurredAt) blockers.push('Нужно уточнить дату события');
  if (row.canonical.location.latitude === undefined) blockers.push('Нужно указать проверенные координаты');
  if (!documents.length) blockers.push('Нет сохранённых источников');
  if(preparation&&!languages)blockers.push('Готовятся английская и венгерская версии');
  if(published&&row.published_revision!==row.revision&&!comparison.reviewed)blockers.push('Pro ещё не сравнила обновление с текущей публикацией');
  return { ...row, processing:eventProcessing(store,row), russian, strings:russian ? translationStrings(russian) : null, quality, documents, blockers, preparation,comparison,
    dateCheck:store.db.prepare('SELECT reason,checked_at FROM date_checks WHERE event_id=?').get(id)??null,
    ignoredUpdates:store.db.prepare('SELECT d.url,v.title,i.reason,i.created_at FROM ignored_updates i JOIN documents d ON d.id=i.document_id JOIN document_versions v ON v.document_id=d.id AND v.content_hash=i.content_hash WHERE i.event_id=? ORDER BY i.created_at DESC LIMIT 30').all(id),
    approvalToken:hash({revision:row.revision,ru:ru?.payload,review:review?.payload,preparation:prepared?.payload,languages,publication:published?.fingerprint??null}),
    published,
    jobs:store.db.prepare("SELECT kind,state,last_error,due_at FROM jobs WHERE state NOT IN ('done','cancelled','waiting-date') AND json_extract(payload,'$.eventId')=?").all(id),
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
