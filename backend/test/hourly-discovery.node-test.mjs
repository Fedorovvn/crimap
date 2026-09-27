import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {discoverFeed} from '../discovery.mjs';
import {feeds,LIVE_SOURCE_IDS} from '../sources.mjs';
const feed={url:'https://www.police.hu/hu/rss/feed',sourceId:'police-national'};
const time=s=>new Date(`2026-09-${s}Z`),start=time('27T09:00:00'),later=time('27T12:00:00');
const xml=(ids,title='Budapesti késelés',date='2026-09-27T10:00:00Z')=>'<rss><channel>'+ids.map(id=>`<item><title>${title}</title><link>https://www.police.hu/article-${id}</link><pubDate>${date}</pubDate></item>`).join('')+'</channel></rss>';
const reader=body=>({read:async()=>({body,url:feed.url})});
test('all configured source feeds use an hourly cadence',()=>{
 assert.ok(feeds(LIVE_SOURCE_IDS).length);assert.ok(feeds(LIVE_SOURCE_IDS).every(f=>f.intervalSeconds===3600));
});
test('first poll is a baseline; stale historical arrivals and baseline metadata changes are not imported',async()=>{
 const s=new Store(':memory:');try{
 assert.equal((await discoverFeed(s,reader(xml([0])),feed,{now:later})).queued,0);
 assert.equal((await discoverFeed(s,reader(xml([0,1])),feed,{now:time('28T12:00:00')})).queued,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
 }finally{s.close();}
});
test('cross-feed repeats, changed metadata and tracking parameters cannot restart completed or paused work',async()=>{
 const s=new Store(':memory:');try{
 const other={...feed,url:feed.url+'/other'};
 for(const f of [feed,other])await discoverFeed(s,reader(xml([])),f,{now:start});
 assert.equal((await discoverFeed(s,reader(xml([0])),feed,{now:later})).queued,1);
 s.db.prepare("UPDATE jobs SET state='done'").run();
 assert.equal((await discoverFeed(s,reader(xml(['0?utm_source=other'],'Changed title')),other,{now:later})).queued,0);
 s.enqueue('article','https://www.police.hu/article-1',{campaignId:'old'});s.db.prepare("UPDATE jobs SET state='paused' WHERE job_key LIKE '%article-1'").run();
 assert.equal((await discoverFeed(s,reader(xml([1])),other,{now:later})).queued,0);
 assert.deepEqual(s.db.prepare('SELECT state FROM jobs ORDER BY id').all().map(j=>j.state),['done','paused']);
 }finally{s.close();}
});
test('free rejections are remembered, failures do not advance the cursor, and delayed RSS survives downtime',async()=>{
 const s=new Store(':memory:');try{
 await discoverFeed(s,reader(xml([])),feed,{now:start});
 assert.equal((await discoverFeed(s,reader(xml([0],'Menetrend változás')),feed,{now:later})).filtered,1);
 await assert.rejects(discoverFeed(s,{read:async()=>{throw new Error('offline');}},feed,{now:time('28T12:00:00')}),/offline/);
 assert.equal(s.db.prepare('SELECT checked_at FROM source_polls').get().checked_at,later.toISOString());
 const result=await discoverFeed(s,reader(xml([0,1])),feed,{now:time('30T12:00:00')});
 assert.equal(result.queued,1);assert.equal(result.unchanged,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM usage').get().n,0);
 }finally{s.close();}
});
test('old persisted receipts migrate without resetting the baseline',async()=>{
 const s=new Store(':memory:');try{
 s.db.exec('CREATE TABLE feed_entries(feed_url TEXT,article_url TEXT,fingerprint TEXT,seen_at TEXT,PRIMARY KEY(feed_url,article_url)); CREATE TABLE source_polls(feed_url TEXT PRIMARY KEY,source_id TEXT,checked_at TEXT,item_count INTEGER,queued_count INTEGER,filtered_count INTEGER);');
 s.db.prepare('INSERT INTO source_polls VALUES(?,?,?,?,?,?)').run(feed.url,feed.sourceId,start.toISOString(),1,0,0);
 s.db.prepare('INSERT INTO feed_entries VALUES(?,?,?,?)').run(feed.url,'https://www.police.hu/article-0','old',start.toISOString());
 assert.equal((await discoverFeed(s,reader(xml([0,1])),feed,{now:later})).queued,1);
 assert.equal(s.db.prepare('SELECT started_at FROM source_polls').get().started_at,start.toISOString());
 }finally{s.close();}
});
test('automatic enqueue respects manual archive pause while daily discovery continues',()=>{
 const s=new Store(':memory:');try{
 s.db.prepare('INSERT INTO campaigns(id,from_date,to_date,budget_usd,state,created_at) VALUES(?,?,?,?,?,?)').run('old','2026-07-01','2026-09-26',30,'paused',start.toISOString());
 s.enqueue('prepare','1',{campaignId:'old'});
 s.enqueue('article','new',{budgetScope:'daily'});
 assert.equal(s.db.prepare("SELECT state FROM campaigns WHERE id='old'").get().state,'paused');
 assert.equal(s.db.prepare("SELECT state FROM jobs WHERE job_key='1'").get().state,'paused');
 s.db.prepare("UPDATE jobs SET state='queued' WHERE job_key='1'").run();
 assert.equal(s.claim().job_key,'new');assert.equal(s.claim(),null);
 }finally{s.close();}
});

