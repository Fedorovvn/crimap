import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { eventSchema } from './contract.mjs';
import { isPublishableContext } from '../app/context-model.ts';
import { isPublishableLegal } from '../app/legal-model.ts';
import { siteTranslations, displayStrings } from './site-localization.mjs';
export const typeLabels={'traffic-accident':'ДТП',assault:'Нападение',fight:'Драка',robbery:'Ограбление',accident:'Несчастный случай',fire:'Пожар',rescue:'Спасательная операция','missing-person':'Пропавший человек','transport-disruption':'Транспорт',weather:'Непогода',other:'Происшествие'};
const statuses={reported:'Сообщается о происшествии',investigating:'В расследовании','suspects-detained':'Подозреваемые задержаны',wanted:'Подозреваемый разыскивается',resolved:'Ситуация разрешена',closed:'Дело закрыто',unknown:'Статус уточняется'};
export function migratePublic(path){
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS collector_migrations(name TEXT PRIMARY KEY)');
  try{for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
    if(db.prepare('SELECT name FROM collector_migrations WHERE name=?').get(name))continue;
    // Existing application migrations are already applied on the deployed database.
    const tableByMigration={'0000_lyrical_vargas.sql':'incidents','0001_redundant_the_phantom.sql':'incident_media','0002_incident_participants.sql':'incident_participants','0003_incident_context.sql':'incident_context','0004_incident_legal.sql':'incident_legal'};
    const exists=tableByMigration[name]&&db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableByMigration[name]);
    db.exec('BEGIN IMMEDIATE');try{if(!exists)db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO collector_migrations VALUES(?)').run(name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }}finally{db.close();}
}
export function publish(store,eventId,path,{includeContext=false,includeLegal=false,reviewer}={}){
  if(!reviewer?.trim())throw new Error('A named reviewer is required for publication');
  const row=store.event(eventId);if(!row)throw new Error('Unknown event');
  if(row.merged_into||row.state==='excluded')throw new Error('Event is merged or excluded');
  const review=store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(eventId,row.revision);
  if(!review||JSON.parse(review.payload).verdict!=='pass')throw new Error('Current revision needs a passing quality review');
  const translation=store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(eventId,row.revision);
  if(!translation)throw new Error('Current Russian translation is missing');
  const event=eventSchema.parse(JSON.parse(translation.payload));
  const prepared=store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(eventId,row.revision);
  const preparation=prepared?JSON.parse(prepared.payload):null;
  const languages=siteTranslations(store,eventId,row.revision);
  if(preparation&&!languages)throw new Error('Current English and Hungarian display translations are missing');
  if(!event.occurredAt)throw new Error('Resolve occurrence date before publishing');
  if(event.location.latitude===undefined)throw new Error('Add verified map coordinates before publishing');
  const documents=store.db.prepare('SELECT DISTINCT d.* FROM observations o JOIN documents d ON d.id=o.document_id WHERE o.event_id=?').all(eventId);
  if(!documents.length)throw new Error('No source documents');
  const verification=documents.every(d=>d.source_kind==='official')?'Официальный источник':documents.some(d=>d.source_kind==='official')?'Официальные данные и сообщения СМИ':'По сообщениям СМИ';
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try{
    db.prepare(`INSERT INTO incidents(slug,title,category,status,verification,district,location_label,location_precision,latitude,longitude,occurred_at,summary,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,category=excluded.category,status=excluded.status,verification=excluded.verification,district=excluded.district,location_label=excluded.location_label,location_precision=excluded.location_precision,latitude=excluded.latitude,longitude=excluded.longitude,occurred_at=excluded.occurred_at,summary=excluded.summary,updated_at=excluded.updated_at`).run(row.slug,event.title,typeLabels[event.type],statuses[event.status],verification,event.location.district??'Будапешт',event.location.label,{exact:'Точное место',street:'Улица; точное место не раскрыто',landmark:'Приблизительно: у указанного ориентира',district:'Приблизительно: район',city:'Приблизительно: город',unknown:'Место уточняется'}[event.location.precision],event.location.latitude,event.location.longitude,event.occurredAt,event.summary,new Date().toISOString());
    const id=Number(db.prepare('SELECT id FROM incidents WHERE slug=?').get(row.slug).id);
    for(const table of ['incident_sources','incident_updates','incident_media','incident_participants','incident_context','incident_legal'])db.prepare(`DELETE FROM ${table} WHERE incident_id=?`).run(id);
    for(const d of documents)db.prepare('INSERT INTO incident_sources(incident_id,source_type,outlet,source_url,published_at,note) VALUES(?,?,?,?,?,?)').run(id,d.source_kind==='official'?'Официально':'Неофициально',new URL(d.url).hostname,d.url,d.published_at??d.first_seen_at,d.published_at?'':'Дата первой загрузки; время публикации не указано');
    for(const u of event.updates)db.prepare('INSERT INTO incident_updates(incident_id,published_at,title,detail,verification) VALUES(?,?,?,?,?)').run(id,u.publishedAt,u.title,u.detail,documents.find(d=>d.url===u.sourceUrl)?.source_kind==='official'?'Официальный источник':'По сообщению СМИ');
    const media=event.media.filter(m=>preparation?m.rights!=='link-only':['licensed','permission','public-domain'].includes(m.rights));
    for(const m of [...media,...(preparation?.retainedMedia??[])])db.prepare('INSERT INTO incident_media(incident_id,image_url,source_url,outlet,credit,caption,is_sensitive) VALUES(?,?,?,?,?,?,?)').run(id,m.imageUrl,m.sourceUrl,m.outlet,m.credit,m.caption,Number(m.isSensitive));
    for(const p of event.participants)db.prepare('INSERT INTO incident_participants(incident_id,participant_key,details) VALUES(?,?,?)').run(id,p.key,JSON.stringify(p));
    for(const c of event.context){if(includeContext)c.reviewStatus='approved';if(isPublishableContext(c))db.prepare('INSERT INTO incident_context(incident_id,claim_key,details) VALUES(?,?,?)').run(id,c.key,JSON.stringify(c));}
    for(const l of event.legal){if(includeLegal)l.reviewStatus='approved';if(isPublishableLegal(l))db.prepare('INSERT INTO incident_legal(incident_id,assessment_key,details) VALUES(?,?,?)').run(id,l.key,JSON.stringify(l));}
    // Do not expose translations of context or legal text excluded from publication.
    const publicTexts=new Set(displayStrings({...event,context:event.context.filter(isPublishableContext),legal:event.legal.filter(isPublishableLegal),media,retainedMedia:preparation?.retainedMedia}));
    const translations=languages?Object.fromEntries(Object.entries(languages).map(([language,strings])=>[language,Object.fromEntries(Object.entries(strings).filter(([text])=>publicTexts.has(text)))])):undefined;
    db.prepare('INSERT OR REPLACE INTO incident_metadata VALUES(?,?)').run(id,JSON.stringify({eventType:event.type,signals:event.signals,contractVersion:'2.0',revision:row.revision,timePrecision:event.timePrecision,translations}));
    db.exec('COMMIT');
    const record=()=>{store.db.prepare("UPDATE events SET state='published',published_revision=?,public_id=?,withdrawn_at=NULL WHERE id=?").run(row.revision,id,eventId);store.log('published',eventId,{revision:row.revision,publicId:id,reviewer,includeContext,includeLegal});};
    if(store.db.isTransaction)record();else store.transaction(record);return id;
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
