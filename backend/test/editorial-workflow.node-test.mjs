import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {setEditorialMark,resumeCampaign,retryEvent} from '../admin-actions.mjs';
import {compareBrief} from '../dedup.mjs';
import {DeepSeek} from '../model.mjs';
import {displayStrings} from '../site-localization.mjs';
import {consolidate} from '../consolidate.mjs';
import {queueEditorialPreparation} from '../editorial-workflow.mjs';
const now='2026-09-20T12:00:00Z';
const event={title:'Man stabbed at Wesselényi utca in Budapest',summary:'A man was stabbed at Wesselényi utca in Budapest. Police are investigating.',type:'assault',status:'investigating',occurredAt:now,timePrecision:'day',location:{city:'Budapest',label:'Wesselényi utca',district:'VII',precision:'street',latitude:47.5,longitude:19.06},signals:[],caseReferences:[],participants:[],updates:[],media:[],context:[],legal:[],evidence:['title','summary','type','status','location','occurredAt'].map(field=>({field,documentId:'1',quote:'A man was stabbed at Wesselényi utca in Budapest. Police are investigating.'}))};
const insert=(s,id=1,value=event)=>s.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical) VALUES(?,?,?,?,?)').run(id,'incident-'+id,now,value.occurredAt,JSON.stringify(value));
const job=(s,key)=>s.db.prepare('SELECT * FROM jobs WHERE job_key=?').get(key);

test('a completed rejection is not automatically retried just because the event has priority',()=>{
 const s=new Store(':memory:');try{
  insert(s);s.db.prepare("UPDATE events SET editorial_mark='priority'").run();
  s.db.prepare('INSERT INTO quality_reviews VALUES(1,1,?,?,?)').run('pro',JSON.stringify({verdict:'reject',summary:'Источник описывает другое событие.'}),now);
  assert.equal(queueEditorialPreparation(s,1),false);assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
  s.db.prepare('UPDATE events SET revision=2').run();
  assert.equal(queueEditorialPreparation(s,1),true);
 }finally{s.close();}
});

