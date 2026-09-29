import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {syncDiscoverySources} from '../discovery.mjs';
import {feeds,LIVE_SOURCE_IDS,sourceFor} from '../sources.mjs';
import {Pipeline} from '../pipeline.mjs';

test('retired discovery queues stop but evidence, published follow-ups and search jobs survive',()=>{
 const s=new Store(':memory:');try{
  for(const feed of feeds(['police-brfk','kekvillogo','index','telex']))s.enqueue('feed',feed.url,feed);
  s.enqueue('article','https://index.hu/new',{url:'https://index.hu/new',discoveredBy:'index'});
  s.enqueue('article','https://index.hu/search',{url:'https://index.hu/search'});
  const d=s.saveDocument({url:'https://index.hu/known',sourceId:'index',sourceKind:'media',text:'Known source.',title:'Known'});
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('known',new Date().toISOString(),'{}');
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,?,?,?,?)').run(d.id,d.contentHash,'{}',new Date().toISOString());
  s.enqueue('article',d.url,{url:d.url,discoveredBy:'index'});
  syncDiscoverySources(s,LIVE_SOURCE_IDS);syncDiscoverySources(s,LIVE_SOURCE_IDS);
  const state=url=>s.db.prepare('SELECT state FROM jobs WHERE job_key=?').get(url).state;
  assert.equal(state('https://index.hu/new'),'cancelled');assert.equal(state('https://index.hu/search'),'queued');assert.equal(state(d.url),'queued');
  assert.deepEqual(s.db.prepare("SELECT payload FROM jobs WHERE kind='feed' AND state='queued' ORDER BY id").all().map(r=>JSON.parse(r.payload).sourceId),['police-brfk','kekvillogo']);
  assert.equal(s.db.prepare('SELECT count(*) n FROM observations').get().n,1);
  assert.equal(sourceFor('https://index.hu/belfold/story').id,'index');
  syncDiscoverySources(s,['index']);assert.equal(state(feeds(['index'])[0].url),'queued');
 }finally{s.close();}
});

test('already queued disabled feed cannot fetch or reschedule through a worker',async()=>{
 const s=new Store(':memory:');try{
  const feed=feeds(['telex'])[0];s.enqueue('feed',feed.url,feed);
  const p=new Pipeline(s,{sourceIds:LIVE_SOURCE_IDS,reader:{read(){throw Error('Disabled feed fetched');}}});
  assert.equal(await p.runOne({kinds:['feed']}),true);assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='feed'").get().state,'done');
 }finally{s.close();}
});
