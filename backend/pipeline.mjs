import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { readFileSync,existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { eventSchema, extractionSchema, validateEvidence, translationStrings, applyTranslation } from './contract.mjs';
import { hash } from './store.mjs';
import { nextCheck, intervalFor, retryDelay } from './scheduler.mjs';
import { feeds, sourceFor, parseFeed, parseArticle } from './sources.mjs';
import { canonicalUrl } from './network.mjs';
import { isDeepStrictEqual } from 'node:util';
import { checkReview,recordRequests } from './review.mjs';
import { cheapDecision } from './triage.mjs';
import { displayStrings, translateSiteTexts, siteTranslations } from './site-localization.mjs';

const iso=()=>new Date().toISOString();
const normalized=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function matchCandidates(event,rows){
  return rows.filter(row=>{
    const old=row.canonical;
    if(event.caseReferences.some(r=>old.caseReferences.includes(r)))return true;
    if(!event.occurredAt||!old.occurredAt||event.type!==old.type)return false;
    const street=normalized(event.location.label),oldStreet=normalized(old.location.label);
    return street.length>5&&street===oldStreet&&Math.abs(Date.parse(event.occurredAt)-Date.parse(old.occurredAt))<86400000;
  });
}
export class Pipeline {
  constructor(store,{reader,model,reviewer,search,triage,preparation,archive,publicPath=process.env.DATABASE_PATH,sourceIds=(process.env.COLLECTOR_SOURCES??'police-brfk,okf-events,kekvillogo').split(','),maxItems=Number(process.env.FEED_MAX_ITEMS??5)}={}){
    this.store=store;this.reader=reader;this.model=model;this.reviewer=reviewer;this.search=search;this.sourceIds=sourceIds;this.maxItems=maxItems;
    this.laws=JSON.parse(readFileSync(new URL('./verified-laws.json',import.meta.url),'utf8'));
    this.publicPath=publicPath;
    this.triage=triage;this.preparation=preparation;this.archive=archive;this.campaignId=null;
    this.schema=zodToJsonSchema(extractionSchema,{name:'Extraction'});
  }
  publishedSources(){
    if(!this.publicPath||!existsSync(this.publicPath))return [];
    const db=new DatabaseSync(this.publicPath,{readOnly:true});try{return db.prepare('SELECT i.id,i.slug,i.occurred_at,i.location_label,s.source_url,s.source_type,s.published_at FROM incidents i JOIN incident_sources s ON s.incident_id=i.id').all();}finally{db.close();}
  }
  seed(){
    for(const source of this.publishedSources().filter(s=>s.source_type==='Официально'))if(!this.store.db.prepare("SELECT id FROM jobs WHERE kind='article' AND job_key=?").get(source.source_url))this.store.enqueue('article',source.source_url,{url:source.source_url,publishedAt:source.published_at});
    for(const feed of feeds(this.sourceIds))if(!this.store.db.prepare('SELECT id FROM jobs WHERE kind=? AND job_key=?').get('feed',feed.url))this.store.enqueue('feed',feed.url,feed);
    if(this.preparation)for(const e of this.store.db.prepare("SELECT id,revision,campaign_id FROM events WHERE state='draft'").all())if(!this.store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(e.id,e.revision))this.store.enqueue('prepare',e.id,{eventId:e.id,campaignId:e.campaign_id});
    if(this.preparation)for(const e of this.store.db.prepare("SELECT e.id,e.revision,e.campaign_id FROM events e JOIN translations t ON t.event_id=e.id AND t.revision=e.revision AND t.language='ru' WHERE e.state='draft'").all())if(!siteTranslations(this.store,e.id,e.revision))this.store.enqueue('localize',e.id,{eventId:e.id,campaignId:e.campaign_id});
  }
  async readDocument(url,publishedAt=null){
    const source=sourceFor(url);if(!source)throw new Error('Unregistered source');
    const page=await this.reader.read(url),finalSource=sourceFor(page.url);if(!finalSource)throw new Error('Redirect to unregistered source');
    return this.store.saveDocument({url:canonicalUrl(page.url),sourceId:finalSource.id,sourceKind:finalSource.kind,...parseArticle(page),...(publishedAt?{publishedAt}: {})});
  }
  eventDocuments(id){
    const rows=this.store.db.prepare('SELECT DISTINCT d.*,v.text,v.title,v.language,v.image_urls,v.content_hash FROM observations o JOIN documents d ON d.id=o.document_id JOIN document_versions v ON v.document_id=o.document_id AND v.content_hash=o.content_hash WHERE o.event_id=?').all(id);
    return rows.map(r=>({id:String(r.id),url:r.url,sourceId:r.source_id,sourceKind:r.source_kind,text:r.text,title:r.title,language:r.language,imageUrls:JSON.parse(r.image_urls),publishedAt:r.published_at,contentHash:r.content_hash}));
  }
  validate(event,documents){
    event=validateEvidence(eventSchema.parse(event),documents);
    const huWords=event.summary.toLowerCase().split(/[^\p{L}]+/u).filter(w=>['és','hogy','éves','férfi','férfit','sértett','sértettet','elkövető','szerint','bűntett','mindkét','nyomozók','ellenére','helyszínen'].includes(w));
    if(huWords.length>=3)throw new Error('Canonical title, summary, labels, notes and update text MUST be written in ENGLISH, not copied in Hungarian. Only evidence quotes and proper names stay Hungarian.');
    if(normalized(event.location.city)!=='budapest')throw new Error('Outside Budapest scope');
    if(event.occurredAt&&Date.parse(event.occurredAt)>Date.now())throw new Error('Occurrence is in the future');
    for(const law of event.legal)if(!this.laws.some(l=>isDeepStrictEqual(l.statutes,law.statutes)&&isDeepStrictEqual(l.penalties,law.penalties)))throw new Error('Unverified legal mapping: copy statutes and penalties exactly from verifiedLawCatalog, or return legal=[]');
    for(const image of event.media){if(!documents.some(d=>d.url===image.sourceUrl&&d.imageUrls.includes(image.imageUrl)))throw new Error('Image not present in source');image.rights='unknown';}
    return event;
  }
  async ingest(url,publishedAt=null){
    const doc=await this.readDocument(url,publishedAt);
    const processed=this.store.db.prepare("SELECT id FROM audit WHERE action='document-processed' AND subject=? LIMIT 1").get(`${doc.id}:${doc.contentHash}`);
    if(processed)return {unchanged:true,documentId:doc.id};
    if(this.triage){
      const result=await this.triage.check(doc);
      this.store.db.prepare('INSERT OR REPLACE INTO triage_log VALUES(?,?,?,?,?,?)').run(doc.id,doc.contentHash,Number(result.keep),result.method,result.reason,iso());
      if(!result.keep){this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:0,irrelevantReason:result.reason,filtered:true});return {documentId:doc.id,events:0,filtered:true};}
    }
    const input={schema:this.schema,documents:[doc],firstSeenAt:iso(),verifiedLawCatalog:this.laws};
    const options={validate:raw=>{const parsed=extractionSchema.parse(raw);parsed.events=parsed.events.map(e=>this.validate(e,[doc]));checkReview({verdict:'pass',summary:'Extraction suggestions',issues:[],requests:parsed.requests},[doc]);return parsed;}};
    const result=await this.model.json('extract',input,options),extractionModel=this.model.model;
    // Validate every result before any event mutation: malformed multi-event responses are atomic failures.
    const events=result.events.map(event=>this.validate(event,[doc]));
    let firstId;
    for(const event of events){const id=await this.upsert(event,doc);firstId??=id;}
    if(firstId&&result.requests?.length)recordRequests(this.store,result.requests,{eventId:firstId,revision:this.store.event(firstId).revision,model:extractionModel});
    this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:events.length,irrelevantReason:result.irrelevantReason});
    return {documentId:doc.id,events:events.length};
  }
  async upsert(incoming,doc){
    const rows=this.store.db.prepare('SELECT id FROM events').all().map(r=>this.store.event(r.id));
    const street=normalized(incoming.location.label.split(',')[0]);
    const publishedMatches=this.publishedSources().filter(p=>p.source_url===doc.url&&incoming.occurredAt&&Math.abs(Date.parse(p.occurred_at)-Date.parse(incoming.occurredAt))<86400000&&street===normalized(p.location_label.split(',')[0]));
    let published=publishedMatches.length===1?publishedMatches[0]:null;
    const linked=published?rows.filter(r=>r.public_id===published.id):[];
    const candidates=linked.length?linked:matchCandidates(incoming,rows);
    // Same article may cover several incidents. Do not merge by URL alone.
    let target=null,event=incoming,reason=candidates.length>1?'Several possible matching events':null;
    if(candidates.length===1){
      const candidate=candidates[0],docs=[...this.eventDocuments(candidate.id).filter(d=>d.id!==doc.id||d.contentHash!==doc.contentHash),doc];
      const merged=await this.model.json('merge',{schema:zodToJsonSchema(eventSchema),existing:candidate.canonical,incoming,documents:docs},{validate:raw=>{const parsed=z.object({sameEvent:z.boolean(),reason:z.string(),event:eventSchema.nullable()}).strict().parse(raw);if(parsed.sameEvent&&parsed.event)parsed.event=this.validate(parsed.event,docs);return parsed;}});
      if(merged.sameEvent&&merged.event){event=this.validate(merged.event,docs);target=candidate;}
      else {reason='Possible duplicate: '+merged.reason;published=null;}
    }
    const now=iso();
    this.store.transaction(()=>{
      if(target){
        if(this.store.event(target.id).revision!==target.revision)throw new Error('Event changed during merge; retry required');
        const seen=this.store.db.prepare('SELECT id FROM observations WHERE event_id=? AND document_id=? AND content_hash=?').get(target.id,doc.id,doc.contentHash);if(seen)return;
        const revision=target.revision+1;
        // Updated drafts never overwrite the public revision without review.
        this.store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',auto_repairs=0,review_reason=? WHERE id=?").run(JSON.stringify(event),event.occurredAt,revision,'Updated source: review changes',target.id);
        this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(target.id,revision,JSON.stringify(event),'source-update',now);
      }else{
        const slug=published?.slug??normalized(incoming.title).replace(/ /g,'-').slice(0,65)+'-'+hash({doc:doc.id,version:doc.contentHash,event:incoming.title,date:incoming.occurredAt}).slice(0,10);
        const existing=this.store.db.prepare('SELECT id FROM events WHERE slug=?').get(slug);if(existing){target=this.store.event(existing.id);return;}
        const id=Number(this.store.db.prepare('INSERT INTO events(slug,first_seen_at,occurred_at,canonical,review_reason,public_id) VALUES(?,?,?,?,?,?)').run(slug,now,event.occurredAt,JSON.stringify(event),reason??'New event: verify extraction and location',published?.id??null).lastInsertRowid);
        target={id};this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,1,?,?,?)').run(id,JSON.stringify(event),'discovered',now);
      }
      this.store.db.prepare('INSERT OR IGNORE INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(target.id,doc.id,doc.contentHash,JSON.stringify(incoming),now);
      if(this.campaignId)this.store.db.prepare('UPDATE events SET campaign_id=? WHERE id=?').run(this.campaignId,target.id);
      this.store.enqueue(this.preparation?'prepare':'translate',target.id,{eventId:target.id,campaignId:this.campaignId});
      const current=this.store.event(target.id);
      if(intervalFor(current)!==null&&!this.store.db.prepare("SELECT id FROM jobs WHERE kind='recheck' AND job_key=?").get(String(target.id)))this.store.enqueue('recheck',target.id,{eventId:target.id},nextCheck(current));
    });
    return target?.id;
  }
  async prepare(id){
    const row=this.store.event(id);if(!row)throw new Error('Unknown event');
    if(this.store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(id,row.revision))return;
    const result=await this.preparation.enrich(row,this.eventDocuments(id));
    const event=eventSchema.parse(result.event),changed=!isDeepStrictEqual(event,row.canonical),revision=row.revision+(changed?1:0);
    this.store.transaction(()=>{
      if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during preparation; retry required');
      if(changed){
        this.store.db.prepare("UPDATE events SET canonical=?,revision=?,state='draft',review_reason='Automatic location and media preparation' WHERE id=?").run(JSON.stringify(event),revision,id);
        this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,revision,JSON.stringify(event),'automatic-preparation',iso());
      }
      const {event:ignored,...metadata}=result;
      this.store.db.prepare('INSERT OR REPLACE INTO preparation VALUES(?,?,?,?)').run(id,revision,JSON.stringify(metadata),iso());
      this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,revision);
      const old=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,row.revision);
      if(old&&JSON.stringify(translationStrings(event))===JSON.stringify(translationStrings(row.canonical))){
        const russian=applyTranslation(event,{language:'ru',strings:translationStrings(JSON.parse(old.payload))});
        this.store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)').run(id,revision,'ru',JSON.stringify(russian),'preparation-reuse',iso());
        this.store.enqueue('localize',id,{eventId:id,campaignId:this.campaignId});
      }else this.store.enqueue('translate',id,{eventId:id,campaignId:this.campaignId});
      this.store.log('prepared',id,{revision,...metadata});
    });
  }
  async translate(id){
    const event=this.store.event(id);if(!event)throw new Error('Unknown event');
    const payload=await this.model.json('translate',{strings:translationStrings(event.canonical)},{validate:raw=>{applyTranslation(event.canonical,raw);return raw;}});
    const translated=applyTranslation(event.canonical,payload);
    this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,event.revision);
    this.store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)').run(id,event.revision,'ru',JSON.stringify(translated),this.model.model,iso());
    if(this.reviewer)this.store.enqueue(this.preparation?'localize':'review',this.preparation?id:`${id}:${event.revision}`,{eventId:id,revision:event.revision,campaignId:this.campaignId});return translated;
  }
  async localize(id) {
    const row=this.store.event(id);if(!row)throw new Error('Unknown event');
    const russian=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,row.revision);
    if(!russian)throw new Error('Current Russian translation is missing');
    const prepared=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(id,row.revision);
    if(!prepared){this.store.enqueue('prepare',id,{eventId:id,campaignId:this.campaignId});return;}
    const texts=displayStrings({...JSON.parse(russian.payload),retainedMedia:JSON.parse(prepared.payload).retainedMedia});
    const lastReview=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? ORDER BY revision DESC LIMIT 1').get(id);
    const feedback=lastReview?JSON.parse(lastReview.payload).issues.filter(i=>i.field.startsWith('siteTranslations')):[];
    const translations=siteTranslations(this.store,id,row.revision)??await translateSiteTexts(this.model,texts,feedback);
    this.store.transaction(()=>{
      if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during site translation');
      this.store.db.prepare('INSERT OR REPLACE INTO site_translations VALUES(?,?,?,?)').run(id,row.revision,JSON.stringify(translations),iso());
      this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,row.revision);
      this.store.enqueue('review',`${id}:${row.revision}`,{eventId:id,revision:row.revision,campaignId:this.campaignId});
    });
  }
  async review(id,revision){
    const event=this.store.event(id);if(!event)throw new Error('Unknown event');
    if(revision&&revision!==event.revision)return {skipped:'Superseded revision'};
    if(!this.reviewer)throw new Error('Review model is not configured');
    const languages=siteTranslations(this.store,id,event.revision);
    if(this.preparation&&!languages){this.store.enqueue('localize',id,{eventId:id,campaignId:this.campaignId});return {deferred:true};}
    if(this.preparation&&(!event.canonical.occurredAt||event.canonical.location.latitude===undefined)){this.store.log('review-deferred',id,{revision:event.revision,reason:'Not ready: date or prepared coordinates missing'});return {deferred:true};}
    const translated=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,event.revision);
    if(!translated)throw new Error('Translate the current revision before review');
    const docs=this.eventDocuments(id);
    const russian=JSON.parse(translated.payload);
    const preparation=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(id,event.revision);
    const result=await this.reviewer.json('review',{schema:this.schema,event:event.canonical,russian,siteTranslations:languages,documents:docs,preparation:preparation?JSON.parse(preparation.payload):null,verifiedLawCatalog:this.laws},{maxTokens:4000,validate:raw=>checkReview(raw,docs,{english:event.canonical,russian,translations:languages})});
    this.store.db.prepare('INSERT OR REPLACE INTO quality_reviews VALUES(?,?,?,?,?)').run(id,event.revision,this.reviewer.model,JSON.stringify(result),iso());
    this.store.db.prepare('UPDATE events SET review_reason=? WHERE id=? AND revision=?').run(`Model ${result.verdict}: ${result.summary}`,id,event.revision);
    recordRequests(this.store,result.requests,{eventId:id,revision:event.revision,model:this.reviewer.model});
    if(this.preparation&&result.verdict==='revise'&&event.auto_repairs<2&&this.store.event(id).revision===event.revision)this.store.enqueue('repair',`${id}:${event.revision}`,{eventId:id,revision:event.revision,campaignId:this.campaignId});
    return result;
  }
  async repair(id,revision){
    const row=this.store.event(id);if(!row||row.revision!==revision||row.auto_repairs>=2)return;
    const quality=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,revision);
    if(!quality||JSON.parse(quality.payload).verdict!=='revise')return;
    const ru=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,revision);
    const docs=this.eventDocuments(id);
    const repaired=await this.model.json('repair',{schema:this.schema,event:row.canonical,russian:ru?JSON.parse(ru.payload):null,review:JSON.parse(quality.payload),documents:docs,verifiedLawCatalog:this.laws},{maxTokens:10000,validate:raw=>{
      const event=this.validate(eventSchema.parse(raw.event),docs),russian=applyTranslation(event,raw.russian);return {event,russian};
    }});
    this.store.transaction(()=>{
      if(this.store.event(id).revision!==revision)throw new Error('Event changed during automatic repair');
      const next=revision+1;
      this.store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',auto_repairs=auto_repairs+1,review_reason='Flash corrected final review issues' WHERE id=?").run(JSON.stringify(repaired.event),repaired.event.occurredAt,next,id);
      this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,next,JSON.stringify(repaired.event),'flash-auto-repair',iso());
      this.store.db.prepare('INSERT INTO translations VALUES(?,?,?,?,?,?)').run(id,next,'ru',JSON.stringify(repaired.russian),this.model.model,iso());
      this.store.enqueue('prepare',id,{eventId:id,campaignId:this.campaignId});
      this.store.log('auto-repaired',id,{revision:next,model:this.model.model});
    });
  }
  async recheck(id){
    let event=this.store.event(id);if(!event)throw new Error('Unknown event');
    if(intervalFor(event)===null)return null;
    const documents=[...new Map(this.eventDocuments(id).map(d=>[d.url,d])).values()],failures=[];
    for(const doc of documents){try{await this.ingest(doc.url,doc.publishedAt);}catch(e){failures.push(e.message);}}
    let researchAvailable=false;
    if(this.search?.key){
      const plan=await this.model.json('research',{title:event.canonical.title,location:event.canonical.location,occurredAt:event.occurredAt,caseReferences:event.canonical.caseReferences,checkedDay:iso().slice(0,10)},{maxTokens:800,validate:raw=>z.object({queries:z.array(z.string().max(600)).max(2)}).strict().parse(raw)});
      for(const query of plan.queries){
        const found=await this.search.query(query);researchAvailable=found.available;
        for(const hit of found.results.slice(0,3)){try{await this.ingest(hit.url);}catch(e){failures.push(e.message);}}
      }
    }
    this.store.log('recheck',id,{researchAvailable,knownSources:documents.length,failures});
    if(failures.length)throw new Error(`Partial recheck failure: ${failures.slice(0,3).join('; ')}`);
    event=this.store.event(id);const next=nextCheck(event);
    this.store.db.prepare('UPDATE events SET last_checked_at=?,next_check_at=? WHERE id=?').run(iso(),next,id);return next;
  }
  async runOne(){
    const job=this.store.claim();if(!job)return false;
    const timer=setInterval(()=>this.store.heartbeat(job),60000);timer.unref();
    try{
      this.campaignId=job.payload.campaignId??null;
      for(const model of [this.model,this.reviewer])if(model)model.campaignId=this.campaignId;
      let next=null;
      if(job.kind==='feed'){
        const page=await this.reader.read(job.payload.url),items=parseFeed(page.body,page.url).slice(0,this.maxItems);
        for(const item of items){const filter=cheapDecision(item.title);if(this.triage&&filter.decision==='drop'){this.store.log('headline-filtered',item.url,{reason:filter.reason});continue;}const existing=this.store.db.prepare("SELECT state FROM jobs WHERE kind='article' AND job_key=?").get(item.url);if(!existing||existing.state==='done')this.store.enqueue('article',item.url,item);}
        next=new Date(Date.now()+job.payload.intervalSeconds*1000).toISOString();
      }else if(job.kind==='article')await this.ingest(job.payload.url,job.payload.publishedAt);
      else if(job.kind==='prepare')await this.prepare(job.payload.eventId);
      else if(job.kind==='repair')await this.repair(job.payload.eventId,job.payload.revision);
      else if(job.kind==='archive')await this.archive.scan(job.payload);
      else if(job.kind==='translate')await this.translate(job.payload.eventId);
      else if(job.kind==='localize')await this.localize(job.payload.eventId);
      else if(job.kind==='review')await this.review(job.payload.eventId,job.payload.revision);
      else if(job.kind==='recheck')next=await this.recheck(job.payload.eventId);
      else throw new Error('Unknown job kind');
      this.store.finish(job,next);
      this.archive?.settle();
    }catch(e){
      if(/Campaign model budget reached/.test(e.message)&&this.campaignId){
        this.store.transaction(()=>{this.store.db.prepare("UPDATE campaigns SET state='budget-exhausted' WHERE id=?").run(this.campaignId);this.store.db.prepare("UPDATE jobs SET state='paused',lease_token=NULL,lease_until=NULL,last_error=? WHERE json_extract(payload,'$.campaignId')=? AND state IN ('running','queued')").run(e.message,this.campaignId);});
        this.store.log('campaign-budget-stop',this.campaignId,{error:e.message});return true;
      }
      const event=job.kind==='recheck'?this.store.event(job.payload.eventId):null;
      if(this.campaignId&&job.attempts>=3){this.store.db.prepare("UPDATE jobs SET state='failed',last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(e.message,job.id,job.lease_token);this.store.log('archive-job-failed',job.id,{kind:job.kind,error:e.message,campaignId:this.campaignId});this.archive?.settle();return true;}
      const retired=event&&intervalFor(event)===null;
      const budgetWait=/Daily (model budget|search limit)/.test(e.message)?Date.parse(new Date(Date.now()+86400000).toISOString().slice(0,10)+'T00:00:30Z')-Date.now():null;
      this.store.finish(job,retired?null:new Date(Date.now()+(budgetWait??retryDelay(job.attempts,e.retryAfter))).toISOString(),e.message);
      this.store.log('job-failure',job.id,{kind:job.kind,error:e.message});
      process.stderr.write(JSON.stringify({job:job.id,kind:job.kind,error:e.message})+'\n');
    }finally{clearInterval(timer);this.campaignId=null;for(const model of [this.model,this.reviewer])if(model)model.campaignId=null;}
    return true;
  }
}
