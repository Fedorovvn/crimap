import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {activityData} from '../activity.mjs';
import {Pipeline} from '../pipeline.mjs';
const stamp='2026-09-27T12:00:00.000Z';
const put=(s,id,mark='normal')=>s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,occurred_at,editorial_mark) VALUES(?,?,?,?,?,?)').run(id,'event-'+id,stamp,JSON.stringify({title:'Event '+id,occurredAt:stamp,location:{label:'Budapest'},participants:[]}),stamp,mark);
test('activity shows current queue priority, scheduled jobs, safe error reasons and linked source decisions',()=>{
 const s=new Store(':memory:');try{
  put(s,1);put(s,2,'priority');s.enqueue('review','1',{eventId:1},stamp);s.enqueue('review','2',{eventId:2},stamp);
  s.enqueue('feed','feed',{sourceId:'police-brfk',url:'https://www.police.hu/feed',intervalSeconds:3600},'2026-09-27T13:00:00Z');
  s.log('feed-article-filtered','police-brfk',{url:'https://www.police.hu/article?token=private',title:'Article',reason:'Routine traffic report'});
  s.db.prepare('UPDATE audit SET created_at=?').run(stamp);
  const job=s.claim(stamp,['review']);assert.equal(job.payload.eventId,2);
  s.db.prepare('UPDATE jobs SET last_error=? WHERE id=?').run('Total model budget reached sk-secret',job.id);
  const r=activityData(s,{now:new Date(stamp)});assert.equal(r.queue[0].eventId,2);assert.equal(r.counts.running,1);assert.equal(r.counts.scheduled,1);
  assert.equal(r.logs[0].category,'filtered');assert.equal(r.logs[0].url,'https://www.police.hu/article');assert.equal(r.logs[0].sourceId,'police-brfk');
  assert.ok(!JSON.stringify(r).includes('sk-secret'));assert.ok(!JSON.stringify(r).includes('token=private'));
  assert.equal(activityData(s,{now:new Date(stamp),category:'duplicates'}).logs.length,0);
 }finally{s.close();}
});
test('journal uses stable pagination; source filter and counts agree and excludes raw model responses',()=>{
 const s=new Store(':memory:');try{
  for(let i=0;i<70;i++)s.log('feed-polled','police-brfk',{items:10,queued:1,filtered:2,unchanged:7});
  s.log('feed-polled','kekvillogo',{items:9,queued:3});s.log('model-validation-failure','private',{response:'private raw response'});
  s.db.prepare('UPDATE audit SET created_at=?').run(stamp);
  const first=activityData(s,{now:new Date(stamp),source:'police-brfk'}),second=activityData(s,{now:new Date(stamp),source:'police-brfk',before:first.nextBefore});
  assert.equal(first.logs.length,60);assert.equal(second.logs.length,10);assert.equal(first.stats.newArticles,70);assert.equal(first.stats.filtered,140);
  assert.equal(new Set([...first.logs,...second.logs].map(r=>r.id)).size,70);assert.equal(second.nextBefore,null);
  assert.ok(!JSON.stringify(first).includes('private raw response'));
 }finally{s.close();}
});
test('stopping archive discovery preserves priority processing but prevents old article jobs from being claimed or re-enqueued',()=>{
 const s=new Store(':memory:');try{
  s.db.prepare("INSERT INTO campaigns(id,from_date,to_date,budget_usd,state,created_at) VALUES('archive','a','b',40,'running',?)").run(stamp);
  s.enqueue('article','old',{campaignId:'archive',url:'https://www.police.hu/old'},stamp);
  put(s,1,'priority');s.db.prepare("UPDATE events SET campaign_id='archive' WHERE id=1").run();s.enqueue('review','1',{eventId:1},stamp);
  s.db.prepare('UPDATE campaigns SET discovery_stopped=1').run();
  assert.equal(s.enqueue('archive','more',{campaignId:'archive'},stamp),false);
  const j=s.claim(stamp);assert.equal(j.kind,'review');s.finish(j);assert.equal(s.claim(stamp),null);
 }finally{s.close();}
});
test('worker records start and finish separately from a recurring next run',async()=>{
 const s=new Store(':memory:');try{
  s.enqueue('feed','https://www.police.hu/feed',{url:'https://www.police.hu/feed',sourceId:'police-brfk',intervalSeconds:3600});
  const p=new Pipeline(s,{reader:{read:async url=>({url,body:'<rss><channel></channel></rss>'})}});
  assert.equal(await p.runOne(),true);
  const logs=s.db.prepare("SELECT action,detail FROM audit WHERE action IN ('job-started','job-finished') ORDER BY id").all();
  assert.equal(logs.length,2);assert.equal(JSON.parse(logs[1].detail).outcome,'complete');assert.equal(JSON.parse(logs[1].detail).state,'queued');
 }finally{s.close();}
});