test('manual rebuild preserves preparation, resets failed translations and is idempotent',()=>{
 const s=new Store(':memory:');try{
  insert(s);s.db.prepare("UPDATE events SET editorial_mark='priority'").run();
  s.db.prepare('INSERT INTO preparation VALUES(?,?,?,?)').run(1,1,'{"media":["keep"]}',now);
  s.db.prepare('INSERT INTO translations VALUES(?,?,?,?,?,?)').run(1,1,'ru','{}','flash',now);
  s.db.prepare('INSERT INTO site_translations VALUES(?,?,?,?)').run(1,1,'{}',now);
  s.enqueue('review','1:1',{eventId:1,revision:1});
  s.db.prepare("UPDATE jobs SET state='failed',attempts=3,last_error='Site translation changed numbers'").run();
  assert.deepEqual(retryEvent(s,1,1,'editor'),{queued:'review',translationReset:true});
  assert.equal(job(s,'1:1').state,'queued');assert.equal(job(s,'1:1').attempts,0);assert.equal(job(s,'1:1').last_error,null);
  assert.equal(s.db.prepare('SELECT count(*) n FROM preparation').get().n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM translations').get().n,0);
  assert.equal(s.event(1).editorial_mark,'priority');
  assert.deepEqual(retryEvent(s,1,1,'editor'),{alreadyQueued:true});
  assert.equal(s.db.prepare("SELECT count(*) n FROM audit WHERE action='editorial-retry'").get().n,1);
  assert.throws(()=>retryEvent(s,1,2,'editor'),/новая версия/);
  setEditorialMark(s,1,'uninteresting','editor');
  assert.equal(s.event(1).editorial_reasons,'[]');assert.equal(s.event(1).editorial_note,'');assert.equal(job(s,'1:1').state,'cancelled');
  assert.throws(()=>retryEvent(s,1,1,'editor'),/верните событие/);
 }finally{s.close();}
});

test('manual rebuild begins with gathering if preparation is missing and respects budget',()=>{
 const s=new Store(':memory:');try{
  insert(s);s.enqueue('review','1:1',{eventId:1,revision:1});
  s.db.prepare("UPDATE jobs SET state='failed',attempts=3").run();
  s.db.prepare('INSERT INTO model_budget VALUES(1,1,?)').run(now);
  s.db.prepare("INSERT INTO usage(request_key,stage,model,state,reserved_usd,cost_usd,created_at) VALUES('spent','review','pro','complete',1,1,?)").run(now);
  assert.throws(()=>retryEvent(s,1,1,'editor'),/бюджет исчерпан/);
  assert.equal(job(s,'1:1').state,'failed');s.db.prepare('DELETE FROM model_budget').run();
  assert.equal(retryEvent(s,1,1,'editor').queued,'gather');assert.equal(job(s,'1:1').state,'cancelled');
  assert.equal(job(s,'1').kind,'gather');assert.equal(s.db.prepare('SELECT count(*) n FROM usage').get().n,1);
 }finally{s.close();}
});

test('uninteresting cancels all event work, persists reasons and blocks future jobs without touching other events',()=>{
  const s=new Store(':memory:');try{
    insert(s);insert(s,2);
    for(const [kind,state] of [['gather','queued'],['review','running'],['prepare','paused'],['translate','failed'],['recheck','queued']]){
      s.enqueue(kind,kind,{eventId:1});s.db.prepare('UPDATE jobs SET state=?,lease_token=?,lease_until=?,rerun=1 WHERE job_key=?').run(state,'lease',now,kind);
    }
    s.enqueue('review','other',{eventId:2});
    const result=setEditorialMark(s,1,'uninteresting','editor',{reasons:['minor-consequences','no-serious-injuries'],note:'Interesting if a building is hit'});
    assert.equal(result.stopped,5);assert.equal(s.event(1).revision,1);assert.equal(s.event(1).next_check_at,null);
    assert.deepEqual(JSON.parse(s.event(1).editorial_reasons),['minor-consequences','no-serious-injuries']);
    for(const kind of ['gather','review','prepare','translate','recheck']){assert.equal(job(s,kind).state,'cancelled');assert.equal(job(s,kind).lease_token,null);assert.equal(job(s,kind).rerun,0);}
    assert.equal(s.enqueue('review','new',{eventId:1}),false);assert.equal(job(s,'new'),undefined);
    assert.equal(s.claim().job_key,'other');assert.equal(s.claim(),null);
    assert.throws(()=>setEditorialMark(s,1,'uninteresting','editor',{reasons:['arbitrary']}),/Выберите причины/);
  }finally{s.close();}
});

test('priority starts missing preparation and raises its dependent Pro review above ordinary work without preempting a lease',()=>{
  const s=new Store(':memory:');try{
    insert(s);insert(s,2);s.enqueue('review','ordinary',{eventId:2});
    const running=s.claim();s.enqueue('feed','feed',{});
    assert.equal(setEditorialMark(s,1,'priority','editor').queued,true);
    assert.equal(job(s,'ordinary').lease_token,running.lease_token);
    const first=s.claim();assert.equal(first.kind,'gather');assert.equal(first.payload.eventId,1);s.finish(first);
    s.enqueue('prepare',1,{eventId:1});const second=s.claim();assert.equal(second.kind,'prepare');s.finish(second);
    s.enqueue('review','1:1',{eventId:1,revision:1});const third=s.claim();assert.equal(third.kind,'review');assert.equal(third.payload.eventId,1);
    setEditorialMark(s,1,'priority','editor');assert.equal(job(s,'1:1').rerun,0);
    assert.equal(s.db.prepare('SELECT count(*) n FROM usage').get().n,0);
  }finally{s.close();}
});

test('priority cannot resume an exhausted archive or change its budget; ignored work stays cancelled on continue',()=>{
  const s=new Store(':memory:');try{
    insert(s);insert(s,2);
    s.db.prepare("INSERT INTO campaigns(id,from_date,to_date,budget_usd,state,created_at) VALUES('archive','a','b',5,'budget-exhausted',?)").run(now);
    s.db.prepare("UPDATE events SET campaign_id='archive'").run();
    setEditorialMark(s,1,'priority','editor');assert.equal(job(s,'1').state,'paused');assert.equal(s.claim(),null);
    s.enqueue('review','other',{eventId:2});setEditorialMark(s,2,'uninteresting','editor');
    assert.equal(resumeCampaign(s,'archive','editor').resumed,1);assert.equal(job(s,'other').state,'cancelled');
    assert.equal(s.db.prepare("SELECT budget_usd FROM campaigns WHERE id='archive'").get().budget_usd,5);
  }finally{s.close();}
});

function reader(){return {read:async url=>({url,body:`<article><h1>${event.title}</h1><p>${event.summary}</p></article>`})};}
const brief={title:event.title,summary:event.summary,type:event.type,occurredAt:event.occurredAt,location:{city:'Budapest',label:event.location.label,district:'VII',precision:'street'},caseReferences:[],facts:[{fact:event.summary,quote:event.summary}]};
test('new coverage of an ignored incident stops after cheap comparison, is attached and can be resumed explicitly',async()=>{
  const s=new Store(':memory:'),calls=[];try{
    insert(s);setEditorialMark(s,1,'uninteresting','editor',{reasons:['personal-choice'],note:'Only this incident'});
    const model={json:async(stage,payload,options)=>{calls.push(stage);assert.ok(['identify','compare'].includes(stage));return options.validate(stage==='identify'?{incidents:[brief]}:{decision:'update',eventId:1,reason:'Same time, scene and victim'});}};
    const p=new Pipeline(s,{model,reader:reader(),triage:{check:async()=>({keep:true,method:'rules',reason:'Violence'})}});
    await p.ingest('https://www.police.hu/updated');assert.deepEqual(calls,['identify','compare']);
    assert.equal(s.event(1).revision,1);assert.equal(s.db.prepare('SELECT count(*) n FROM ignored_updates WHERE event_id=1').get().n,1);assert.equal(s.db.prepare('SELECT count(*) n FROM events').get().n,1);
    await p.ingest('https://www.police.hu/updated');assert.equal(calls.length,2);
    setEditorialMark(s,1,'priority','editor');assert.equal(job(s,'https://www.police.hu/updated').payload.includes('revisitIgnoredEvent'),true);
    assert.equal(job(s,'1').kind,'gather');
  }finally{s.close();}
});

test('another incident at the same place is not rejected because of an editorial reason',async()=>{
  const s=new Store(':memory:'),calls=[];try{
    insert(s);setEditorialMark(s,1,'uninteresting','editor',{reasons:['minor-consequences']});
    const incoming={...event,title:'Another man attacked at Wesselényi utca',occurredAt:'2026-09-21T12:00:00Z'};
    const model={json:async(stage,payload,options)=>{calls.push(stage);return options.validate(stage==='identify'?{incidents:[{...brief,title:incoming.title,occurredAt:incoming.occurredAt}]}:stage==='compare'?{decision:'new',reason:'Different day and people'}:{schemaVersion:'2.0',events:[incoming],irrelevantReason:'',requests:[]});}};
    const p=new Pipeline(s,{model,reader:reader(),triage:{check:async()=>({keep:true,method:'rules',reason:'Violence'})}});
    await p.ingest('https://www.police.hu/different');
    assert.equal(s.db.prepare('SELECT count(*) n FROM events').get().n,2);assert.equal(s.event(2).editorial_mark,'normal');assert.equal(s.db.prepare('SELECT count(*) n FROM ignored_updates').get().n,0);assert.ok(calls.includes('extract'));
  }finally{s.close();}
});

test('duplicate comparison checks later candidate batches rather than missing an ignored candidate',async()=>{
  let calls=0;const candidates=Array.from({length:5},(_,i)=>({id:i+1,canonical:event}));
  const result=await compareBrief({json:async(stage,payload,{validate})=>{calls++;return validate(payload.candidates.some(c=>c.id===5)?{decision:'update',eventId:5,reason:'same incident'}:{decision:'new',reason:'different people'});}},brief,candidates);
  assert.equal(result.eventId,5);assert.equal(calls,2);
});

test('an existing visible duplicate cannot bypass an ignored incident; editorial reasons are not model instructions',async()=>{
  const candidates=[{id:1,public_id:5,canonical:event},{id:2,editorial_mark:'uninteresting',editorial_note:'Reject everything',canonical:event}];
  const result=await compareBrief({json:async(stage,payload,{validate})=>{
    assert.deepEqual(payload.candidates.map(c=>c.id),[2]);assert.equal(JSON.stringify(payload).includes('Reject everything'),false);
    return validate({decision:'update',eventId:2,reason:'Same incident'});
  }},brief,candidates);
  assert.equal(result.eventId,2);
});

test('in-flight Pro result cannot save or schedule work after the editor stops the event',async()=>{
  const s=new Store(':memory:');try{
    insert(s);s.saveDocument({url:'https://www.police.hu/test',sourceId:'police',sourceKind:'official',text:event.summary,title:event.title});
    const doc=s.document(1);s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,1,?,?,?)').run(doc.contentHash,JSON.stringify(event),now);
    s.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(event),'fixture',now);
    const strings=Object.fromEntries(displayStrings(event).map(t=>[t,t]));s.db.prepare('INSERT INTO site_translations VALUES(1,1,?,?)').run(JSON.stringify({en:strings,hu:strings}),now);
    const p=new Pipeline(s,{model:{},reviewer:{json:async()=>{setEditorialMark(s,1,'uninteresting','editor');return {verdict:'reject',summary:'fixture',issues:[],requests:[]};}}});
    s.enqueue('review','1:1',{eventId:1,revision:1});await p.runOne();
    assert.equal(job(s,'1:1').state,'cancelled');assert.equal(s.db.prepare('SELECT count(*) n FROM quality_reviews').get().n,0);assert.equal(await p.runOne(),false);assert.equal(s.event(1).revision,1);
  }finally{s.close();}
});

