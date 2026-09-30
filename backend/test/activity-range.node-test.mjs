import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {activityData} from '../activity.mjs';
import {activityRange} from '../activity-range.mjs';
import {usageDashboard} from '../usage-dashboard.mjs';
import {chartMarkup} from '../admin/charts.mjs';

test('custom interval applies both endpoints to costs, charts, stats, journal and filter outcomes',()=>{
 const s=new Store(':memory:');try{
  const dates=['2026-09-28T09:59:59.999Z','2026-09-28T10:00:00Z','2026-09-28T11:00:00.000Z','2026-09-28T11:00:00.001Z'];
  const put=s.db.prepare('INSERT INTO usage(request_key,stage,model,state,input_tokens,output_tokens,cost_usd,reserved_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const doc=s.saveDocument({url:'https://www.police.hu/test',sourceId:'police-brfk',sourceKind:'official',title:'Test',text:'Test text'});
  dates.forEach((at,i)=>{
   put.run('usage'+i,'triage',i===2?'deepseek-pro':'deepseek-flash','complete',100,10,.1,0,at);
   s.db.prepare('INSERT INTO audit(action,subject,detail,created_at) VALUES(?,?,?,?)').run('feed-polled','police-brfk','{"queued":1,"filtered":2}',at);
   s.db.prepare('INSERT INTO triage_log VALUES(?,?,?,?,?,?)').run(doc.id,'hash'+i,0,'flash-short','Test',at);
  });
  const now=new Date('2026-09-29T00:00:00Z'),from='2026-09-28T12:00:00+02:00',to='2026-09-28T13:00:00+02:00';
  const r=activityData(s,{now,period:'custom',from,to});
  assert.equal(r.logs.length,2);assert.equal(r.stats.newArticles,2);assert.equal(r.stats.filtered,6);
  assert.equal(r.usage.totals.calls,2);assert.equal(r.usage.totals.tokens,220);assert.equal(r.usage.totals.cost,.2);
  assert.ok(r.usage.steps.find(x=>x.id==='triage').results.includes('Отсеяно Flash: 2'));
  assert.equal(r.usage.byDay[0].tokens,220);
  const groups=r.usage.series.points.flatMap(p=>[p.flash,p.pro,p.other]);
  for(const key of ['calls','tokens','cost'])assert.ok(Math.abs(groups.reduce((n,g)=>n+g[key],0)-r.usage.totals[key])<1e-9);
  s.enqueue('review','live',{},'2026-09-30T00:00:00Z');
  assert.equal(activityData(s,{now,period:'custom',from,to}).queue.length,1,'current queue is not historical');
 }finally{s.close();}
});
test('invalid ranges reject, future end clamps and empty histories have usable bounds',()=>{
 const s=new Store(':memory:');try{
  const now=new Date('2026-09-30T12:00:00Z');
  for(const [from,to] of [['bad','bad'],['2026-09-30','2026-10-01'],['2026-09-30T11:00:00Z','2026-09-30T10:00:00Z'],['2026-10-01T00:00:00Z','2026-10-02T00:00:00Z']])assert.throws(()=>activityRange(s.db,{now,period:'custom',from,to}),e=>e.status===400);
  assert.equal(activityRange(s.db,{now,period:'custom',from:'2026-09-30T11:00:00Z',to:'2026-10-01T00:00:00Z'}).until,now.toISOString());
  assert.equal(Date.parse(activityRange(s.db,{now,period:'month'}).since),now.getTime()-30*86400000);
  const empty=usageDashboard(s,'2026-09-01T00:00:00Z',now.toISOString());
  assert.ok(empty.series.points.length<=120);assert.equal(empty.totals.tokens,0);
  assert.match(chartMarkup(empty,'tokens',340),/нет данных для графика/);
 }finally{s.close();}
});
test('chart buckets preserve zero gaps, unresolved costs and unknown models',()=>{
 const s=new Store(':memory:');try{
  const insert=s.db.prepare('INSERT INTO usage(request_key,stage,model,state,input_tokens,output_tokens,cost_usd,reserved_usd,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
  insert.run('a','review','deepseek-pro','complete',10,0,.1,0,'2026-09-28T01:00:00Z');
  insert.run('b','legacy','unrecognized-model','reserved',0,0,null,.2,'2026-09-28T03:00:00Z');
  const r=usageDashboard(s,'2026-09-28T00:00:00Z','2026-09-28T05:00:00Z');
  assert.equal(r.series.points.length,5);assert.equal(r.series.points[1].pro.tokens,10);assert.equal(r.series.points[3].other.calls,1);assert.equal(r.series.points[2].pro.calls,0);
  assert.equal(r.series.points.reduce((n,p)=>n+p.pro.tokens,0),10);
  assert.equal(r.series.points.reduce((n,p)=>n+p.other.calls,0),1);
  assert.equal(r.totals.reserved,.2);
  const html=chartMarkup(r,'calls',340);assert.match(html,/Другие/);assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
 }finally{s.close();}
});
