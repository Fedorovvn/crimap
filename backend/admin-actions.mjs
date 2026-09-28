import {DatabaseSync} from 'node:sqlite';
import {fail} from './editorial.mjs';
import {interestReasons} from './admin/interest-reasons.mjs';
import {queueEditorialPreparation,stopEventJobs} from './editorial-workflow.mjs';
import {nextCheck} from './scheduler.mjs';

export function retryEvent(store,id,revision,reviewer){
  return store.transaction(()=>{
    const e=store.event(id);if(!e)fail(404,'Событие не найдено');
    if(e.revision!==revision)fail(409,'Есть новая версия события. Обновите карточку');
    if(store.holdForFatality(id))return {awaitingFatality:true};
    if(e.merged_into||e.state==='excluded'||e.editorial_mark==='uninteresting'||e.withdrawn_at)fail(409,'Сначала верните событие в обработку');
    const jobs=store.db.prepare("SELECT * FROM jobs WHERE json_extract(payload,'$.eventId')=? AND state IN ('running','queued','failed','paused','waiting-date') AND (json_extract(payload,'$.revision') IS NULL OR json_extract(payload,'$.revision')=?)").all(id,e.revision);
    if(jobs.some(j=>j.state==='running'))return {alreadyQueued:true};
    const stopped=jobs.filter(j=>['failed','paused'].includes(j.state));
    if(!stopped.length){if(jobs.some(j=>j.state==='queued'))return {alreadyQueued:true};fail(409,'Остановленных задач нет. Обновите карточку');}
    if(e.campaign_id&&store.db.prepare('SELECT state FROM campaigns WHERE id=?').get(e.campaign_id)?.state==='paused')fail(409,'Архивная обработка на паузе. Сначала возобновите её');
    if(store.totalBudget()?.remaining<=0)fail(409,'Общий бюджет исчерпан. Сначала увеличьте лимит');
    const prepared=store.db.prepare('SELECT 1 FROM preparation WHERE event_id=? AND revision=?').get(id,e.revision);
    const kind=!e.canonical.occurredAt?'resolve-date':stopped.every(j=>j.kind==='recheck')?'recheck':prepared?'review':'gather';
    const translationReset=stopped.some(j=>/translation|numeric tokens|digit tokens/i.test(j.last_error??''));
    // Keep gathered evidence and media. Invalid translation drafts must not be
    // fed back to Pro unchanged on every manual retry.
    if(translationReset){
      store.db.prepare('DELETE FROM translations WHERE event_id=? AND revision=?').run(id,e.revision);
      store.db.prepare('DELETE FROM site_translations WHERE event_id=? AND revision=?').run(id,e.revision);
    }
    if(kind!=='recheck')store.db.prepare('DELETE FROM quality_reviews WHERE event_id=? AND revision=?').run(id,e.revision);
    for(const j of jobs)if(j.state!=='running'&&(j.kind!=='recheck'||['failed','paused'].includes(j.state)))store.db.prepare("UPDATE jobs SET state='cancelled',rerun=0,lease_token=NULL,lease_until=NULL WHERE id=?").run(j.id);
    const key=kind==='review'?`${id}:${e.revision}`:String(id);
    store.enqueue(kind,key,{eventId:id,revision:e.revision,campaignId:kind==='recheck'?null:e.campaign_id});
    store.db.prepare("UPDATE jobs SET attempts=0,last_error=NULL WHERE kind=? AND job_key=? AND state!='running'").run(kind,key);
    store.log('editorial-retry',id,{revision:e.revision,kind,translationReset,reviewer});
    return {queued:kind,translationReset};
  });
}

export function setEditorialMark(store,id,mark,reviewer,{reasons=[],note='',publicPath=process.env.DATABASE_PATH}={}){
  if(!['normal','uninteresting','priority'].includes(mark))fail(400,'Неизвестная отметка события');
  if(!Array.isArray(reasons)||reasons.length>10||reasons.some(r=>typeof r!=='string'||!Object.hasOwn(interestReasons,r))||typeof note!=='string'||note.length>2000)fail(400,'Выберите причины из списка; комментарий — до 2000 символов');
  reasons=mark==='uninteresting'?[...new Set(reasons)]:[];note=mark==='uninteresting'?note.trim():'';
  return store.transaction(()=>{
    const event=store.event(id);if(!event)fail(404,'Событие не найдено');
    if(event.merged_into)fail(409,'Событие уже объединено. Откройте основную карточку');
    const changed=event.editorial_mark!==mark||event.editorial_reasons!==JSON.stringify(reasons)||event.editorial_note!==note;
    let stopped=0,queued=false;
    if(changed){
      store.db.prepare('UPDATE events SET editorial_mark=?,editorial_reasons=?,editorial_note=? WHERE id=?').run(mark,JSON.stringify(reasons),note,id);
      if(mark==='uninteresting'){
        stopped=stopEventJobs(store,id);
        store.db.prepare('UPDATE events SET next_check_at=NULL WHERE id=?').run(id);
      }else{
        if(mark==='priority'||event.editorial_mark==='uninteresting')queued=queueEditorialPreparation(store,id,publicPath);
        if(event.editorial_mark==='uninteresting'){
          const next=nextCheck(event);if(next)store.enqueue('recheck',id,{eventId:id},next);
          for(const doc of store.db.prepare('SELECT DISTINCT d.url,d.published_at FROM ignored_updates i JOIN documents d ON d.id=i.document_id WHERE i.event_id=?').all(id))store.enqueue('article',doc.url,{url:doc.url,publishedAt:doc.published_at,eventId:id,revisitIgnoredEvent:id,campaignId:event.campaign_id});
        }
      }
      store.log('editorial-mark-changed',id,{before:event.editorial_mark,mark,reasons,note,reviewer,stopped,queued});
    }
    return {id,editorial_mark:mark,stopped,queued,awaitingDate:!event.canonical.occurredAt};
  });
}

