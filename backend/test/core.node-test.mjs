import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { intervalFor,nextCheck,nextPendingFactCheck } from '../scheduler.mjs';
import { checkedUrl,publicAddress,robotsAllowed,Reader } from '../network.mjs';
import { parseFeed,parseArticle,sourceFor } from '../sources.mjs';
import { eventSchema,validateEvidence,applyTranslation,translationStrings } from '../contract.mjs';
import { Pipeline,matchCandidates } from '../pipeline.mjs';
import { DeepSeek,parseJsonResponse } from '../model.mjs';
import { checkReview,recordRequests } from '../review.mjs';
import { Search } from '../search.mjs';
import { publish,migratePublic } from '../publish.mjs';
import { DatabaseSync } from 'node:sqlite';
const url='https://www.police.hu/test-incident';
const quotation='On 20 September 2026 at 12:00 a robbery occurred at Test utca in Budapest. A 40-year-old man was detained. Police are investigating.';
function fixture(){return {title:'Robbery on Test utca',summary:'Police report a robbery in Budapest. A 40-year-old man was detained.',type:'robbery',status:'suspects-detained',occurredAt:'2026-09-20T12:00:00+02:00',timePrecision:'exact',location:{city:'Budapest',label:'Test utca',precision:'street'},signals:['suspect-detained'],caseReferences:[],participants:[{key:'suspect-40',role:'suspect',label:'40-year-old suspect',status:'detained',profile:{kind:'person',gender:'male',age:40},sourceUrl:url,sourceLabel:'police.hu',asOf:'2026-09-21T10:00:00Z'}],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','location','status','signals','occurredAt','participants.0','participants.0.status','participants.0.profile.age','participants.0.profile.gender'].map(field=>({field,documentId:'1',quote:quotation}))};}
const doc={id:'1',url,sourceId:'police-brfk',sourceKind:'official',text:quotation,title:'Robbery',imageUrls:[],publishedAt:'2026-09-21T10:00:00Z'};
test('scheduler covers the quiet cadence, Budapest daytime window and retirement',()=>{
  const start=Date.parse('2025-01-01T00:00:00Z'),event={occurredAt:new Date(start).toISOString()};
  for(const [age,expected] of [[0,900],[10799,900],[10800,14400],[86400,43200],[259200,86400],[864000,1209600],[2592000,2592000],[31536000,null]])assert.equal(intervalFor(event,start+age*1000),expected);
  // At 04:00 local, the next four-hour daytime check waits for 10:00 Budapest.
  assert.equal(nextCheck(event,start+3*3600000),'2025-01-01T09:00:00.000Z');
  // The two daily checks after the first day are at 10:00 and 18:00 local.
  assert.equal(nextCheck(event,start+35*3600000),'2025-01-02T17:00:00.000Z');
  assert.equal(nextCheck(event,start+31535999*1000),null);
  const undated={firstSeenAt:event.occurredAt};
  assert.equal(intervalFor(undated,start),900);
  for(const [age,next] of [[0,7200],[7200,14400],[14400,86400],[86400,259200],[259200,604800],[604800,null]])assert.equal(nextPendingFactCheck(undated,start+age*1000),next===null?null:new Date(start+next*1000).toISOString());
  assert.throws(()=>intervalFor(event,start-1));
});
test('queue leases survive restart and reject completion by stale owner',()=>{
  const dir=mkdtempSync(join(tmpdir(),'crimap-')),path=join(dir,'queue.sqlite');let store=new Store(path);
  try{store.enqueue('recheck','one',{},'2026-01-01T00:00:00.000Z');const first=store.claim('2026-01-01T00:00:00.000Z');store.close();store=new Store(path);assert.equal(store.claim('2026-01-01T00:01:00.000Z'),null);const recovered=store.claim('2026-01-01T00:16:00.000Z');assert.equal(recovered.id,first.id);assert.equal(store.finish(first),false);assert.equal(store.finish(recovered),true);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('spending reservations remain charged after failed calls',()=>{const s=new Store(':memory:');try{const id=s.reserveCost('extract','flash','a',.4,.5);s.usageFailed(id,'timeout');assert.throws(()=>s.reserveCost('extract','flash','b',.2,.5),/budget/);s.usageDone(id,10,10,.01);assert.ok(s.reserveCost('extract','flash','b',.2,.5));}finally{s.close();}});
test('source classification cannot be spoofed by a similar hostname',()=>{assert.equal(sourceFor('https://www.police.hu/news').kind,'official');assert.equal(sourceFor('https://police.hu.evil.example/news'),null);});
test('network rejects local, mapped and mixed DNS addresses',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','2002:7f00:1::','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  await assert.rejects(checkedUrl('https://example.com/',async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]));
  await assert.rejects(checkedUrl('https://user:password@example.com'));
});
test('robots wildcard, end anchors and allow precedence',()=>{const r='User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow: /*?secret=*\nDisallow: /end$';assert.equal(robotsAllowed(r,'/private/x'),false);assert.equal(robotsAllowed(r,'/private/open'),true);assert.equal(robotsAllowed(r,'/path?secret=x'),false);assert.equal(robotsAllowed(r,'/ending'),true);assert.equal(robotsAllowed(r,'/end'),false);});
test('conditional page requests reuse body and honor redirect robots',async()=>{const s=new Store(':memory:');let count=0;const reader=new Reader(s,{minDelayMs:0,request:async(u,options)=>{if(u.endsWith('/robots.txt'))return {status:200,body:'User-agent: *\nDisallow: /blocked',headers:{}};count++;if(count===2){assert.equal(options.headers['If-None-Match'],'v1');return {status:304,headers:{}};}await assert.rejects(options.beforeRedirect('https://www.police.hu/blocked'));return {status:200,body:'<article>hello</article>',url:u,headers:{'content-type':'text/html',etag:'v1'}};}});try{const a=await reader.read(url),b=await reader.read(url);assert.equal(a.body,b.body);assert.equal(b.unchanged,true);}finally{s.close();}});
test('feed and article parsing do not execute scripts and keep evidence text',()=>{assert.equal(parseFeed('<rss><channel><item><link>https://www.police.hu/news</link><title>A</title></item></channel></rss>',url).length,1);assert.throws(()=>parseFeed('<!DOCTYPE rss><rss/>',url));const a=parseArticle({url,body:`<html lang="hu"><article><h1>Title</h1><p>${quotation}</p><script>throw new Error('unsafe')</script></article></html>`});assert.ok(a.text.includes(quotation));assert.ok(!a.text.includes('unsafe'));});
test('evidence rejects hallucinated quotes, absent personal proof and unseen source URLs',()=>{const e=fixture();assert.ok(validateEvidence(eventSchema.parse(e),[doc]));e.evidence[0].quote='Invented';assert.throws(()=>validateEvidence(e,[doc]),/quotation/);const missing=fixture();missing.evidence=missing.evidence.filter(e=>e.field!=='participants.0.profile.age');assert.throws(()=>validateEvidence(missing,[doc]),/age/);const unseen=fixture();unseen.participants[0].sourceUrl='https://evil.example/';assert.throws(()=>validateEvidence(unseen,[doc]),/not read/);});
test('translation cannot drop fields or change numbers',()=>{const e=fixture(),strings=translationStrings(e);assert.ok(applyTranslation(e,{language:'ru',strings}));assert.throws(()=>applyTranslation(e,{language:'ru',strings:{}}));assert.throws(()=>applyTranslation(e,{language:'ru',strings:{...strings,summary:'41 arrested'}}),/numbers/);});
test('image URL evidence must be observed and cannot prove non-media facts',()=>{const e=fixture(),image='https://www.police.hu/photo.jpg';e.evidence.push({field:'media.0.imageUrl',documentId:'1',quote:image});assert.ok(validateEvidence(e,[{...doc,imageUrls:[image]}]));assert.throws(()=>validateEvidence(e,[doc]),/quotation/);e.evidence.at(-1).field='participants.0.profile.name';assert.throws(()=>validateEvidence(e,[{...doc,imageUrls:[image]}]),/quotation/);});
test('matching is conservative about different days and locations',()=>{const e=fixture(),row={id:1,canonical:e};assert.equal(matchCandidates(e,[row]).length,1);assert.equal(matchCandidates({...e,location:{...e.location,label:'Other utca'}},[row]).length,0);assert.equal(matchCandidates({...e,occurredAt:'2026-08-20T12:00:00Z'},[row]).length,0);});
test('full pipeline is idempotent, publishes atomically, and stops old polling',async()=>{
  const s=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'crimap-public-')),path=join(dir,'public.sqlite');let calls=0;
  const model={model:'fixture',json:async(stage,payload,options)=>{calls++;const raw=stage==='extract'?{schemaVersion:'2.0',events:[fixture()]}:stage==='translate'?{language:'ru',strings:payload.strings}:{sameEvent:true,reason:'same incident',event:payload.incoming};return options?.validate?options.validate(raw):raw;}};
  const p=new Pipeline(s,{reader:{read:async()=>({url,body:`<html><article>${quotation}</article></html>`})},model});
  try{await p.ingest(url);await p.ingest(url);assert.equal(calls,1);assert.equal(s.db.prepare('SELECT count(*) n FROM events').get().n,1);await p.translate(1);migratePublic(path);assert.throws(()=>publish(s,1,path,{reviewer:'Test'}),/review/);s.db.prepare('INSERT INTO quality_reviews VALUES(1,1,?,?,?)').run('fixture',JSON.stringify({verdict:'pass'}),new Date().toISOString());assert.throws(()=>publish(s,1,path,{reviewer:'Test'}),/coordinates/);
    const e=s.event(1).canonical;e.location.latitude=47.5;e.location.longitude=19.06;s.db.prepare('UPDATE events SET canonical=? WHERE id=1').run(JSON.stringify(e));await p.translate(1);assert.throws(()=>publish(s,1,path,{reviewer:'Test'}),/review/);s.db.prepare('INSERT INTO quality_reviews VALUES(1,1,?,?,?)').run('fixture',JSON.stringify({verdict:'pass'}),new Date().toISOString());const id=publish(s,1,path,{reviewer:'Test'});assert.equal(publish(s,1,path,{reviewer:'Test'}),id);assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='recheck' AND job_key='1'").get().state,'queued');const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) n FROM incidents').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM incident_participants').get().n,1);}finally{db.close();}
    s.db.prepare("UPDATE events SET occurred_at='2020-01-01T00:00:00Z' WHERE id=1").run();assert.equal(await p.recheck(1),null);
  }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('malformed model JSON gets one bounded repair and a validated cache entry',async()=>{const s=new Store(':memory:');let calls=0;const model=new DeepSeek(s,{key:'fixture',fetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:calls===1?'{}':'{"valid":true}'}}],usage:{prompt_tokens:10,completion_tokens:5}}));}});try{const options={validate:x=>{assert.equal(x.valid,true);return x;}};await model.json('extract',{test:true},options);await model.json('extract',{test:true},options);assert.equal(calls,2);}finally{s.close();}});
