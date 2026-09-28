import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {installEventIndex,indexedCandidates} from './event-index.mjs';
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function jobBudget(kind,payload,event){
  const campaignId=kind==='recheck'||payload.budgetScope==='daily'?null:payload.campaignId??event?.campaign_id??null;
  return {campaignId,budgetScope:campaignId?'archive':'daily'};
}
export class Store {
  constructor(path){
    this.path=path;
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,job_key TEXT NOT NULL,payload TEXT NOT NULL,due_at TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,lease_until TEXT,lease_token TEXT,last_error TEXT,UNIQUE(kind,job_key));
      CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due_at);
      CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY,url TEXT NOT NULL UNIQUE,source_id TEXT NOT NULL,source_kind TEXT NOT NULL,first_seen_at TEXT NOT NULL,latest_hash TEXT,published_at TEXT,checked_at TEXT);
      CREATE TABLE IF NOT EXISTS document_versions(id INTEGER PRIMARY KEY,document_id INTEGER NOT NULL REFERENCES documents(id),content_hash TEXT NOT NULL,text TEXT NOT NULL,title TEXT NOT NULL,language TEXT NOT NULL,image_urls TEXT NOT NULL,fetched_at TEXT NOT NULL,UNIQUE(document_id,content_hash));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,first_seen_at TEXT NOT NULL,occurred_at TEXT,canonical TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',review_reason TEXT,next_check_at TEXT,last_checked_at TEXT,revision INTEGER NOT NULL DEFAULT 1,published_revision INTEGER,public_id INTEGER);
      CREATE TABLE IF NOT EXISTS observations(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL REFERENCES events(id),document_id INTEGER NOT NULL REFERENCES documents(id),content_hash TEXT NOT NULL,extracted TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(event_id,document_id,content_hash));
      CREATE TABLE IF NOT EXISTS ignored_updates(event_id INTEGER NOT NULL REFERENCES events(id),document_id INTEGER NOT NULL REFERENCES documents(id),content_hash TEXT NOT NULL,brief TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(event_id,document_id,content_hash));
      CREATE TABLE IF NOT EXISTS date_checks(event_id INTEGER PRIMARY KEY REFERENCES events(id),revision INTEGER NOT NULL,source_hash TEXT NOT NULL,reason TEXT NOT NULL,checked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_revisions(id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(event_id,revision));
      CREATE TABLE IF NOT EXISTS translations(event_id INTEGER NOT NULL,revision INTEGER NOT NULL,language TEXT NOT NULL,payload TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(event_id,revision,language));
      CREATE TABLE IF NOT EXISTS model_cache(cache_key TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY,request_key TEXT NOT NULL,stage TEXT NOT NULL,model TEXT NOT NULL,state TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,reserved_usd REAL NOT NULL,cost_usd REAL,created_at TEXT NOT NULL,error TEXT);
      CREATE TABLE IF NOT EXISTS model_budget(id INTEGER PRIMARY KEY CHECK(id=1),limit_usd REAL NOT NULL CHECK(limit_usd>0),updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS http_cache(url TEXT PRIMARY KEY,etag TEXT,last_modified TEXT,body TEXT NOT NULL,content_type TEXT NOT NULL,fetched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS search_cache(cache_key TEXT PRIMARY KEY,result TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,subject TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_action_subject ON audit(action,subject,id);
      CREATE INDEX IF NOT EXISTS audit_time ON audit(created_at);
      CREATE TABLE IF NOT EXISTS quality_reviews(event_id INTEGER NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(event_id,revision));
      CREATE TABLE IF NOT EXISTS field_requests(request_key TEXT PRIMARY KEY,event_id INTEGER NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'proposed',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,from_date TEXT NOT NULL,to_date TEXT NOT NULL,budget_usd REAL NOT NULL,state TEXT NOT NULL DEFAULT 'running',created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS triage_log(document_id INTEGER NOT NULL,content_hash TEXT NOT NULL,keep INTEGER NOT NULL,method TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(document_id,content_hash));
      CREATE TABLE IF NOT EXISTS preparation(event_id INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(event_id,revision));
      CREATE TABLE IF NOT EXISTS site_translations(event_id INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(event_id,revision));
      CREATE TABLE IF NOT EXISTS geocode_cache(query_key TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS service_limits(service TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS archive_pages(campaign_id TEXT NOT NULL,source_id TEXT NOT NULL,url TEXT NOT NULL,earliest TEXT,latest TEXT,found INTEGER NOT NULL,filtered INTEGER NOT NULL,scanned_at TEXT NOT NULL,PRIMARY KEY(campaign_id,url));
    `);
    if(!this.db.prepare('PRAGMA table_info(jobs)').all().some(c=>c.name==='rerun'))this.db.exec('ALTER TABLE jobs ADD COLUMN rerun INTEGER NOT NULL DEFAULT 0');
    for(const table of ['events','usage'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='campaign_id'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN campaign_id TEXT`);
    if(!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='auto_repairs'))this.db.exec('ALTER TABLE events ADD COLUMN auto_repairs INTEGER NOT NULL DEFAULT 0');
    for(const column of ['merged_into INTEGER','withdrawn_at TEXT'])if(!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name===column.split(' ')[0]))this.db.exec('ALTER TABLE events ADD COLUMN '+column);
    if(!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name==='editorial_mark'))this.db.exec("ALTER TABLE events ADD COLUMN editorial_mark TEXT NOT NULL DEFAULT 'normal' CHECK(editorial_mark IN ('normal','uninteresting','priority'))");
    for(const column of ["editorial_reasons TEXT NOT NULL DEFAULT '[]'","editorial_note TEXT NOT NULL DEFAULT ''"])if(!this.db.prepare('PRAGMA table_info(events)').all().some(c=>c.name===column.split(' ')[0]))this.db.exec('ALTER TABLE events ADD COLUMN '+column);
    if(!this.db.prepare('PRAGMA table_info(campaigns)').all().some(c=>c.name==='discovery_stopped'))this.db.exec('ALTER TABLE campaigns ADD COLUMN discovery_stopped INTEGER NOT NULL DEFAULT 0');
    this.db.exec("UPDATE jobs SET state='cancelled',rerun=0,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE state IN ('queued','running','paused','failed') AND json_extract(payload,'$.eventId') IN (SELECT id FROM events WHERE editorial_mark='uninteresting'); UPDATE events SET next_check_at=NULL WHERE editorial_mark='uninteresting'");
  }
  candidates(event,options){installEventIndex(this.db);return indexedCandidates(this,event,options);}
  transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  log(action,subject,detail){this.db.prepare('INSERT INTO audit(action,subject,detail,created_at) VALUES(?,?,?,?)').run(action,String(subject??''),JSON.stringify(detail),new Date().toISOString());}
  enqueue(kind,key,payload={},due=new Date().toISOString()){
    const event=payload.eventId?this.event(payload.eventId):null;
    if(event?.editorial_mark==='uninteresting')return false;
    if(event&&!event.canonical.occurredAt&&!['article','resolve-date'].includes(kind))return this.holdForDate(event.id,payload,{refresh:true});
    payload={...payload,...jobBudget(kind,payload,event)};
    if(['archive','article'].includes(kind)&&payload.campaignId&&!payload.eventId&&this.db.prepare('SELECT discovery_stopped FROM campaigns WHERE id=?').get(payload.campaignId)?.discovery_stopped)return false;
    // An explicit retry of completed archive work resumes that same campaign,
    // never the daily allowance. reserveCost still enforces its original cap.
    if(payload.campaignId)this.db.prepare("UPDATE campaigns SET state='running' WHERE id=? AND state IN ('complete','complete-with-errors')").run(payload.campaignId);
    const campaignState=payload.campaignId&&this.db.prepare('SELECT state FROM campaigns WHERE id=?').get(payload.campaignId)?.state;
    const state=['paused','budget-exhausted'].includes(campaignState)?'paused':'queued';
    this.db.prepare(`INSERT INTO jobs(kind,job_key,payload,due_at,state) VALUES(?,?,?,?,?) ON CONFLICT(kind,job_key) DO UPDATE SET payload=excluded.payload,due_at=min(jobs.due_at,excluded.due_at),rerun=CASE WHEN jobs.state='running' THEN 1 ELSE 0 END,state=CASE WHEN jobs.state='running' THEN 'running' ELSE excluded.state END`).run(kind,String(key),JSON.stringify(payload),due,state);
  }
  holdForDate(id,payload={}, {refresh=false}={}){
    const event=this.event(id);if(!event||event.canonical.occurredAt||event.editorial_mark==='uninteresting'||event.merged_into||event.state==='excluded')return false;
    this.db.prepare("UPDATE events SET state='awaiting-date',next_check_at=NULL WHERE id=?").run(id);
    this.db.prepare("UPDATE jobs SET state='waiting-date',rerun=0,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE json_extract(payload,'$.eventId')=? AND kind NOT IN ('article','resolve-date') AND state IN ('queued','running','paused','failed')").run(id);
    const job=this.db.prepare("SELECT state FROM jobs WHERE kind='resolve-date' AND job_key=?").get(String(id));
    if(!job||!['queued','running','paused'].includes(job.state)||(refresh&&job.state!=='running'))this.enqueue('resolve-date',id,{...payload,eventId:id});
    return true;
  }
  claim(now=new Date().toISOString(),kinds=null){
    if(kinds&&(!kinds.length||kinds.some(k=>typeof k!=='string')))throw new Error('Invalid job kind filter');
    const kindFilter=(kinds?' AND kind IN ('+kinds.map(()=>'?').join(',')+')':'')+" AND NOT (kind IN ('archive','article') AND json_extract(payload,'$.eventId') IS NULL AND EXISTS(SELECT 1 FROM campaigns c WHERE c.id=json_extract(jobs.payload,'$.campaignId') AND c.discovery_stopped=1))";
    const token=randomUUID(),lease=new Date(Date.parse(now)+15*60_000).toISOString();
    // Discover cheaply first, then finish prepared cards before paying to extract
    // the next archive article. A campaign should not spend its entire budget on
    // half-finished drafts. Due times still govern retries and rate limits.
    const row=this.db.prepare(`UPDATE jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1,rerun=0 WHERE id=(SELECT id FROM jobs WHERE ((state='queued' AND due_at<=?) OR (state='running' AND lease_until<=?))${kindFilter} AND NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.id=json_extract(jobs.payload,'$.campaignId') AND c.state='paused') AND NOT EXISTS(SELECT 1 FROM events e WHERE e.id=json_extract(jobs.payload,'$.eventId') AND e.editorial_mark='uninteresting') ORDER BY CASE WHEN kind!='recheck' AND EXISTS(SELECT 1 FROM events e WHERE e.id=json_extract(jobs.payload,'$.eventId') AND e.editorial_mark='priority') THEN 0 ELSE 1 END,CASE WHEN json_extract(payload,'$.revisitIgnoredEvent') IS NOT NULL THEN 0 ELSE 1 END,CASE kind WHEN 'publish' THEN 0 WHEN 'archive' THEN 1 WHEN 'feed' THEN 2 WHEN 'gather' THEN 3 WHEN 'repair' THEN 4 WHEN 'prepare' THEN 5 WHEN 'translate' THEN 6 WHEN 'localize' THEN 7 WHEN 'review' THEN 8 ELSE 9 END,due_at,id LIMIT 1) RETURNING *`).get(token,lease,now,now,...(kinds??[]));
    return row?{...row,payload:JSON.parse(row.payload)}:null;
  }
  heartbeat(job){return this.db.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND lease_token=? AND state='running'").run(new Date(Date.now()+15*60_000).toISOString(),job.id,job.lease_token).changes===1;}
  finish(job,next=null,error=null){return this.db.prepare("UPDATE jobs SET state=CASE WHEN rerun=1 THEN 'queued' ELSE ? END,due_at=CASE WHEN rerun=1 THEN min(due_at,?) ELSE coalesce(?,due_at) END,rerun=0,lease_token=NULL,lease_until=NULL,last_error=?,attempts=CASE WHEN ? IS NULL THEN 0 ELSE attempts END WHERE id=? AND lease_token=?").run(next?'queued':'done',new Date().toISOString(),next,error,error,job.id,job.lease_token).changes===1;}
  saveDocument({url,sourceId,sourceKind,text,title,language='hu',imageUrls=[],publishedAt=null},now=new Date().toISOString()){
    return this.transaction(()=>{
      const contentHash=hash({text,title,imageUrls});
      const old=this.db.prepare('SELECT * FROM documents WHERE url=?').get(url);
      this.db.prepare(`INSERT INTO documents(url,source_id,source_kind,first_seen_at,latest_hash,published_at,checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET latest_hash=excluded.latest_hash,published_at=coalesce(excluded.published_at,documents.published_at),checked_at=excluded.checked_at`).run(url,sourceId,sourceKind,now,contentHash,publishedAt,now);
      const doc=this.db.prepare('SELECT * FROM documents WHERE url=?').get(url);
      this.db.prepare('INSERT OR IGNORE INTO document_versions(document_id,content_hash,text,title,language,image_urls,fetched_at) VALUES(?,?,?,?,?,?,?)').run(doc.id,contentHash,text,title,language,JSON.stringify(imageUrls),now);
      return {id:String(doc.id),url,sourceId,sourceKind,text,title,language,imageUrls,publishedAt,contentHash,changed:old?.latest_hash!==contentHash};
    });
  }
  document(id){const row=this.db.prepare('SELECT d.*,v.text,v.title,v.language,v.image_urls FROM documents d JOIN document_versions v ON d.id=v.document_id AND d.latest_hash=v.content_hash WHERE d.id=?').get(id);return row?{id:String(row.id),url:row.url,sourceId:row.source_id,sourceKind:row.source_kind,text:row.text,title:row.title,language:row.language,imageUrls:JSON.parse(row.image_urls),publishedAt:row.published_at,contentHash:row.latest_hash}:null;}
  event(id){const e=this.db.prepare('SELECT * FROM events WHERE id=?').get(id);return e?{...e,canonical:JSON.parse(e.canonical),occurredAt:e.occurred_at,firstSeenAt:e.first_seen_at}:null;}
  reserveCost(stage,model,requestKey,amount,budget,now=new Date().toISOString(),campaignId=null){
    return this.transaction(()=>{
      const total=this.totalBudget();
      if(total){
        if(total.spent+amount>total.limit)throw new Error('Total model budget reached');
      }else if(campaignId){
        const campaign=this.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
        const used=this.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage WHERE campaign_id=?').get(campaignId).n;
        if(!campaign||campaign.state!=='running'||used+amount>campaign.budget_usd)throw new Error('Campaign model budget reached');
      }else{
        const used=this.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) AS n FROM usage WHERE campaign_id IS NULL AND created_at>=?').get(now.slice(0,10)+'T00:00:00.000Z').n;
        if(used+amount>budget)throw new Error('Daily model budget reached');
      }
      return Number(this.db.prepare("INSERT INTO usage(request_key,stage,model,state,reserved_usd,created_at,campaign_id) VALUES(?,?,?,'reserved',?,?,?)").run(requestKey,stage,model,amount,now,campaignId).lastInsertRowid);
    });
  }
  totalBudget(){
    const row=this.db.prepare('SELECT limit_usd FROM model_budget WHERE id=1').get();if(!row)return null;
    const spent=this.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage').get().n;
    return {limit:row.limit_usd,spent,remaining:Math.max(0,row.limit_usd-spent)};
  }
  usageDone(id,input,output,cost){this.db.prepare("UPDATE usage SET state='complete',input_tokens=?,output_tokens=?,cost_usd=? WHERE id=?").run(input,output,cost,id);}
  usageFailed(id,message){this.db.prepare("UPDATE usage SET state='failed',error=? WHERE id=?").run(message,id);}
  close(){this.db.close();}
}
