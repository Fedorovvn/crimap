import {DatabaseSync} from 'node:sqlite';
import {fail} from './editorial.mjs';

export function changeBudget(store,id,budget,reviewer){
  if(typeof budget!=='number'||!Number.isFinite(budget)||budget<=0||Math.abs(Math.round(budget*100)-budget*100)>1e-8)fail(400,'Укажите положительный лимит в долларах с точностью до цента');
  return store.transaction(()=>{
    const old=store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);if(!old)fail(404,'Обход не найден');
    const spent=store.db.prepare('SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) n FROM usage WHERE campaign_id=?').get(id).n;
    if(budget<spent)fail(409,`Уже потрачено или зарезервировано $${spent.toFixed(3)}; лимит не может быть меньше`);
    store.db.prepare('UPDATE campaigns SET budget_usd=? WHERE id=?').run(budget,id);
    store.log('budget-changed',id,{before:old.budget_usd,budget,spent,reviewer});return {budget,spent,remaining:budget-spent};
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