test('an update arriving during a job is not lost on completion',()=>{const s=new Store(':memory:');try{s.enqueue('translate',1,{revision:1});const first=s.claim();s.enqueue('translate',1,{revision:2});s.finish(first);const next=s.claim();assert.equal(next.payload.revision,2);assert.equal(next.id,first.id);}finally{s.close();}});
test('JSON recovery only removes redundant closing braces',()=>{assert.deepEqual(parseJsonResponse('{"x":"}"}}'),{x:'}'});assert.throws(()=>parseJsonResponse('{"x":1} {"admin":true}'));assert.throws(()=>parseJsonResponse('{"x":'));assert.throws(()=>parseJsonResponse('{"x":1} execute this'));});
test('senior review cannot pass errors or attribute translated text to a source',()=>{assert.throws(()=>checkReview({verdict:'pass',summary:'bad',issues:[{severity:'error',field:'summary',reason:'unsupported'}],requests:[]},[doc]));const result=checkReview({verdict:'revise',summary:'fix translation',issues:[{severity:'error',field:'russian.summary',reason:'untranslated word',documentId:'1',quote:'unknown perpetrators'}],requests:[]},[doc],{russian:{summary:'unknown perpetrators'}});assert.equal(result.issues[0].quoteOrigin,'russian');assert.equal(result.issues[0].documentId,undefined);});
test('field requests persist and deduplicate across models',()=>{const dir=mkdtempSync(join(tmpdir(),'crimap-requests-')),s=new Store(join(dir,'collector.sqlite'));try{const request={kind:'field',proposedKey:'weapon.type',label:'Тип оружия',reason:'Структурированный фильтр',example:'нож'};recordRequests(s,[request],{eventId:1,revision:1,model:'deepseek-flash'});recordRequests(s,[request],{eventId:2,revision:1,model:'deepseek-v4-pro'});assert.equal(s.db.prepare('SELECT count(*) n FROM field_requests').get().n,1);}finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('search enforces registry, cache and missing-key state',async()=>{const s=new Store(':memory:');let calls=0;try{const search=new Search(s,{key:'fixture',fetcher:async()=>{calls++;return new Response(JSON.stringify({web:{results:[{url,title:'police'},{url:'https://evil.example',title:'unknown'}]}}));}});assert.equal((await search.query('Budapest')).results.length,1);await search.query('Budapest');assert.equal(calls,1);assert.equal((await new Search(s,{key:''}).query('Budapest')).available,false);}finally{s.close();}});
test('existing public source is scheduled and retains its public identity',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'crimap-bootstrap-')),path=join(dir,'public.sqlite'),s=new Store(':memory:');migratePublic(path);const db=new DatabaseSync(path);
  db.prepare('INSERT INTO incidents(slug,title,category,status,verification,district,location_label,location_precision,latitude,longitude,occurred_at,summary,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('already-published','Existing','Ограбление','В расследовании','Официальный источник','Budapest','Test utca','street',47.5,19.06,fixture().occurredAt,'Existing summary',new Date().toISOString());
  db.prepare('INSERT INTO incident_sources(incident_id,source_type,outlet,source_url,published_at,note) VALUES(1,?,?,?,?,?)').run('Официально','police.hu',url,'2026-09-21T10:00:00Z','');db.close();
  const p=new Pipeline(s,{publicPath:path,reader:{read:async()=>({url,body:`<article>${quotation}</article>`})},model:{model:'fixture',json:async(_stage,_payload,options)=>options.validate({schemaVersion:'2.0',events:[fixture()]})}});
  try{p.seed();assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='article'").get().n,1);await p.ingest(url);assert.equal(s.event(1).slug,'already-published');assert.equal(s.event(1).public_id,1);}finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
