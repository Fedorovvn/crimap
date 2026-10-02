import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {discoverFeed} from '../discovery.mjs';
import {completeDetails,validateLegalLinks,detailFingerprint,normalizeDetailLanguage,validateDetailLanguage} from '../details.mjs';
import {eventSchema,validateEvidence} from '../contract.mjs';
const feed={url:'https://www.police.hu/hu/rss/feed',sourceId:'police-national'};
const now=new Date('2026-09-27T12:00:00Z');
const started=new Date('2026-09-27T09:00:00Z');
test('detail prose uses English while Hungarian proper names and evidence remain allowed',()=>{
 const response={participants:[{note:'Police detained the man near Wesselényi utca.'}],context:[],legal:[],evidence:[{quote:'A férfit elfogták és előállították.'}]};
 validateDetailLanguage(response);
 assert.throws(()=>validateDetailLanguage({...response,participants:[{note:'A férfit elfogták és előállították.'}]}),/participants\.0\.note.*ENGLISH/);
 const normalized=normalizeDetailLanguage({participants:[{note:'Police detained him (elfogták és előállították).'}],context:[],legal:[]});
 assert.equal(normalized.participants[0].note,'Police detained him.');
 validateDetailLanguage(normalized);
});
const xml=(count,extra='')=>'<rss><channel>'+Array.from({length:count},(_,i)=>`<item><title>Budapesti késelés ${i}${extra}</title><link>https://www.police.hu/article-${i}</link><pubDate>Sun, 27 Sep 2026 10:00:00 GMT</pubDate><description>Budapest: egy férfit megszúrtak.</description></item>`).join('')+'</channel></rss>';
test('free discovery reads beyond the first three, persists receipts and ignores changed metadata',async()=>{
 const s=new Store(':memory:');try{let body=xml(0);const reader={read:async()=>({body,url:feed.url})};
 await discoverFeed(s,reader,feed,{now:started});body=xml(12);
 assert.equal((await discoverFeed(s,reader,feed,{now})).queued,12);
 s.db.prepare("UPDATE jobs SET state='done'").run();
 assert.equal((await discoverFeed(s,reader,feed,{now})).queued,0);
 body=xml(12,' update');assert.equal((await discoverFeed(s,reader,feed,{now})).queued,0);
 body=xml(13);assert.equal((await discoverFeed(s,reader,feed,{now})).queued,1);
 assert.equal(s.db.prepare('SELECT count(*) n FROM usage').get().n,0);
 }finally{s.close();}
});
test('discovery respects paused campaign work and ignores stale first-seen RSS items',async()=>{
 const s=new Store(':memory:');try{s.enqueue('article','https://www.police.hu/article-0',{campaignId:'archive'});s.db.prepare("UPDATE jobs SET state='paused'").run();
 const reader={read:async()=>({body:xml(1),url:feed.url})};assert.equal((await discoverFeed(s,reader,feed,{now})).queued,0);
 assert.equal(s.db.prepare('SELECT state FROM jobs').get().state,'paused');
 await discoverFeed(s,{read:async()=>({body:xml(2),url:feed.url})},feed,{now:new Date('2026-10-01T00:00:00Z')});
 assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,1);
 }finally{s.close();}
});
test('discovery-only worker cannot claim paid processing jobs, including expired leases',()=>{
 const s=new Store(':memory:');try{s.enqueue('review','1',{});assert.equal(s.claim(undefined,['feed']),null);s.enqueue('feed','rss',feed);assert.equal(s.claim(undefined,['feed']).kind,'feed');assert.equal(s.claim().kind,'review');}finally{s.close();}
});
test('detail enrichment preserves geometry and other fields, requires quotes and binds law to its suspect',async()=>{
 const quote='A 30-year-old man was detained after stabbing a man, who was hospitalized.';
 const doc={id:'1',url:'https://www.police.hu/test',sourceKind:'official',text:quote,imageUrls:[]};
 const event={title:'Stabbing',summary:quote,type:'assault',status:'investigating',occurredAt:null,timePrecision:'unknown',location:{city:'Budapest',label:'Test utca',precision:'street',latitude:47.5,longitude:19.1},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location'].map(field=>({field,documentId:'1',quote}))};
 const participant={key:'suspect',role:'suspect',label:'30-year-old man',status:'detained',profile:{kind:'person',age:30},note:'Police detained him after the stabbing.',sourceUrl:doc.url,sourceLabel:'police.hu',asOf:now.toISOString()};
 let response={participants:[participant],context:[],legal:[],evidence:['participants.0','participants.0.status','participants.0.profile.age'].map(field=>({field,documentId:'1',quote})),coverage:{participants:'Добавлены возраст и задержание.',legal:'no-reported-qualification',reason:'В источнике нет квалификации.'},requests:[]};
 const model={json:async(stage,payload,{validate})=>{assert.equal(stage,'details');return validate(response);}};
 const validate=(e,d)=>validateEvidence(eventSchema.parse(e),d);
 const result=await completeDetails(model,event,[doc],[],validate);
 assert.deepEqual(result.event.location,event.location);assert.equal(result.event.summary,event.summary);assert.equal(result.event.participants[0].note,participant.note);
 assert.notEqual(result.fingerprint,detailFingerprint(event,[doc],[]));
 response.evidence.push({field:'title',documentId:'1',quote:'Untrusted extra title evidence'});
 const echoed=await completeDetails(model,event,[doc],[],validate);
 assert.deepEqual(echoed.event.evidence.filter(e=>e.field==='title'),event.evidence.filter(e=>e.field==='title'));
 response={...response,evidence:[]};await assert.rejects(completeDetails(model,event,[doc],[],validate),/Missing evidence/);
 assert.throws(()=>validateLegalLinks({...result.event,legal:[{}]}),/participantKey/);
 assert.throws(()=>validateLegalLinks({...result.event,participants:[{...participant,role:'victim'}],legal:[{participantKey:'suspect'}]}),/victim/);
 validateLegalLinks({...result.event,legal:[{participantKey:'suspect'}]});
});
