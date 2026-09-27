import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {changeBudget,resumeCampaign} from '../admin-actions.mjs';

test('continue respects the saved cap, resumes only paused archive work and is idempotent',()=>{
  const store=new Store(':memory:'),now=new Date().toISOString();
  try{
    for(const id of ['archive','other'])store.db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?)').run(id,'a','b',5,'running',now);
    store.reserveCost('review','fixture','reserved',5,1,now,'archive');
    for(const [key,campaignId,state] of [['paused','archive','paused'],['running','archive','running'],['done','archive','done'],['failed','archive','failed'],['other','other','paused'],['daily',null,'paused']]){
      store.enqueue('article',key,campaignId?{campaignId}:{});
      store.db.prepare('UPDATE jobs SET state=?,attempts=3,last_error=?,lease_token=?,lease_until=? WHERE job_key=?').run(state,'previous error','lease',now,key);
    }
    store.db.prepare("UPDATE campaigns SET state='budget-exhausted' WHERE id='archive'").run();
    const jobs=()=>store.db.prepare('SELECT * FROM jobs ORDER BY job_key').all();
    const before=jobs();
    assert.throws(()=>resumeCampaign(store,'missing','editor'),/Обход не найден/);
    assert.throws(()=>resumeCampaign(store,'archive','editor'),/Бюджет исчерпан/);
    assert.deepEqual(jobs(),before);
    changeBudget(store,'archive',10,'editor');
    assert.deepEqual(jobs(),before);
    assert.equal(store.db.prepare("SELECT state FROM campaigns WHERE id='archive'").get().state,'budget-exhausted');
    assert.deepEqual(resumeCampaign(store,'archive','editor'),{resumed:1,state:'running'});
    const after=jobs(),resumed=after.find(j=>j.job_key==='paused');
    assert.equal(resumed.state,'queued');assert.equal(resumed.attempts,0);assert.equal(resumed.last_error,null);assert.equal(resumed.lease_token,null);assert.equal(resumed.lease_until,null);
    assert.deepEqual(after.filter(j=>j.job_key!=='paused'),before.filter(j=>j.job_key!=='paused'));
    assert.deepEqual(resumeCampaign(store,'archive','editor'),{resumed:0,state:'running'});
    assert.deepEqual(jobs(),after);
    assert.equal(store.db.prepare("SELECT budget_usd FROM campaigns WHERE id='archive'").get().budget_usd,10);
    store.db.prepare("UPDATE jobs SET state='done' WHERE json_extract(payload,'$.campaignId')='archive'").run();
    store.db.prepare("UPDATE campaigns SET state='complete' WHERE id='archive'").run();
    assert.deepEqual(resumeCampaign(store,'archive','editor'),{resumed:0,state:'complete'});
  }finally{store.close();}
});
