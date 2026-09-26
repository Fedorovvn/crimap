import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {matchCandidates} from '../dedup.mjs';
import {consolidate} from '../consolidate.mjs';
import {cheapDecision} from '../triage.mjs';
const event={title:'Man stabbed on a Budapest tram',summary:'A man was stabbed at Wesselényi utca.',type:'assault',status:'investigating',occurredAt:'2026-09-09T07:50:00Z',timePrecision:'exact',location:{city:'Budapest',label:'Wesselényi utca / Erzsébet körút',district:'VII',precision:'landmark'},signals:[],caseReferences:[],participants:[],updates:[],media:[],context:[],legal:[],evidence:[]};
test('candidate selection crosses categories, accents and street formatting but not different districts/dates',()=>{
  const row={id:1,canonical:event};
  assert.equal(matchCandidates({...event,type:'transport-disruption',location:{...event.location,label:'Wesselenyi utcai megallo',district:'7. kerület'}},[row]).length,1);
  assert.equal(matchCandidates({...event,location:{...event.location,district:'VIII'}},[row]).length,0);
  assert.equal(matchCandidates({...event,occurredAt:'2026-09-15T07:50:00Z'},[row]).length,0);
  assert.equal(matchCandidates(event,[{...row,merged_into:2}]).length,0);
});
test('missing searches are rejected free; ordinary car fires need a short relevance check',()=>{
  assert.equal(cheapDecision('Eltűnt egy lány Budapesten').decision,'drop');
  assert.notEqual(cheapDecision('Eltűnt férfi holttestét találták meg').decision,'drop');
  assert.equal(cheapDecision('Kigyulladt egy autó Budapesten').decision,'ambiguous');
  assert.notEqual(cheapDecision('Teherautó csapódott egy épületbe Budapesten').decision,'drop');
});
test('repeated source ends after Flash identity/comparison without extraction, photos, Pro or translation',async()=>{
  const s=new Store(':memory:'),calls=[],text=event.summary;
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,occurred_at) VALUES(1,?,?,?,?)').run('same',new Date().toISOString(),JSON.stringify(event),event.occurredAt);
  const model={json:async(stage,payload,options)=>{
    calls.push(stage);
    return options.validate(stage==='identify'?{incidents:[{title:event.title,summary:text,type:event.type,occurredAt:event.occurredAt,location:event.location,caseReferences:[],facts:[{fact:text,quote:text}]}]}:{decision:'repeat',eventId:1,reason:'No new facts'});
  }};
  const p=new Pipeline(s,{model,triage:{check:async()=>({keep:true,reason:'Crime',method:'rules'})},reader:{read:async()=>({url:'https://www.police.hu/test',body:`<article><h1>${event.title}</h1><p>${text} Police are investigating the assault in Budapest.</p></article>`})}});
  try{assert.equal((await p.ingest('https://www.police.hu/test')).repeat,true);assert.deepEqual(calls,['identify','compare']);assert.equal(s.event(1).revision,1);assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,0);}finally{s.close();}
});
test('consolidation keeps the published identity and sources, archives duplicate and invalidates old approval',async()=>{
  const s=new Store(':memory:');const now=new Date().toISOString();
  for(const id of [1,2]){
    const d=s.saveDocument({url:`https://www.police.hu/${id}`,sourceId:'police',sourceKind:'official',text:event.summary,title:event.title});
    s.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical,public_id,published_revision) VALUES(?,?,?,?,?,?,?)').run(id,`event-${id}`,now,event.occurredAt,JSON.stringify(event),id===2?7:null,id===2?1:null);
    s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(id,d.id,d.contentHash,JSON.stringify(event),now);
  }
  s.db.prepare("UPDATE events SET campaign_id='archive-test' WHERE id=1").run();
  const pipeline={store:s,model:{},eventDocuments:id=>[{id:String(id),contentHash:'x',text:event.summary}],merge:async()=>({sameEvent:true,hasNewInformation:true,event,reason:'Same incident'})};
  try{const result=await consolidate(pipeline);assert.deepEqual(result.merged,[{from:1,into:2}]);assert.equal(s.event(2).public_id,7);assert.equal(s.event(2).campaign_id,'archive-test');assert.equal(s.event(2).revision,2);assert.equal(s.event(1).merged_into,2);assert.equal(s.db.prepare('SELECT count(*) n FROM observations WHERE event_id=2').get().n,2);assert.equal(s.event(2).published_revision,1);assert.equal(s.event(2).state,'draft');assert.equal((await consolidate(pipeline)).comparisons,0);}finally{s.close();}
});
