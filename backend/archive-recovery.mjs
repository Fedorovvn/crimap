// Explicit, idempotent recovery after the review/repair contract migration.
// No model calls, publication, budget increase, or rewriting of usage history.
export function recoverArchive(store,campaignId){
  const marker=`review-repair-v2:${campaignId}`;
  if(store.db.prepare("SELECT 1 FROM audit WHERE action='archive-recovered' AND subject=?").get(marker))return {alreadyRecovered:true};
  const campaign=store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
  if(!campaign)throw new Error('Unknown archive campaign');
  const spent=store.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage WHERE campaign_id=?').get(campaignId).n;
  if(spent>=campaign.budget_usd)throw new Error('Archive budget exhausted; recovery cannot increase the limit');
  const report={campaignId,budget:campaign.budget_usd,spent,linked:[],queued:[],articles:0};
  store.transaction(()=>{
    store.db.prepare("UPDATE campaigns SET state='running' WHERE id=?").run(campaignId);
    // Legacy seeds may lack campaign_id. Only recover provenance demonstrated by
    // an observed source that was actually scheduled by this archive campaign.
    for(const e of store.db.prepare(`SELECT DISTINCT e.id FROM events e JOIN observations o ON o.event_id=e.id JOIN documents d ON d.id=o.document_id JOIN jobs j ON j.kind='article' AND j.job_key=d.url WHERE e.campaign_id IS NULL AND e.merged_into IS NULL AND e.state!='excluded' AND json_extract(j.payload,'$.campaignId')=?`).all(campaignId)){
      store.db.prepare('UPDATE events SET campaign_id=? WHERE id=?').run(campaignId,e.id);report.linked.push(e.id);
    }
    for(const row of store.db.prepare("SELECT id,revision,published_revision FROM events WHERE campaign_id=? AND merged_into IS NULL AND state!='excluded'").all(campaignId)){
      if(row.published_revision===row.revision)continue;
      const review=store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(row.id,row.revision);
      const verdict=review?JSON.parse(review.payload).verdict:null;
      if(verdict==='reject')continue;
      const prepared=store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(row.id,row.revision);
      const translated=store.db.prepare("SELECT 1 FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(row.id,row.revision);
      const localized=store.db.prepare('SELECT 1 FROM site_translations WHERE event_id=? AND revision=?').get(row.id,row.revision);
      const kind=!prepared?'prepare':verdict!=='pass'?'review':!translated?'translate':!localized?'localize':null;
      if(!kind)continue;
      // The corrected reviewer makes a fresh decision; previous failing repair
      // formats must not consume the two successful editorial repair attempts.
      store.db.prepare('UPDATE events SET auto_repairs=0 WHERE id=?').run(row.id);
      // Superseded failed editorial jobs are retained as history, but cannot
      // unexpectedly run their old repair in parallel with the new review.
      store.db.prepare("UPDATE jobs SET state='done',last_error=NULL WHERE json_extract(payload,'$.eventId')=? AND kind IN ('review','repair','prepare','translate','localize') AND state IN ('failed','queued','paused')").run(row.id);
      const key=kind==='review'?`${row.id}:${row.revision}`:String(row.id);
      store.enqueue(kind,key,{eventId:row.id,revision:row.revision,campaignId,budgetScope:'archive'});
      store.db.prepare('UPDATE jobs SET attempts=0,last_error=NULL,due_at=? WHERE kind=? AND job_key=?').run(new Date().toISOString(),kind,key);
      report.queued.push({id:row.id,revision:row.revision,kind});
    }
    // Retry failed archive articles after prepared cards (queue priority), with
    // the same archive allowance. New daily RSS articles are never touched.
    for(const job of store.db.prepare("SELECT * FROM jobs WHERE kind='article' AND state='failed' AND json_extract(payload,'$.campaignId')=?").all(campaignId)){
      store.enqueue(job.kind,job.job_key,{...JSON.parse(job.payload),campaignId,budgetScope:'archive'});
      store.db.prepare('UPDATE jobs SET attempts=0,last_error=NULL,due_at=? WHERE id=?').run(new Date().toISOString(),job.id);report.articles++;
    }
    store.log('archive-recovered',marker,report);
  });
  return report;
}
