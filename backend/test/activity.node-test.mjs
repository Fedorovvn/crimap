import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {activityData,readableError,eventProcessing} from '../activity.mjs';
import {Pipeline} from '../pipeline.mjs';
const stamp='2026-09-27T12:00:00.000Z';
test('translation and merge failures do not pretend a new publication exists',()=>{
 assert.match(readableError('Site translation changed numbers: sample'),/Числа в переводе/);
 assert.match(readableError('Event changed during final review'),/новая версия/);
 assert.match(readableError('Flash identified a duplicate but merge needs retry'),/Flash/);
 assert.match(readableError('Geocoder daily request limit reached'),/отменён/);
});
const put=(s,id,mark='normal')=>s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,occurred_at,editorial_mark) VALUES(?,?,?,?,?,?)').run(id,'event-'+id,stamp,JSON.stringify({title:'Event '+id,occurredAt:stamp,location:{label:'Budapest'},participants:[]}),stamp,mark);

test('stopped status ignores old revisions and distinguishes automatic retries',()=>{
 const s=new Store(':memory:');try{
  put(s,1);const event={id:1,revision:2};
  s.enqueue('review','old',{eventId:1,revision:1},stamp);
  s.db.prepare("UPDATE jobs SET state='failed',last_error='private sk-secret'").run();
  assert.equal(eventProcessing(s,event).stopped,false);
  s.enqueue('prepare','current',{eventId:1,revision:2},stamp);
  s.db.prepare("UPDATE jobs SET last_error='timeout',attempts=1 WHERE job_key='current'").run();
  assert.equal(eventProcessing(s,event).retrying,true);
  assert.equal(eventProcessing(s,event).stopped,false);
  s.db.prepare("UPDATE jobs SET state='failed',attempts=3,last_error='Site translation changed numbers: sk-secret' WHERE job_key='current'").run();
  const result=eventProcessing(s,event);assert.equal(result.stopped,true);assert.equal(result.retrying,false);
  assert.match(result.issues[0].reason,/Числа в переводе/);assert.ok(!JSON.stringify(result).includes('sk-secret'));
  s.db.prepare("UPDATE jobs SET state='paused',last_error='Total model budget reached' WHERE job_key='current'").run();
  assert.match(eventProcessing(s,event).issues[0].reason,/бюджета/);
 }finally{s.close();}
});

test('filtered articles expose original headline, source, reason and whether rules or Flash rejected them',()=>{
 const s=new Store(':memory:');try{
  for(const method of ['rules','flash-short']){
   const doc=s.saveDocument({url:'https://www.police.hu/'+method,sourceId:'police-brfk',sourceKind:'official',title:'Headline '+method,text:'Article text'});
   s.db.prepare('INSERT INTO triage_log VALUES(?,?,?,?,?,?)').run(doc.id,doc.contentHash,0,method,'Routine police raid',stamp);
   s.log('document-processed',`${doc.id}:${doc.contentHash}`,{filtered:true,irrelevantReason:'Routine police raid'});
  }
  s.db.prepare('UPDATE audit SET created_at=?').run(stamp);
  const r=activityData(s,{now:new Date(stamp),category:'filtered'});
  assert.equal(r.logs.length,2);assert.deepEqual(r.logs.map(l=>l.label),['Отсеяно Flash','Отсеяно бесплатно']);
  assert.equal(r.logs[0].title,'Headline flash-short');assert.equal(r.logs[0].description,'Routine police raid');assert.equal(r.logs[0].url,'https://www.police.hu/flash-short');
 }finally{s.close();}
});
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