export function changeBudget(store,id,budget,reviewer){
  if(store.totalBudget())fail(409,'Используйте общий бюджет моделей');
  if(typeof budget!=='number'||!Number.isFinite(budget)||budget<=0||Math.abs(Math.round(budget*100)-budget*100)>1e-8)fail(400,'Укажите положительный лимит в долларах с точностью до цента');
  return store.transaction(()=>{
    const old=store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!old)fail(404,'Обход не найден');
    const spent=store.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage WHERE campaign_id=?').get(id).n;
    if(budget<spent)fail(409,`Уже потрачено или зарезервировано $${spent.toFixed(3)}; лимит не может быть меньше`);
    store.db.prepare('UPDATE campaigns SET budget_usd=? WHERE id=?').run(budget,id);
    store.log('budget-changed',id,{before:old.budget_usd,budget,spent,reviewer});return {budget,spent,remaining:budget-spent};
  });
}
export function changeTotalBudget(store,budget,reviewer){
  if(typeof budget!=='number'||!Number.isFinite(budget)||budget<=0||Math.abs(Math.round(budget*100)-budget*100)>1e-8)fail(400,'Укажите положительный общий лимит с точностью до цента');
  return store.transaction(()=>{
    const old=store.totalBudget();
    const spent=store.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage').get().n;
    if(budget<spent)fail(409,`Уже потрачено или зарезервировано $${spent.toFixed(3)}; общий лимит не может быть меньше`);
    const now=new Date().toISOString();
    store.db.prepare('INSERT OR REPLACE INTO model_budget VALUES(1,?,?)').run(budget,now);
    const resumed=store.db.prepare(`UPDATE jobs SET state='queued',due_at=?,last_error=NULL,attempts=0,rerun=0,lease_until=NULL,lease_token=NULL
      WHERE state IN ('queued','paused') AND last_error IN ('Daily model budget reached','Total model budget reached')
      AND NOT EXISTS(SELECT 1 FROM campaigns c WHERE c.id=json_extract(jobs.payload,'$.campaignId') AND c.state='paused')
      AND NOT EXISTS(SELECT 1 FROM events e WHERE e.id=json_extract(jobs.payload,'$.eventId') AND (e.editorial_mark='uninteresting' OR e.merged_into IS NOT NULL OR e.state='excluded'))`).run(now).changes;
    store.log('total-budget-changed','models',{before:old?.limit??null,limit:budget,spent,resumed,reviewer});
    return {...store.totalBudget(),resumed};
  });
}
export function resumeCampaign(store,id,reviewer){
  return store.transaction(()=>{
    const campaign=store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
    if(!campaign)fail(404,'Обход не найден');
    const pending=store.db.prepare("SELECT count(*) n FROM jobs WHERE json_extract(payload,'$.campaignId')=? AND state IN ('paused','queued','running')").get(id).n;
    if(!pending)return {resumed:0,state:campaign.state};
    const spent=store.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage WHERE campaign_id=?').get(id).n;
    if(spent>=campaign.budget_usd)fail(409,'Бюджет исчерпан. Увеличьте и сохраните лимит перед продолжением');
    const resumed=store.db.prepare("UPDATE jobs SET state='queued',attempts=0,last_error=NULL,lease_token=NULL,lease_until=NULL,due_at=? WHERE state='paused' AND json_extract(payload,'$.campaignId')=?").run(new Date().toISOString(),id).changes;
    store.db.prepare("UPDATE campaigns SET state='running' WHERE id=?").run(id);
    if(resumed||campaign.state!=='running')store.log('campaign-resumed',id,{resumed,budget:campaign.budget_usd,spent,reviewer});
    return {resumed,state:'running'};
  });
}
export function setPublicHidden(path,slug,hidden){
  const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try{
    const e=db.prepare('SELECT id FROM incidents WHERE slug=?').get(slug);if(!e)fail(404,'Опубликованная карточка не найдена');
    const m=db.prepare('SELECT details FROM incident_metadata WHERE incident_id=?').get(e.id);
    db.prepare('INSERT OR REPLACE INTO incident_metadata VALUES(?,?)').run(e.id,JSON.stringify({...m?JSON.parse(m.details):{},hidden}));
    db.exec('COMMIT');return e.id;
  }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
export function withdraw(store,id,path,{revision,reviewer}){
  return store.transaction(()=>{
    const row=store.event(id);if(!row)fail(404,'Событие не найдено');
    if(row.revision!==revision)fail(409,'Есть новая версия события. Обновите карточку');
    if(row.merged_into)fail(409,'Событие уже объединено');
    if(!row.public_id)fail(409,'Карточка ещё не опубликована');
    setPublicHidden(path,row.slug,true);
    const now=new Date().toISOString();
    store.db.prepare("UPDATE events SET withdrawn_at=?,published_revision=NULL,state='draft' WHERE id=?").run(now,id);
    store.log('withdrawn',id,{reviewer,revision,publicId:row.public_id});return {withdrawn:true};
  });
}
