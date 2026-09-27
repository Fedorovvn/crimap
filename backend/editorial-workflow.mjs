import {readPublication} from './publication-comparison.mjs';

export function queueEditorialPreparation(store,id,publicPath=process.env.DATABASE_PATH){
  const event=store.event(id);
  if(!event||event.editorial_mark==='uninteresting'||event.merged_into||event.state==='excluded')return false;
  if(!event.canonical.occurredAt)return store.holdForDate(id,{eventId:id,campaignId:event.campaign_id},{refresh:true});
  const now=new Date().toISOString();
  const active=store.db.prepare("SELECT * FROM jobs WHERE json_extract(payload,'$.eventId')=? AND kind!='recheck' AND state IN ('queued','running','paused')").all(id).filter(j=>!JSON.parse(j.payload).revision||JSON.parse(j.payload).revision===event.revision);
  if(active.length){
    for(const job of active)if(job.state!=='running')store.db.prepare('UPDATE jobs SET due_at=? WHERE id=?').run(now,job.id);
    return true;
  }
  const quality=store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(id,event.revision);
  const publication=event.public_id&&event.published_revision!==event.revision?readPublication(publicPath,event.slug):null;
  const ready=quality&&JSON.parse(quality.payload).verdict==='pass'&&(!publication||JSON.parse(quality.payload).publicationBaseline===publication.fingerprint)&&event.canonical.occurredAt&&Number.isFinite(event.canonical.location.latitude)&&
    store.db.prepare("SELECT 1 FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(id,event.revision)&&
    store.db.prepare('SELECT 1 FROM site_translations WHERE event_id=? AND revision=?').get(id,event.revision);
  if(ready)return false;
  const prepared=store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(id,event.revision);
  const kind=prepared?'review':'gather',key=prepared?`${id}:${event.revision}`:id;
  store.enqueue(kind,key,{eventId:id,revision:event.revision,campaignId:event.campaign_id});
  store.db.prepare("UPDATE jobs SET attempts=0,last_error=NULL WHERE kind=? AND job_key=? AND state!='running'").run(kind,String(key));
  return true;
}

export function stopEventJobs(store,id){
  return store.db.prepare("UPDATE jobs SET state='cancelled',rerun=0,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE json_extract(payload,'$.eventId')=? AND state IN ('queued','running','paused','failed','waiting-date')").run(id).changes;
}
