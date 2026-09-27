import {matchCandidates} from './dedup.mjs';

// An ordinary SQLite index: no embedding API, no model calls, no external service.
// Index event facts, not whole articles, which often mention unrelated old cases.
export function installEventIndex(db){
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='event_search'").get())return;
  db.exec('BEGIN IMMEDIATE');
  // Another worker may have completed the first migration while we waited.
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='event_search'").get()){db.exec('COMMIT');return;}
  const projection=prefix=>`coalesce(json_extract(${prefix}canonical,'$.title'),'') || ' ' || coalesce(json_extract(${prefix}canonical,'$.summary'),'') || ' ' || coalesce(json_extract(${prefix}canonical,'$.location.label'),'') || ' ' || coalesce(json_extract(${prefix}canonical,'$.caseReferences'),'') || ' ' || coalesce(json_extract(${prefix}canonical,'$.participants'),'')`;
  try{db.exec(`
    CREATE VIRTUAL TABLE event_search USING fts5(facts,tokenize='porter unicode61 remove_diacritics 2');
    INSERT INTO event_search(rowid,facts) SELECT id,${projection('')} FROM events;
    CREATE TRIGGER event_search_insert AFTER INSERT ON events BEGIN
      INSERT INTO event_search(rowid,facts) VALUES(new.id,${projection('new.')}); END;
    CREATE TRIGGER event_search_update AFTER UPDATE OF canonical ON events BEGIN
      DELETE FROM event_search WHERE rowid=old.id;
      INSERT INTO event_search(rowid,facts) VALUES(new.id,${projection('new.')}); END;
    CREATE TRIGGER event_search_delete AFTER DELETE ON events BEGIN
      DELETE FROM event_search WHERE rowid=old.id; END;
    COMMIT;`);}catch(e){db.exec('ROLLBACK');throw e;}
}

const stop=new Set('a an the and or of in on at to by for from with as is was were has have had been after before into near between during this that man woman person people police budapest hungary hungarian district kerulet street utca korut megallo years year old died death killed injured incident reported said'.split(' '));
const words=text=>[...new Set(String(text??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[])].filter(w=>w.length>=3&&!stop.has(w));
const searchable=e=>[e.location?.label,e.title,e.summary,...(e.caseReferences??[]),...(e.participants??[]).map(p=>p.profile?.name)].join(' ');
export function indexedCandidates(store,event,{excludeId,limit=12}={}){
  const rows=store.db.prepare("SELECT id FROM events WHERE merged_into IS NULL AND state!='excluded'").all().filter(r=>r.id!==excludeId).map(r=>store.event(r.id));
  const direct=matchCandidates(event,rows);
  const tokens=words(searchable(event)).slice(0,48);
  if(!tokens.length)return direct;
  // Parameterized, quoted words only: source content cannot inject FTS syntax.
  const query=tokens.map(t=>'"'+t+'"').join(' OR ');
  const hits=store.db.prepare(`SELECT e.id,bm25(event_search) rank FROM event_search JOIN events e ON e.id=event_search.rowid
    WHERE event_search MATCH ? AND e.merged_into IS NULL AND e.state!='excluded' AND e.id!=?
    ORDER BY rank LIMIT 40`).all(query,excludeId??-1);
  const selected=hits.map(hit=>rows.find(r=>r.id===hit.id)).filter(row=>{
    const old=row.canonical,other=new Set(words(searchable(old)));
    const overlap=tokens.filter(w=>other.has(w)).length;
    const near=Math.abs(Date.parse(event.occurredAt)-Date.parse(old.occurredAt))<=3*86400000;
    // Dates/categories/administrative districts are hints, never hard exclusions.
    // Wider search rescues missing or incorrectly inferred years and addresses.
    return overlap>=(near?2:3);
  });
  return [...new Map([...direct,...selected.slice(0,limit)].map(r=>[r.id,r])).values()];
}
