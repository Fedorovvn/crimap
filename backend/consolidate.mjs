import {compareBrief} from './dedup.mjs';
import {setPublicHidden} from './admin-actions.mjs';
import {stopEventJobs} from './editorial-workflow.mjs';

// Existing records use the same cheap candidate selection and Flash merge as
// incoming sources. Originals and revision histories remain recoverable.
export async function consolidate(pipeline,{limit=30,eventIds}={}){
  const store=pipeline.store,merged=[],checked=new Set();
  let calls=0;
  const rows=()=>store.db.prepare("SELECT id FROM events WHERE merged_into IS NULL AND state!='excluded'").all().map(r=>store.event(r.id));
  for(const start of rows().filter(r=>!eventIds||eventIds.includes(r.id))){
    let row=store.event(start.id);if(row.merged_into)continue;
    for(const candidate of store.candidates(row.canonical,{excludeId:row.id})){
      const key=[row.id,candidate.id].sort((a,b)=>a-b).join(':');if(checked.has(key))continue;checked.add(key);
      if(calls++>=limit)return {merged,comparisons:calls-1};
      // Keep an existing public URL, otherwise the earliest editorial identity.
      const [target,duplicate]=[row,candidate].sort((a,b)=>Number(!!b.public_id)-Number(!!a.public_id)||a.id-b.id);
      pipeline.campaignId=target.campaign_id??duplicate.campaign_id;
      pipeline.model.campaignId=pipeline.campaignId;
      const documents=[...new Map([...pipeline.eventDocuments(target.id),...pipeline.eventDocuments(duplicate.id)].map(d=>[`${d.id}:${d.contentHash}`,d])).values()];
      let result;
      try{
        const comparison=await compareBrief(pipeline.model,duplicate.canonical,[target]);
        if(comparison.decision==='new')continue;
        if(comparison.decision==='repeat'||[target,duplicate].some(e=>e.editorial_mark==='uninteresting')){
          result={sameEvent:comparison.decision!=='new',hasNewInformation:false,reason:comparison.reason};
        }else result=await pipeline.merge(target.canonical,duplicate.canonical,documents);
      }
      catch(e){
        if(/budget reached/i.test(e.message))throw e;
        store.log('merge-needs-retry',target.id,{duplicateId:duplicate.id,error:e.message});
        continue;
      }
      if(!result.sameEvent)continue;
      store.transaction(()=>{
        if(store.event(target.id).revision!==target.revision||store.event(duplicate.id).revision!==duplicate.revision||store.event(duplicate.id).merged_into)throw new Error('Event changed during consolidation');
        store.db.prepare('INSERT OR IGNORE INTO observations(event_id,document_id,content_hash,extracted,created_at) SELECT ?,document_id,content_hash,extracted,created_at FROM observations WHERE event_id=?').run(target.id,duplicate.id);
        store.db.prepare('INSERT OR IGNORE INTO ignored_updates SELECT ?,document_id,content_hash,brief,reason,created_at FROM ignored_updates WHERE event_id=?').run(target.id,duplicate.id);
        const ignored=[store.event(target.id),store.event(duplicate.id)].find(e=>e.editorial_mark==='uninteresting');
        if(ignored){
          store.db.prepare("UPDATE events SET editorial_mark='uninteresting',editorial_reasons=?,editorial_note=?,next_check_at=NULL WHERE id=?").run(ignored.editorial_reasons,ignored.editorial_note,target.id);
          stopEventJobs(store,target.id);
        }else if(duplicate.editorial_mark==='priority')store.db.prepare("UPDATE events SET editorial_mark='priority' WHERE id=?").run(target.id);
        if(pipeline.campaignId)store.db.prepare('UPDATE events SET campaign_id=coalesce(campaign_id,?) WHERE id=?').run(pipeline.campaignId,target.id);
        if(result.hasNewInformation&&!ignored){
          const revision=target.revision+1,now=new Date().toISOString();
          store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',auto_repairs=0,review_reason='Merged sources; awaiting content review' WHERE id=?").run(JSON.stringify(result.event),result.event.occurredAt,revision,target.id);
          store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(target.id,revision,JSON.stringify(result.event),'merged-from-'+duplicate.id,now);
          store.enqueue('prepare',target.id,{eventId:target.id,campaignId:pipeline.campaignId});
        }
        if(duplicate.public_id&&duplicate.public_id!==target.public_id)setPublicHidden(pipeline.publicPath,duplicate.slug,true);
        store.db.prepare("UPDATE events SET merged_into=?,state='merged',next_check_at=NULL WHERE id=?").run(target.id,duplicate.id);
        stopEventJobs(store,duplicate.id);
        store.db.prepare("UPDATE jobs SET state='done',rerun=0 WHERE json_extract(payload,'$.eventId')=? AND state!='running'").run(duplicate.id);
        store.log('events-merged',target.id,{duplicateId:duplicate.id,reason:result.reason,hasNewInformation:result.hasNewInformation});
      });
      merged.push({from:duplicate.id,into:target.id});
      row=store.event(target.id);
      break; // Recompute candidates on the next bounded sweep.
    }
  }
  return {merged,comparisons:calls};
}
