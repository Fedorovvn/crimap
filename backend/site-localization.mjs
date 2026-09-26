import { z } from 'zod';
import { DatabaseSync } from 'node:sqlite';
import { hash } from './store.mjs';

const visibleFields=new Set(['title','summary','category','status','verification','district','locationLabel','location_label','locationPrecision','location_precision','label','note','description','offense','subjectLabel','condition','text','detail','caption','rationale','attribution','sourceLabel','source_type','sourceType','name','credit']);
export function displayStrings(value) {
  const strings=new Set();
  function walk(v,key='') {
    if(typeof v==='string'&&visibleFields.has(key)&&v.trim()&&!/^https?:\/\//.test(v)&&/\p{L}/u.test(v)&&!(['status','verification'].includes(key)&&/^[a-z-]+$/.test(v)))strings.add(v);
    else if(v&&typeof v==='object')for(const [k,item] of Object.entries(v))if(!['evidence','statutes','translations'].includes(k))walk(item,k);
  }
  walk(value);
  // Source attributions are displayed in tooltips; evidence quotes themselves are not translated.
  for(const c of value.context??[])for(const e of c.evidence??[])if(e.attribution)strings.add(e.attribution);
  return [...strings].sort();
}
export function validateSiteTranslation(raw,language,strings) {
  const result=z.object({language:z.literal(language),strings:z.record(z.string().trim().min(1).max(12000))}).strict().parse(raw);
  if(JSON.stringify(Object.keys(strings).sort())!==JSON.stringify(Object.keys(result.strings).sort()))throw new Error('Site translation paths do not match');
  const numbers=s=>(s.match(/\d+(?:[.,]\d+)?/g)??[]).map(n=>n.replace(',','.')).sort().join('|');
  for(const key of Object.keys(strings))if(numbers(strings[key])!==numbers(result.strings[key]))throw new Error(`Site translation changed numbers: ${key}; preserve these numeric tokens exactly: [${numbers(strings[key])}], received [${numbers(result.strings[key])}]. Do not convert digits to words/Roman numerals or change leading zeroes in times.`);
  return result;
}
export async function translateSiteTexts(model,texts,feedback=[]) {
  const strings=Object.fromEntries(texts.map((text,i)=>['s'+i,text])),translations={};
  for(const language of ['en','hu']) {
    const result=await model.json('site-translate',{language,strings,feedback},{maxTokens:8192,validate:raw=>validateSiteTranslation(raw,language,strings)});
    translations[language]=Object.fromEntries(texts.map((text,i)=>[text,result.strings['s'+i]]));
  }
  return translations;
}
export function siteTranslations(store,id,revision) {
  const row=store.db.prepare('SELECT payload FROM site_translations WHERE event_id=? AND revision=?').get(id,revision);
  return row?JSON.parse(row.payload):null;
}
function publicSnapshot(db,id) {
  const event=db.prepare('SELECT * FROM incidents WHERE id=?').get(id);if(!event)throw new Error('Unknown published event');
  for(const [field,table] of Object.entries({participants:'incident_participants',context:'incident_context',legal:'incident_legal'}))event[field]=db.prepare(`SELECT details FROM ${table} WHERE incident_id=? ORDER BY id`).all(id).map(r=>JSON.parse(r.details));
  for(const [field,table] of Object.entries({sources:'incident_sources',updates:'incident_updates',media:'incident_media'}))event[field]=db.prepare(`SELECT * FROM ${table} WHERE incident_id=? ORDER BY id`).all(id);
  return event;
}
// This only adds language versions of already public text. It never publishes a draft.
export async function localizePublished(store,model,path) {
  const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000');const done=[];
  try {
    for(const {id} of db.prepare('SELECT id FROM incidents ORDER BY id').all()) {
      const texts=displayStrings(publicSnapshot(db,id)),fingerprint=hash(texts);
      const existing=db.prepare('SELECT details FROM incident_metadata WHERE incident_id=?').get(id);
      if(existing&&JSON.parse(existing.details).translationHash===fingerprint)continue;
      const translations=await translateSiteTexts(model,texts);
      db.exec('BEGIN IMMEDIATE');try {
        if(hash(displayStrings(publicSnapshot(db,id)))!==fingerprint)throw new Error('Published content changed during translation');
        const current=db.prepare('SELECT details FROM incident_metadata WHERE incident_id=?').get(id);
        db.prepare('INSERT OR REPLACE INTO incident_metadata VALUES(?,?)').run(id,JSON.stringify({...current?JSON.parse(current.details):{},translations,translationHash:fingerprint}));
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      store.log('published-languages',id,{languages:['ru','en','hu'],strings:texts.length});done.push(id);
    }
  }finally{db.close();}
  return {localizedPublicIds:done};
}
