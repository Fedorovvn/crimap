import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {DeepSeek} from '../model.mjs';
import {usageDashboard} from '../usage-dashboard.mjs';

test('usage totals reconcile by stage, model and day; costs and unknown reserves stay separate',()=>{
 const s=new Store(':memory:');try{
  const put=s.db.prepare('INSERT INTO usage(request_key,stage,model,state,input_tokens,output_tokens,cost_usd,reserved_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  put.run('old','extract','flash','complete',999,999,9,10,'2026-09-25T12:00:00Z');
  put.run('a','compare','flash','complete',100,20,.01,.1,'2026-09-26T12:00:00Z');
  put.run('b','review','pro','failed',200,30,.02,.2,'2026-09-27T12:00:00Z');
  put.run('c','review','pro','reserved',0,0,null,.3,'2026-09-27T12:00:00Z');
  put.run('d','legacy','old-model','failed',0,0,null,.4,'2026-09-27T12:00:00Z');
  const r=usageDashboard(s,'2026-09-26');
  assert.deepEqual(r.totals,{calls:4,input:300,output:50,tokens:350,cost:.03,reserved:.7,failed:2});
  for(const dimension of [r.steps,r.models])for(const field of ['calls','input','output','tokens','cost','reserved','failed'])assert.ok(Math.abs(dimension.reduce((n,x)=>n+x[field],0)-r.totals[field])<1e-10);
  assert.equal(r.byDay.reduce((n,d)=>n+d.tokens,0),350);
  assert.deepEqual(r.byDay.map(d=>d.day),['2026-09-26','2026-09-27']);
  assert.equal(r.steps.find(s=>s.id==='other').calls,1);
  assert.equal(r.steps.find(s=>s.id==='review').rows[0].reserved,.3);
 }finally{s.close();}
});

test('filter outcomes and final review verdicts retain their distinct units and period',()=>{
 const s=new Store(':memory:');try{
  for(const [action,detail] of [['feed-polled',{queued:5,filtered:8}],['repeat-skipped',{}],['events-merged',{}],['pro-final-editor',{verdict:'pass'}],['pro-final-editor',{verdict:'reject'}],['published',{}]])s.log(action,'1',detail);
  s.db.prepare("UPDATE audit SET created_at='2026-09-27T12:00:00Z'").run();
  s.db.prepare('INSERT INTO triage_log VALUES(?,?,?,?,?,?)').run(1,'a',0,'rules','Routine','2026-09-27T12:00:00Z');
  s.db.prepare('INSERT INTO triage_log VALUES(?,?,?,?,?,?)').run(2,'b',0,'flash-short','Off topic','2026-09-27T12:00:00Z');
  const r=usageDashboard(s,'2026-09-27');
  assert.ok(r.steps.find(s=>s.id==='discovery').results.includes('Отсеяно в лентах: 8'));
  assert.ok(r.steps.find(s=>s.id==='triage').results.includes('Отсеяно Flash: 1'));
  assert.ok(r.steps.find(s=>s.id==='review').results.includes('Пройдено: 1'));
  assert.ok(r.steps.find(s=>s.id==='review').results.includes('Отклонено: 1'));
  assert.equal(usageDashboard(s,'2026-09-28').totals.calls,0);
 }finally{s.close();}
});

test('invalid paid attempt remains charged and marked failed; validated cache hits add no tokens',async()=>{
 const s=new Store(':memory:');let calls=0;try{
  const model=new DeepSeek(s,{key:'fixture',fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:++calls===1?'{}':'{"valid":true}'}}],usage:{prompt_tokens:100,completion_tokens:20}}))});
  const options={validate:x=>{assert.equal(x.valid,true);return x;}};
  await model.json('extract',{test:true},options);await model.json('extract',{test:true},options);
  const r=usageDashboard(s,'2000');
  assert.equal(calls,2);assert.equal(r.cacheHits,1);assert.equal(r.totals.calls,2);assert.equal(r.totals.tokens,240);assert.equal(r.totals.failed,1);assert.equal(r.totals.reserved,0);assert.ok(r.totals.cost>0);
 }finally{s.close();}
});