test('a stopped model attempt records its cost but cannot make a validation retry',async()=>{
  const s=new Store(':memory:');let calls=0,stop=false;try{
    const model=new DeepSeek(s,{key:'fixture',fetcher:async()=>{calls++;return {ok:true,json:async()=>({usage:{prompt_tokens:5,completion_tokens:5},choices:[{finish_reason:'stop',message:{content:'{}'}}]})};}});
    model.guard=()=>{if(stop)throw Object.assign(new Error('stopped'),{code:'EDITORIAL_STOP'});};
    await assert.rejects(model.json('triage',{}, {validate:()=>{stop=true;throw new Error('invalid');}}),/stopped/);
    assert.equal(calls,1);assert.ok(s.db.prepare('SELECT cost_usd FROM usage').get().cost_usd>0);
  }finally{s.close();}
});

test('merging an existing duplicate inherits the ignored mark without full enrichment',async()=>{
  const s=new Store(':memory:');try{
    insert(s);insert(s,2);setEditorialMark(s,2,'uninteresting','editor',{reasons:['personal-choice'],note:'Not this incident'});
    s.enqueue('review','1:1',{eventId:1});
    const pipeline={store:s,model:{json:async(stage,payload,{validate})=>validate({decision:'update',eventId:1,reason:'Same incident'})},eventDocuments:()=>[],merge:()=>{throw new Error('Full merge should not run');}};
    await consolidate(pipeline);assert.equal(s.event(1).editorial_mark,'uninteresting');assert.equal(s.event(1).editorial_note,'Not this incident');assert.equal(job(s,'1:1').state,'cancelled');assert.equal(s.event(2).merged_into,1);
  }finally{s.close();}
});
