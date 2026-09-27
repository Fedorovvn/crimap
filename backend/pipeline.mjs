import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import {matchCandidates,identify,compareBrief,comparisonCard} from './dedup.mjs';
import {consolidate} from './consolidate.mjs';
import {completeDetails,detailFingerprint,validateLegalLinks} from './details.mjs';
import {retainLocationCoordinates} from './map-surfaces.mjs';
import { readFileSync,existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { eventSchema, extractionSchema, validateEvidence, translationStrings, applyTranslation } from './contract.mjs';
import { hash,jobBudget } from './store.mjs';
import { nextCheck, intervalFor, retryDelay } from './scheduler.mjs';
import {discoverFeed} from './discovery.mjs';
import { LIVE_SOURCE_IDS, feeds, sourceFor, parseArticle } from './sources.mjs';
import { canonicalUrl } from './network.mjs';
import { isDeepStrictEqual } from 'node:util';
import { checkReview,recordRequests } from './review.mjs';
import { cheapDecision } from './triage.mjs';
import { displayStrings, translateSiteTexts, siteTranslations } from './site-localization.mjs';
import { resolveLocationSearch, saveLocationPreparation, applyReviewedLocation } from './review-location.mjs';
import { finalEditorSchema, sourceExcerpts, assembleFinal, normalizeFinalResponse } from './final-editor.mjs';
import { readPublication, comparisonFor, reviewChanges } from './publication-comparison.mjs';
import {queueEditorialPreparation,stopEventJobs} from './editorial-workflow.mjs';
import {validateResolvedDate} from './date-resolution.mjs';

const iso=()=>new Date().toISOString();
export const repairSchema=z.object({event:eventSchema}).strict();
const normalized=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export {matchCandidates} from './dedup.mjs';
export class Pipeline {
  constructor(store,{reader,model,reviewer,search,triage,preparation,archive,publicPath=process.env.DATABASE_PATH,sourceIds=(process.env.COLLECTOR_SOURCES??LIVE_SOURCE_IDS.join(',')).split(','),maxItems=Number(process.env.FEED_MAX_ITEMS??200)}={}){
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
    for(const e of this.store.db.prepare("SELECT id,campaign_id FROM events WHERE json_extract(canonical,'$.occurredAt') IS NULL AND merged_into IS NULL AND state!='excluded'").all())this.store.holdForDate(e.id,{eventId:e.id,campaignId:e.campaign_id});
    for(const e of this.store.db.prepare("SELECT id FROM events WHERE editorial_mark='priority' AND merged_into IS NULL").all())queueEditorialPreparation(this.store,e.id,this.publicPath);
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
    return rows.map(r=>({id:String(r.id),url:r.url,sourceId:r.source_id,sourceKind:r.source_kind,text:r.text,title:r.title,language:r.language,imageUrls:JSON.parse(r.image_urls),publishedAt:r.published_at,first_seen_at:r.first_seen_at,contentHash:r.content_hash}));
  }
  validate(event,documents){
    event=validateEvidence(eventSchema.parse(event),documents);
    const huWords=event.summary.toLowerCase().split(/[^\p{L}]+/u).filter(w=>['és','hogy','éves','férfi','férfit','sértett','sértettet','elkövető','szerint','bűntett','mindkét','nyomozók','ellenére','helyszínen'].includes(w));
    if(huWords.length>=3)throw new Error('Canonical title, summary, labels, notes and update text MUST be written in ENGLISH, not copied in Hungarian. Only evidence quotes and proper names stay Hungarian.');
    if(normalized(event.location.city)!=='budapest')throw new Error('Outside Budapest scope');
    if(event.occurredAt&&Date.parse(event.occurredAt)>Date.now())throw new Error('Occurrence is in the future');
    for(const law of event.legal){
      const match=this.laws.find(l=>isDeepStrictEqual(l.statutes,law.statutes)&&isDeepStrictEqual(l.penalties,law.penalties));
      if(!match)throw new Error('Unverified legal mapping: copy statutes and penalties exactly from verifiedLawCatalog, or explain missing coverage');
      if(law.qualification==='possible'&&(!match.factBasedMapping||law.statuteMatch!=='editorial'))throw new Error('Possible qualification requires an explicitly permitted factBasedMapping and editorial statute match');
    }
    validateLegalLinks(event);
    for(const image of event.media){if(!documents.some(d=>d.url===image.sourceUrl&&d.imageUrls.includes(image.imageUrl)))throw new Error('Image not present in source');image.rights='unknown';}
    return event;
  }
  ensureActive(id=this.activeJob?.payload.eventId){
    const blocked=id&&this.store.event(id)?.editorial_mark==='uninteresting';
    const lost=this.activeJob&&!this.store.db.prepare("SELECT 1 FROM jobs WHERE id=? AND state='running' AND lease_token=?").get(this.activeJob.id,this.activeJob.lease_token);
    if(blocked||lost)throw Object.assign(new Error('Обработка события остановлена редактором'),{code:'EDITORIAL_STOP'});
    if(id&&this.activeJob&&!['article','resolve-date'].includes(this.activeJob.kind)&&!this.store.event(id)?.canonical.occurredAt){
      this.store.holdForDate(id,this.activeJob.payload);
      throw Object.assign(new Error('Ожидает даты происшествия'),{code:'DATE_PENDING'});
    }
  }
  deferUndated(id){
    const row=this.store.event(id);if(!row||row.canonical.occurredAt)return false;
    this.store.holdForDate(id,{eventId:id,campaignId:this.campaignId??row.campaign_id,budgetScope:this.budgetScope});return true;
  }
  async resolveDate(id){
    this.ensureActive(id);
    const row=this.store.event(id);if(!row||row.canonical.occurredAt)return null;
    const attach=doc=>this.store.db.prepare('INSERT OR IGNORE INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(id,doc.id,doc.contentHash,JSON.stringify({dateResearch:true}),iso());
    const latest=()=>[...new Map(this.eventDocuments(id).map(d=>[d.id,d])).values()].map(d=>this.store.document(d.id)??d).reverse().slice(0,6);
    for(const doc of latest().slice(0,3)){
      this.ensureActive(id);
      try{if(this.reader)attach(await this.readDocument(doc.url,doc.publishedAt));}catch(error){this.store.log('date-source-unavailable',id,{url:doc.url,error:error.message});}
    }
    const assess=async()=>{
      this.ensureActive(id);const documents=latest();for(const doc of documents)attach(doc);const sourceHash=hash(documents.map(d=>[d.id,d.contentHash,d.publishedAt]));
      const previous=this.store.db.prepare('SELECT * FROM date_checks WHERE event_id=?').get(id);
      if(previous?.revision===row.revision&&previous.source_hash===sourceHash)return {occurredAt:null,reason:previous.reason};
      const result=documents.length?await this.model.json('resolve-date',{incident:{title:row.canonical.title,summary:row.canonical.summary,location:row.canonical.location,caseReferences:row.canonical.caseReferences},documents:documents.map(d=>({id:d.id,url:d.url,title:d.title,text:d.text.slice(0,12000),publishedAt:d.publishedAt}))},{maxTokens:1000,validate:raw=>validateResolvedDate(raw,documents)}):{occurredAt:null,reason:'Пока нет сохранённых источников с датой происшествия'};
      this.ensureActive(id);
      if(!result.occurredAt)this.store.db.prepare('INSERT OR REPLACE INTO date_checks VALUES(?,?,?,?,?)').run(id,row.revision,sourceHash,result.reason,iso());
      return result;
    };
    let result=await assess();
    const searchKey=`${id}:${row.revision}`;
    if(!result.occurredAt&&this.search?.key&&!this.store.db.prepare("SELECT 1 FROM audit WHERE action='date-search' AND subject=?").get(searchKey)){
      const docs=latest(),query=`${docs[0]?.title??row.canonical.title} ${row.canonical.location.label}`.slice(0,500);
      const found=await this.search.query(query);this.ensureActive(id);
      for(const hit of found.results.slice(0,3)){
        if(!sourceFor(hit.url))continue;
        this.ensureActive(id);const doc=await this.readDocument(hit.url);
        if(this.store.db.prepare('SELECT 1 FROM observations WHERE event_id=? AND document_id=? AND content_hash=?').get(id,doc.id,doc.contentHash))continue;
        for(const brief of await identify(this.model,doc))if((await compareBrief(this.model,brief,[row])).decision!=='new'){attach(doc);break;}
      }
      this.store.log('date-search',searchKey,{results:found.results.length});result=await assess();
    }
    if(!result.occurredAt)return new Date(Date.now()+86400000).toISOString();
    this.store.transaction(()=>{
      this.ensureActive(id);if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during date research');
      const event={...row.canonical,occurredAt:result.occurredAt,timePrecision:result.timePrecision,evidence:[...row.canonical.evidence.filter(e=>!['occurredAt','timePrecision'].includes(e.field)),{field:'occurredAt',documentId:result.documentId,quote:result.quote}]};
      const revision=row.revision+1;
      this.store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',review_reason='Дата установлена по источнику; продолжается подготовка' WHERE id=?").run(JSON.stringify(event),event.occurredAt,revision,id);
      this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,revision,JSON.stringify(event),'date-resolved',iso());
      this.store.db.prepare("UPDATE jobs SET state='done' WHERE json_extract(payload,'$.eventId')=? AND state='waiting-date'").run(id);
      this.store.enqueue(this.preparation?'gather':'translate',id,{eventId:id,campaignId:this.campaignId,budgetScope:this.budgetScope});
      const next=nextCheck(this.store.event(id));if(next)this.store.enqueue('recheck',id,{eventId:id},next);
      this.store.log('date-resolved',id,{revision,...result});
    });
    return null;
  }
  ignoreUpdate(id,doc,brief,reason){
    this.store.db.prepare('INSERT OR REPLACE INTO ignored_updates VALUES(?,?,?,?,?,?)').run(id,doc.id,doc.contentHash,JSON.stringify(brief),reason,iso());
    this.store.log('uninteresting-update-skipped',id,{documentId:doc.id,contentHash:doc.contentHash,reason});
  }
  async ingest(url,publishedAt=null,{revisitIgnoredEvent}={}){
    this.ensureActive();
    const doc=await this.readDocument(url,publishedAt);
    this.ensureActive();
    const processed=this.store.db.prepare("SELECT id FROM audit WHERE action='document-processed' AND subject=? LIMIT 1").get(`${doc.id}:${doc.contentHash}`);
    const revisiting=revisitIgnoredEvent&&this.store.event(revisitIgnoredEvent)?.editorial_mark!=='uninteresting'&&this.store.db.prepare('SELECT 1 FROM ignored_updates WHERE event_id=? AND document_id=?').get(revisitIgnoredEvent,doc.id);
    if(processed&&!revisiting)return {unchanged:true,documentId:doc.id};
    if(this.triage){
      const result=await this.triage.check(doc);
      this.store.db.prepare('INSERT OR REPLACE INTO triage_log VALUES(?,?,?,?,?,?)').run(doc.id,doc.contentHash,Number(result.keep),result.method,result.reason,iso());
      if(!result.keep){this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:0,irrelevantReason:result.reason,filtered:true});return {documentId:doc.id,events:0,filtered:true};}
    }
    let focusIncidents;const identityTargets=[];
    if(this.triage||this.store.db.prepare("SELECT 1 FROM events WHERE editorial_mark='uninteresting' AND merged_into IS NULL LIMIT 1").get()){
      const briefs=await identify(this.model,doc);
      if(!briefs.length){this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:0,filtered:true,irrelevantReason:'В статье не найдено отдельного подходящего происшествия'});return {documentId:doc.id,events:0,filtered:true};}
      focusIncidents=[];
      for(const brief of briefs){
        const comparison=await compareBrief(this.model,{...brief,sourceKind:doc.sourceKind,sourceUrl:doc.url},this.store.candidates(brief).map(r=>({...r,sourceKinds:this.eventDocuments(r.id).map(d=>d.sourceKind)})));
        if(comparison.decision!=='new'&&this.store.event(comparison.eventId)?.editorial_mark==='uninteresting')this.ignoreUpdate(comparison.eventId,doc,brief,comparison.reason);
        else if(comparison.decision==='repeat')this.store.log('repeat-skipped',comparison.eventId,{documentId:doc.id,contentHash:doc.contentHash,reason:comparison.reason});
        else {focusIncidents.push(brief);if(comparison.decision==='update')identityTargets.push(comparison.eventId);}
      }
      if(!focusIncidents.length){this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:0,repeat:true});return {documentId:doc.id,events:0,repeat:true};}
    }
    const input={schema:this.schema,focusIncidents,documents:[doc],firstSeenAt:iso(),verifiedLawCatalog:this.laws};
    const options={validate:raw=>{const parsed=extractionSchema.parse(raw);parsed.events=parsed.events.map(e=>this.validate(e,[doc]));checkReview({verdict:'pass',summary:'Extraction suggestions',issues:[],requests:parsed.requests},[doc]);return parsed;}};
    const result=await this.model.json('extract',input,options),extractionModel=this.model.model;
    this.ensureActive();
    // Validate every result before any event mutation: malformed multi-event responses are atomic failures.
    const events=result.events.filter(e=>e.type!=='missing-person').map(event=>this.validate(event,[doc]));
    let firstId;
    for(const event of events){const id=await this.upsert(event,doc,{confirmedTarget:focusIncidents?.length===1&&events.length===1?identityTargets[0]:undefined});firstId??=id;}
    if(firstId&&result.requests?.length)recordRequests(this.store,result.requests,{eventId:firstId,revision:this.store.event(firstId).revision,model:extractionModel});
    this.store.log('document-processed',`${doc.id}:${doc.contentHash}`,{events:events.length,irrelevantReason:result.irrelevantReason});
    return {documentId:doc.id,events:events.length};
  }
  async upsert(incoming,doc,{confirmedTarget}={}){
    const rows=this.store.db.prepare("SELECT id FROM events WHERE merged_into IS NULL AND state!='excluded'").all().map(r=>this.store.event(r.id));
    const street=normalized(incoming.location.label.split(',')[0]);
    const publishedMatches=this.publishedSources().filter(p=>p.source_url===doc.url&&incoming.occurredAt&&Math.abs(Date.parse(p.occurred_at)-Date.parse(incoming.occurredAt))<86400000&&street===normalized(p.location_label.split(',')[0]));
    let published=publishedMatches.length===1?publishedMatches[0]:null;
    const linked=published?rows.filter(r=>r.public_id===published.id):[];
    const confirmed=confirmedTarget?rows.find(r=>r.id===confirmedTarget):null;
    if(confirmedTarget&&!confirmed)throw new Error('Flash-matched event changed; retry identity check');
    let candidates=confirmed?[confirmed]:(linked.length?linked:this.store.candidates(incoming));
    let identityMatched=!!confirmed;
    if(!confirmed&&candidates.length){
      const comparison=await compareBrief(this.model,incoming,candidates);
      if(comparison.decision==='repeat'){
        this.ignoreUpdate(comparison.eventId,doc,incoming,comparison.reason);
        return comparison.eventId;
      }
      candidates=comparison.decision==='update'?candidates.filter(c=>c.id===comparison.eventId):[];
      identityMatched=comparison.decision==='update';
    }
    // Same article may cover several incidents. Do not merge by URL alone.
    let target=null,event=incoming,reason=candidates.length>1?'Several possible matching events':null;
    let noChange=false;
    for(const candidate of candidates.slice(0,4)){
      if(this.store.event(candidate.id)?.editorial_mark==='uninteresting'){
        const comparison=await compareBrief(this.model,incoming,[candidate]);
        if(comparison.decision!=='new'){this.ignoreUpdate(candidate.id,doc,incoming,comparison.reason);return candidate.id;}
        continue;
      }
      const docs=[...this.eventDocuments(candidate.id).filter(d=>d.id!==doc.id||d.contentHash!==doc.contentHash),doc];
      const merged=await this.merge(candidate.canonical,incoming,docs);
      if(merged.sameEvent){target=candidate;event=merged.event??candidate.canonical;noChange=merged.hasNewInformation===false;break;}
    }
    const now=iso();
    if(identityMatched&&!target)throw new Error('Flash identity and merge disagree; do not create a duplicate event');
    this.store.transaction(()=>{
      if(target){
        if(this.store.event(target.id)?.editorial_mark==='uninteresting'){this.ignoreUpdate(target.id,doc,incoming,'Совпадение установлено во время остановки обработки');return;}
        if(this.store.event(target.id).revision!==target.revision)throw new Error('Event changed during merge; retry required');
        const seen=this.store.db.prepare('SELECT id FROM observations WHERE event_id=? AND document_id=? AND content_hash=?').get(target.id,doc.id,doc.contentHash);if(seen)return;
        if(noChange){this.store.log('repeat-skipped',target.id,{documentId:doc.id,contentHash:doc.contentHash});return;}
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
      this.store.enqueue(this.preparation?'gather':'translate',target.id,{eventId:target.id,campaignId:this.campaignId,budgetScope:this.budgetScope});
      const current=this.store.event(target.id);
      if(current.canonical.occurredAt)this.store.db.prepare("UPDATE jobs SET state='done',rerun=0 WHERE json_extract(payload,'$.eventId')=? AND (state='waiting-date' OR (kind='resolve-date' AND state IN ('queued','paused')))").run(target.id);
      if(current.canonical.occurredAt&&intervalFor(current)!==null&&!this.store.db.prepare("SELECT id FROM jobs WHERE kind='recheck' AND job_key=?").get(String(target.id)))this.store.enqueue('recheck',target.id,{eventId:target.id},nextCheck(current));
    });
    return target?.id;
  }
  async merge(existing,incoming,documents){
    const responseSchema=z.object({sameEvent:z.boolean(),hasNewInformation:z.boolean().default(true),reason:z.string().default('Flash comparison of source facts'),event:eventSchema.nullable()}).strict();
    return this.model.json('merge',{schema:zodToJsonSchema(responseSchema),existing,incoming,documents:sourceExcerpts(documents,{evidence:[...(existing.evidence??[]),...(incoming.evidence??[])]}),verifiedLawCatalog:this.laws},{maxTokens:10000,validate:raw=>{
      const r=responseSchema.parse(raw);
      if(r.sameEvent&&r.hasNewInformation&&!r.event)throw new Error('A material update requires a complete merged event');
      if(r.event){retainLocationCoordinates(existing.location,r.event.location);r.event=this.validate(r.event,documents);}return r;
    }});
  }
  async deduplicateExisting(id){
    const row=this.store.event(id);if(!row)return false;
    if(row.merged_into||row.state==='excluded'||row.editorial_mark==='uninteresting')return true;
    const candidates=this.store.candidates(row.canonical,{excludeId:id});if(!candidates.length)return false;
    const key=hash({id,event:comparisonCard(row.canonical),candidates:candidates.map(r=>({id:r.id,mark:r.editorial_mark,reasons:r.editorial_reasons,event:comparisonCard(r.canonical)}))});
    if(this.store.db.prepare("SELECT 1 FROM audit WHERE action='identity-gate-clear' AND subject=? LIMIT 1").get(key))return false;
    const comparison=await compareBrief(this.model,row.canonical,candidates);
    this.ensureActive(id);
    if(comparison.decision==='new'){
      this.store.log('identity-gate-clear',key,{eventId:id,candidates:candidates.map(r=>r.id)});return false;
    }
    const scope=this.campaignId,modelScope=this.model.campaignId;
    let result;try{result=await consolidate(this,{eventIds:[id],candidateIds:[comparison.eventId],limit:1});}
    finally{this.campaignId=scope;this.model.campaignId=modelScope;}
    if(!result.merged.length)throw new Error('Flash identified a duplicate but merge needs retry; expensive preparation blocked');
    const current=this.store.event(id);
    return !!current.merged_into||current.editorial_mark==='uninteresting'||current.revision!==row.revision;
  }
  async gather(id){
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    if(await this.deduplicateExisting(id))return {deduplicated:true};
    const row=this.store.event(id);if(!row||row.merged_into||row.state==='excluded')return;
    const key=`${id}:${new Date().toISOString().slice(0,10)}`;
    if(this.search?.key&&!this.store.db.prepare("SELECT 1 FROM audit WHERE action='gather-complete' AND subject=?").get(key)){
      const plan=await this.model.json('research',{title:row.canonical.title,location:row.canonical.location,occurredAt:row.occurredAt,caseReferences:row.canonical.caseReferences,checkedDay:iso().slice(0,10)},{maxTokens:800,validate:raw=>z.object({queries:z.array(z.string().max(600)).max(2)}).strict().parse(raw)});
      for(const query of plan.queries){this.ensureActive(id);const found=await this.search.query(query);for(const hit of found.results.slice(0,3))await this.ingest(hit.url);}
      this.store.log('gather-complete',key,{provider:'search',revision:row.revision});
    }
    this.store.enqueue('prepare',id,{eventId:id,campaignId:this.campaignId,budgetScope:this.budgetScope});
  }
  async prepare(id,{refresh=false}={}){
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    if(await this.deduplicateExisting(id))return {deduplicated:true};
    const row=this.store.event(id);if(!row)throw new Error('Unknown event');
    if(!refresh&&this.store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(id,row.revision))return;
    const documents=this.eventDocuments(id);
    const previous=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? ORDER BY revision DESC LIMIT 1').get(id);
    const prior=previous?JSON.parse(previous.payload).detailCompletion:null;
    let completion=prior,preparedRow=row;
    const revisionReason=this.store.db.prepare('SELECT reason FROM event_revisions WHERE event_id=? AND revision=?').get(id,row.revision)?.reason;
    // Repair already reads the original documents and Pro feedback. A fresh
    // extraction here could undo those corrections and wastes another model call.
    const repaired=revisionReason==='flash-auto-repair';
    const needsDetails=this.model&&documents.length&&(row.canonical.participants.length||['assault','fight','robbery'].includes(row.canonical.type)||row.canonical.signals.some(s=>['death','injury'].includes(s)));
    if(needsDetails&&!repaired&&(refresh||prior?.fingerprint!==detailFingerprint(row.canonical,documents,this.laws))){
      const details=await completeDetails(this.model,row.canonical,documents,this.laws,(e,d)=>this.validate(e,d));
      preparedRow={...row,canonical:details.event};
      completion={fingerprint:details.fingerprint,coverage:details.coverage,model:this.model.model,checkedAt:iso()};
      checkReview({verdict:'pass',summary:'Detail requests',issues:[],requests:details.requests},documents);
      if(details.requests.length)recordRequests(this.store,details.requests,{eventId:id,revision:row.revision,model:this.model.model});
    }
    if(repaired)completion={fingerprint:detailFingerprint(row.canonical,documents,this.laws),model:this.model?.model,checkedAt:iso(),repairedAfterReview:true};
    this.ensureActive(id);
    const result=await this.preparation.enrich(preparedRow,documents);
    this.ensureActive(id);
    if(completion)result.detailCompletion=completion;
    const event=eventSchema.parse(result.event),changed=!isDeepStrictEqual(event,row.canonical),revision=row.revision+(changed?1:0);
    this.store.transaction(()=>{
      this.ensureActive(id);
      if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during preparation; retry required');
      if(changed){
        this.store.db.prepare("UPDATE events SET canonical=?,revision=?,state='draft',review_reason='Automatic location and media preparation' WHERE id=?").run(JSON.stringify(event),revision,id);
        this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,revision,JSON.stringify(event),'automatic-preparation',iso());
      }
      const {event:ignored,...metadata}=result;
      this.store.db.prepare('INSERT OR REPLACE INTO preparation VALUES(?,?,?,?)').run(id,revision,JSON.stringify(metadata),iso());
      this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,revision);
      this.store.enqueue(this.reviewer?'review':'translate',this.reviewer?`${id}:${revision}`:id,{eventId:id,revision,campaignId:this.campaignId,budgetScope:this.budgetScope});
      this.store.log('prepared',id,{revision,...metadata});
    });
  }
  async translate(id){
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    const event=this.store.event(id);if(!event)throw new Error('Unknown event');
    const finalized=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,event.revision);
    if(finalized&&JSON.parse(finalized.payload).finalized)return {skipped:'Final translations already checked by Pro'};
    if(this.reviewer){this.store.enqueue('review',`${id}:${event.revision}`,{eventId:id,revision:event.revision,campaignId:this.campaignId,budgetScope:this.budgetScope});return {deferred:true};}
    const payload=await this.model.json('translate',{strings:translationStrings(event.canonical)},{validate:raw=>{applyTranslation(event.canonical,raw);return raw;}});
    const translated=applyTranslation(event.canonical,payload);
    this.ensureActive(id);
    if(this.store.event(id).revision!==event.revision)throw new Error('Event changed during translation');
    if(!this.reviewer)this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,event.revision);
    this.store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)').run(id,event.revision,'ru',JSON.stringify(translated),this.model.model,iso());
    if(this.preparation)this.store.enqueue('localize',id,{eventId:id,revision:event.revision,campaignId:this.campaignId,budgetScope:this.budgetScope});return translated;
  }
  passed(id,revision){const r=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,revision);return r&&JSON.parse(r.payload).verdict==='pass';}
  async localize(id) {
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    const row=this.store.event(id);if(!row)throw new Error('Unknown event');
    const finalized=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,row.revision);
    if(finalized&&JSON.parse(finalized.payload).finalized)return {skipped:'Final translations already checked by Pro'};
    if(this.reviewer){this.store.enqueue('review',`${id}:${row.revision}`,{eventId:id,revision:row.revision,campaignId:this.campaignId,budgetScope:this.budgetScope});return {deferred:true};}
    const russian=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,row.revision);
    if(!russian)throw new Error('Current Russian translation is missing');
    const prepared=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(id,row.revision);
    if(!prepared){this.store.enqueue('prepare',id,{eventId:id,campaignId:this.campaignId,budgetScope:this.budgetScope});return;}
    const texts=displayStrings({...JSON.parse(russian.payload),retainedMedia:JSON.parse(prepared.payload).retainedMedia});
    const lastReview=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? ORDER BY revision DESC LIMIT 1').get(id);
    const feedback=lastReview?JSON.parse(lastReview.payload).issues.filter(i=>i.field.startsWith('siteTranslations')):[];
    const translations=siteTranslations(this.store,id,row.revision)??await translateSiteTexts(this.model,texts,feedback);
    this.store.transaction(()=>{
      this.ensureActive(id);
      if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during site translation');
      this.store.db.prepare('INSERT OR REPLACE INTO site_translations VALUES(?,?,?,?)').run(id,row.revision,JSON.stringify(translations),iso());
      this.store.log('translations-ready',id,{revision:row.revision});
    });
  }
  async relevanceBeforeReview(id){
    if(!this.triage)return true;
    const row=this.store.event(id),e=row.canonical;
    const input={title:e.title,text:[e.summary,e.location?.city,...(e.participants??[]).map(p=>p.note??'')].filter(Boolean).join('\n')};
    const key=hash({id,input,policy:readFileSync(new URL('./prompts/editorial-scope.md',import.meta.url),'utf8')});
    const cached=this.store.db.prepare("SELECT detail FROM audit WHERE action='event-relevance-checked' AND subject=? ORDER BY id DESC LIMIT 1").get(key);
    const result=cached?JSON.parse(cached.detail):await this.triage.check(input);
    this.ensureActive(id);
    if(this.store.event(id).revision!==row.revision)throw new Error('Event changed during relevance check');
    if(!cached)this.store.log('event-relevance-checked',key,{eventId:id,...result});
    if(!result.keep){
      this.store.transaction(()=>{
        stopEventJobs(this.store,id);
        this.store.db.prepare("UPDATE events SET state=CASE WHEN public_id IS NULL THEN 'excluded' ELSE state END,next_check_at=NULL,review_reason=? WHERE id=?").run(result.reason,id);
        this.store.log('event-filtered',id,{reason:result.reason,method:result.method});
      });
    }
    return result.keep;
  }
  async review(id,revision){
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    const event=this.store.event(id);if(!event)throw new Error('Unknown event');
    if(revision&&revision!==event.revision)return {skipped:'Superseded revision'};
    if(event.merged_into||event.state==='excluded')return {skipped:'Inactive event'};
    if(!await this.relevanceBeforeReview(id))return {filtered:true};
    if(await this.deduplicateExisting(id))return {deduplicated:true};
    if(!this.reviewer)throw new Error('Review model is not configured');
    this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,event.revision);
    // Missing dates/coordinates are facts for Pro to inspect, not a reason to
    // silently finish a review job without ever invoking the reviewer.
    const docs=this.eventDocuments(id);
    const prepared=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(id,event.revision);
    const preparation=prepared?JSON.parse(prepared.payload):null;
    if(this.preparation&&!prepared){
      this.store.enqueue('gather',id,{eventId:id,campaignId:this.campaignId,budgetScope:this.budgetScope});
      this.store.log('review-deferred',id,{reason:'Сначала нужно завершить сбор источников, фотографий и координат',revision:event.revision});
      return {deferred:true,awaitingPreparation:true};
    }
    if(this.preparation&&!docs.length)throw new Error('Final review prerequisites: no saved sources');
    const published=readPublication(this.publicPath,event.slug);
    // Persist inexpensive translation drafts separately, so a retry of Pro does
    // not pay for or regenerate them. None of these drafts is a publication.
    const existingRussian=this.store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,event.revision);
    const russian=existingRussian?JSON.parse(existingRussian.payload):applyTranslation(event.canonical,await this.model.json('translate',{strings:translationStrings(event.canonical)},{validate:raw=>{applyTranslation(event.canonical,raw,{draft:true});return raw;}}),{draft:true});
    this.ensureActive(id);
    if(this.store.event(id).revision!==event.revision)throw new Error('Event changed while preparing review translations');
    if(!existingRussian)this.store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)').run(id,event.revision,'ru',JSON.stringify(russian),this.model.model,iso());
    const translations=siteTranslations(this.store,id,event.revision)??await translateSiteTexts(this.model,displayStrings({...russian,retainedMedia:preparation?.retainedMedia}),[],{draft:true});
    this.ensureActive(id);
    if(this.store.event(id).revision!==event.revision)throw new Error('Event changed while preparing review languages');
    this.store.db.prepare('INSERT OR REPLACE INTO site_translations VALUES(?,?,?,?)').run(id,event.revision,JSON.stringify(translations),iso());
    this.ensureActive(id);
    const enabled=!!(preparation&&this.preparation?.geocoder?.landmarks);
    if(preparation?.locationReview?.pending)await resolveLocationSearch(this.store,event,preparation,this.preparation.geocoder);
    const assess=async()=>{
      this.ensureActive(id);
      const locationLookup={enabled,...(preparation?.locationReview??{}),maxQueries:2,requireSurface:true};
      let outputSchema=finalEditorSchema.required({legalCoverage:true});
      if(enabled&&!locationLookup.applied)outputSchema=outputSchema.required({locationResolution:true});
      if(published)outputSchema=outputSchema.required({publicationSummary:true});
      const priorError=this.store.db.prepare("SELECT detail FROM audit WHERE action='review-validation-retry' AND subject=? ORDER BY id DESC LIMIT 1").get(String(id));
      const previous=priorError?JSON.parse(priorError.detail):null;
      const payload={schema:zodToJsonSchema(outputSchema),previousValidationError:previous?.revision===event.revision?previous.error:null,event:event.canonical,russian:translationStrings(russian),translationPaths:Object.keys(translationStrings(event.canonical)),siteTranslations:translations,documents:sourceExcerpts(docs,event.canonical),preparation,locationLookup,verifiedLawCatalog:this.laws,
        currentPublication:published?{revision:published.revision,updatedAt:published.updated_at,snapshot:published.snapshot}:null,
        proposedPublicationChanges:reviewChanges(comparisonFor(published,russian,docs,preparation,translations)?.changes??[])};
      return this.reviewer.json('review',payload,{maxTokens:28000,validate:raw=>{
        raw=normalizeFinalResponse(raw,event.canonical,russian);
        if(published&&raw.verdict==='pass'&&!raw.publicationSummary?.trim())throw new Error('Include publicationSummary in Russian explaining final changes relative to currentPublication, including removals; say explicitly if there are no meaningful changes');
        assembleFinal(raw,{event:event.canonical,russian,translations,preparation,documents:docs,locationLookup,requireLegalCoverage:true,validateEvent:e=>this.validate(e,docs)});
        return finalEditorSchema.parse(raw);
      }}).catch(error=>{if(error.validationFailure)this.store.log('review-validation-retry',id,{revision:event.revision,error:error.message.slice(0,6000)});throw error;});
    };
    let result=await assess();
    this.ensureActive(id);
    if(result.verdict!=='reject'&&result.locationResolution?.action==='search'){
      // Remove any earlier pass before starting work that can change the map.
      this.store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,event.revision);
      preparation.locationReview={pending:true,queries:result.locationResolution.queries,completed:0,candidates:[]};
      saveLocationPreparation(this.store,event,preparation);
      await resolveLocationSearch(this.store,event,preparation,this.preparation.geocoder);
      result=await assess();
      this.ensureActive(id);
    }
    if(result.verdict!=='reject'&&result.locationResolution?.action==='select'){
      const candidate=preparation.locationReview.candidates.find(c=>c.id===result.locationResolution.candidateId);
      return applyReviewedLocation(this.store,event,preparation,candidate,result.locationResolution.reason,this.budgetScope==='daily'?null:this.campaignId??event.campaign_id);
    }
    const final=assembleFinal(result,{event:event.canonical,russian,translations,preparation,documents:docs,locationLookup:{enabled,...(preparation?.locationReview??{}),maxQueries:2,requireSurface:true},requireLegalCoverage:true,validateEvent:e=>this.validate(e,docs)});
    const nextRevision=event.revision+(final.event&&!isDeepStrictEqual(final.event,event.canonical)?1:0);
    if((readPublication(this.publicPath,event.slug)?.fingerprint??null)!==(published?.fingerprint??null))throw new Error('Published version changed during Pro editing; retry against the new publication');
    if(published)final.review.publicationBaseline=published.fingerprint;
    this.store.transaction(()=>{
      this.ensureActive(id);
      if(this.store.event(id)?.revision!==event.revision)throw new Error('Event changed during final review');
      if(final.event){
        if(nextRevision!==event.revision){
          this.store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft' WHERE id=?").run(JSON.stringify(final.event),final.event.occurredAt,nextRevision,id);
          this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,nextRevision,JSON.stringify(final.event),'pro-final-editor',iso());
        }
        this.store.db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?,?,?,?)').run(id,nextRevision,'ru',JSON.stringify(final.russian),this.reviewer.model,iso());
        this.store.db.prepare('INSERT OR REPLACE INTO site_translations VALUES(?,?,?,?)').run(id,nextRevision,JSON.stringify(final.translations),iso());
      }
      if(preparation){if(enabled)preparation.locationReview={...preparation.locationReview,checked:true};this.store.db.prepare('INSERT OR REPLACE INTO preparation VALUES(?,?,?,?)').run(id,nextRevision,JSON.stringify(preparation),iso());}
      this.store.db.prepare('INSERT OR REPLACE INTO quality_reviews VALUES(?,?,?,?,?)').run(id,nextRevision,this.reviewer.model,JSON.stringify(final.review),iso());
      this.store.db.prepare('UPDATE events SET review_reason=? WHERE id=? AND revision=?').run(`Model ${result.verdict}: ${result.summary}`,id,nextRevision);
      this.store.log('pro-final-editor',id,{revision:nextRevision,verdict:result.verdict,changed:nextRevision!==event.revision});
    });
    recordRequests(this.store,result.requests,{eventId:id,revision:nextRevision,model:this.reviewer.model});
    return final.review;
  }
  async repair(id,revision){
    this.ensureActive(id);
    if(this.deferUndated(id))return {deferred:true,awaitingDate:true};
    const row=this.store.event(id);if(!row||row.revision!==revision||row.auto_repairs>=2)return;
    // Legacy repair jobs enter the new final editor; Flash must not rewrite a
    // final Pro decision or require the owner to approve individual corrections.
    if(this.reviewer)return this.review(id,revision);
    const quality=this.store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,revision);
    if(!quality||JSON.parse(quality.payload).verdict!=='revise')return;
    const docs=this.eventDocuments(id);
    const repaired=await this.model.json('repair',{schema:zodToJsonSchema(repairSchema),event:row.canonical,russian:null,review:JSON.parse(quality.payload),documents:docs,verifiedLawCatalog:this.laws},{maxTokens:10000,validate:raw=>{
      const {event}=repairSchema.parse(raw);retainLocationCoordinates(row.canonical.location,event.location);
      return {event:this.validate(event,docs)};
    }});
    this.store.transaction(()=>{
      this.ensureActive(id);
      if(this.store.event(id).revision!==revision)throw new Error('Event changed during automatic repair');
      const next=revision+1;
      this.store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',auto_repairs=auto_repairs+1,review_reason='Flash corrected final review issues' WHERE id=?").run(JSON.stringify(repaired.event),repaired.event.occurredAt,next,id);
      this.store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(id,next,JSON.stringify(repaired.event),'flash-auto-repair',iso());
      this.store.enqueue('prepare',id,{eventId:id,campaignId:this.campaignId,budgetScope:this.budgetScope});
      this.store.log('auto-repaired',id,{revision:next,model:this.model.model});
    });
  }
  async recheck(id){
    this.ensureActive(id);
    if(this.deferUndated(id))return null;
    let event=this.store.event(id);if(!event)throw new Error('Unknown event');
    if(event.merged_into||event.state==='excluded'||event.canonical.type==='missing-person'||intervalFor(event)===null)return null;
    const documents=[...new Map(this.eventDocuments(id).map(d=>[d.url,d])).values()],failures=[];
    for(const doc of documents){try{await this.ingest(doc.url,doc.publishedAt);}catch(e){failures.push(e.message);}}
    let researchAvailable=false;
    if(this.search?.key){
      const plan=await this.model.json('research',{title:event.canonical.title,location:event.canonical.location,occurredAt:event.occurredAt,caseReferences:event.canonical.caseReferences,checkedDay:iso().slice(0,10)},{maxTokens:800,validate:raw=>z.object({queries:z.array(z.string().max(600)).max(2)}).strict().parse(raw)});
      for(const query of plan.queries){this.ensureActive(id);
        const found=await this.search.query(query);researchAvailable=found.available;
        for(const hit of found.results.slice(0,3)){try{await this.ingest(hit.url);}catch(e){failures.push(e.message);}}
      }
    }
    this.ensureActive(id);
    this.store.log('recheck',id,{researchAvailable,knownSources:documents.length,failures});
    if(failures.length)throw new Error(`Partial recheck failure: ${failures.slice(0,3).join('; ')}`);
    event=this.store.event(id);const next=nextCheck(event);
    this.store.db.prepare('UPDATE events SET last_checked_at=?,next_check_at=? WHERE id=?').run(iso(),next,id);return next;
  }
  async runOne({kinds}={}){
    const job=this.store.claim(iso(),kinds);if(!job)return false;
    this.activeJob=job;
    const startedAt=iso();
    this.store.log('job-started',job.id,{kind:job.kind,eventId:job.payload.eventId,sourceId:job.payload.sourceId??job.payload.discoveredBy,url:job.payload.url,title:job.payload.title});
    const modelGuards=new Map([...new Set([this.model,this.reviewer].filter(Boolean))].map(model=>[model,model.guard]));
    for(const [model,guard] of modelGuards)model.guard=()=>{guard?.();this.ensureActive();};
    const timer=setInterval(()=>this.store.heartbeat(job),60000);timer.unref();
    try{
      const budget=jobBudget(job.kind,job.payload,job.payload.eventId?this.store.event(job.payload.eventId):null);
      this.campaignId=budget.campaignId;this.budgetScope=budget.budgetScope;
      job.payload={...job.payload,...budget};
      this.store.db.prepare('UPDATE jobs SET payload=? WHERE id=? AND lease_token=?').run(JSON.stringify(job.payload),job.id,job.lease_token);
      for(const model of [this.model,this.reviewer])if(model)model.campaignId=this.campaignId;
      const current=job.payload.eventId?this.store.event(job.payload.eventId):null;
      if(current&&(current.merged_into||current.state==='excluded'||current.editorial_mark==='uninteresting')){this.store.finish(job);return true;}
      let next=null;
      if(job.kind==='feed'){
        await discoverFeed(this.store,this.reader,job.payload);
        next=new Date(Date.now()+job.payload.intervalSeconds*1000).toISOString();
      }else if(job.kind==='article')await this.ingest(job.payload.url,job.payload.publishedAt,job.payload);
      else if(job.kind==='resolve-date')next=await this.resolveDate(job.payload.eventId);
      else if(job.kind==='gather')await this.gather(job.payload.eventId);
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
      if(e.code==='DATE_PENDING'){this.store.log('date-hold',job.payload.eventId,{kind:job.kind});return true;}
      if(e.code==='EDITORIAL_STOP'||(job.payload.eventId&&this.store.event(job.payload.eventId)?.editorial_mark==='uninteresting')){this.store.log('editorial-work-stopped',job.payload.eventId,{kind:job.kind});this.archive?.settle();return true;}
      if(e.message==='Total model budget reached'){
        this.store.db.prepare("UPDATE jobs SET state='paused',last_error=?,lease_token=NULL,lease_until=NULL,rerun=0 WHERE id=? AND lease_token=?").run(e.message,job.id,job.lease_token);
        this.store.log('total-budget-stop',job.id,{kind:job.kind});return true;
      }
      if(/Campaign model budget reached/.test(e.message)&&this.campaignId){
        this.store.transaction(()=>{this.store.db.prepare("UPDATE campaigns SET state='budget-exhausted' WHERE id=?").run(this.campaignId);this.store.db.prepare("UPDATE jobs SET state='paused',lease_token=NULL,lease_until=NULL,last_error=? WHERE json_extract(payload,'$.campaignId')=? AND state IN ('running','queued')").run(e.message,this.campaignId);});
        this.store.log('campaign-budget-stop',this.campaignId,{error:e.message});return true;
      }
      const event=job.kind==='recheck'?this.store.event(job.payload.eventId):null;
      if(this.campaignId&&job.attempts>=3){this.store.db.prepare("UPDATE jobs SET state='failed',last_error=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(e.message,job.id,job.lease_token);this.store.log('archive-job-failed',job.id,{kind:job.kind,error:e.message,campaignId:this.campaignId,budgetScope:this.budgetScope});this.archive?.settle();return true;}
      const retired=event&&intervalFor(event)===null;
      const budgetWait=/Daily (model budget|search limit)/.test(e.message)?Date.parse(new Date(Date.now()+86400000).toISOString().slice(0,10)+'T00:00:30Z')-Date.now():null;
      this.store.finish(job,retired?null:new Date(Date.now()+(budgetWait??retryDelay(job.attempts,e.retryAfter))).toISOString(),e.message);
      this.store.log('job-failure',job.id,{kind:job.kind,error:e.message});
      process.stderr.write(JSON.stringify({job:job.id,kind:job.kind,error:e.message})+'\n');
    }finally{
      const latest=this.store.db.prepare('SELECT state,last_error FROM jobs WHERE id=?').get(job.id);
      this.store.log('job-finished',job.id,{kind:job.kind,eventId:job.payload.eventId,sourceId:job.payload.sourceId??job.payload.discoveredBy,url:job.payload.url,title:job.payload.title,startedAt,state:latest?.state,error:latest?.last_error??null,outcome:latest?.last_error?'error':['cancelled','paused','waiting-date'].includes(latest?.state)?'stopped':'complete'});
      for(const [model,guard] of modelGuards)model.guard=guard;this.activeJob=null;clearInterval(timer);this.campaignId=null;this.budgetScope=undefined;for(const model of [this.model,this.reviewer])if(model)model.campaignId=null;
    }
    return true;
  }
}
