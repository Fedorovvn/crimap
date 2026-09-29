import test from 'node:test';
import assert from 'node:assert/strict';
import {identify,sourceParagraphs,provisionalEvent,compareBrief,comparisonCard,compactComparisonCard,comparisonFingerprint} from '../dedup.mjs';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {consolidate} from '../consolidate.mjs';
import {indexedCandidates} from '../event-index.mjs';

const event={title:'Tram stabbing',summary:'A man was stabbed at Wesselényi utca.',type:'assault',status:'investigating',occurredAt:'2026-09-09T07:50:00Z',timePrecision:'exact',location:{city:'Budapest',label:'Wesselényi utca',district:'VII',precision:'landmark'},signals:[],caseReferences:[],participants:[],updates:[],media:[],context:[],legal:[],evidence:[]};
const brief={title:event.title,summary:event.summary,type:event.type,occurredAt:event.occurredAt,location:event.location,caseReferences:[],facts:[{fact:'A man was stabbed.',paragraphIds:[1]}]};
const rich={...event,context:[{text:'Known background. '.repeat(700),verification:'reported'}]};

test('numbered source retains the middle and references resolve to exact separate source passages',async()=>{
 const middle='The victim later died from the injuries.';
 const doc={id:1,title:event.title,text:'Opening.\n'+'Background. '.repeat(1400)+'\n'+middle+'\n'+'Ending. '.repeat(600)};
 const model={json:async(stage,payload,{validate})=>{
  assert.equal(stage,'identify');assert.ok(!payload.text);
  const evidence=payload.paragraphs.find(p=>p.text===middle);
  assert.ok(evidence);assert.equal(payload.paragraphs.map(p=>p.text).join(''),doc.text.replaceAll('\n',''));
  return validate({overflow:false,incidents:[{...brief,occurredAt:null,facts:[{fact:'Reported death',paragraphIds:[1,evidence.id]}]}]});
 }};
 const [result]=await identify(model,doc);
 assert.equal(result.facts.length,2);assert.equal(result.facts[1].quote,middle);
 assert.equal(provisionalEvent(result,doc).occurredAt,null);
 assert.ok(result.facts.every(f=>doc.text.includes(f.quote)));
});

test('invalid paragraph IDs cannot enter the event evidence',async()=>{
 const model={json:async(_stage,_payload,{validate})=>validate({incidents:[{...brief,facts:[{fact:'Invented',paragraphIds:[999]}]}]})};
 await assert.rejects(identify(model,{text:'Actual source.'}),/Unknown identity source paragraph/);
});

test('multi-incident overflow expands once without silently losing stories',async()=>{
 const limits=[];
 const model={json:async(_stage,payload,{validate})=>{limits.push(payload.maxIncidents);return validate({overflow:payload.maxIncidents===3,incidents:Array.from({length:payload.maxIncidents===3?3:4},()=>brief)});}};
 assert.equal((await identify(model,{text:'Source.'})).length,4);assert.deepEqual(limits,[3,10]);
 const overflow={json:async(_stage,_payload,{validate})=>validate({overflow:true,incidents:[]})};
 await assert.rejects(identify(overflow,{text:'Source.'}),/too many incidents/);
});

test('length exhaustion expands output once; network failures do not trigger a second request',async()=>{
 let calls=0;
 const model={json:async(_stage,_payload,{validate,maxTokens})=>{if(++calls===1)throw new Error('Model response incomplete (length; output tokens: 3200)');assert.equal(maxTokens,7500);return validate({incidents:[brief]});}};
 assert.equal((await identify(model,{text:'Source.'})).length,1);assert.equal(calls,2);
 calls=0;await assert.rejects(identify({json:async()=>{calls++;throw new Error('DeepSeek HTTP 429');}},{text:'Source.'}),/429/);assert.equal(calls,1);
});

test('large clearly different candidates use compact screen; all batches remain eligible',async()=>{
 const modes=[],ids=[];
 const model={json:async(_stage,payload,{validate})=>{modes.push(payload.mode);ids.push(...payload.candidates.map(c=>c.id));return validate({decision:'new',confidence:1,reason:'Different occurrences'});}};
 const candidates=Array.from({length:9},(_,i)=>({id:i+1,canonical:rich}));
 assert.equal((await compareBrief(model,event,candidates)).decision,'new');
 assert.deepEqual(modes,['identity-only','identity-only','identity-only']);assert.deepEqual(ids,[1,2,3,4,5,6,7,8,9]);
 assert.ok(JSON.stringify(compactComparisonCard(rich)).length<JSON.stringify(comparisonCard(rich)).length*.2);
});

test('uncertainty or a match expands to full facts, including facts omitted from the sketch',async()=>{
 for(const decision of ['match','uncertain','new']){
  const modes=[],document={id:4,text:'Stabbing. Later the suspect was charged with attempted murder.'};
  const model={json:async(_stage,payload,{validate})=>{
   modes.push(payload.mode);
   if(payload.mode==='identity-only')return validate({decision,eventId:1,confidence:.8,reason:'Need original details'});
   assert.equal(payload.sourceDocument.text,document.text);assert.equal(payload.candidates[0].event.context[0].text,rich.context[0].text);
   return validate({decision:'update',eventId:1,reason:'New charge in original source'});
  }};
  assert.equal((await compareBrief(model,event,[{id:1,canonical:rich}],{document})).decision,'update');assert.deepEqual(modes,['identity-only','facts']);
 }
});

test('unknown date forces full comparison even if compact screen claims certainty',async()=>{
 const modes=[];
 const model={json:async(_stage,payload,{validate})=>{modes.push(payload.mode);return validate(payload.mode==='identity-only'?{decision:'new',confidence:1,reason:'Different date'}:{decision:'update',eventId:1,reason:'Missing date is not a different event'});}};
 assert.equal((await compareBrief(model,{...event,occurredAt:null},[{id:1,canonical:rich}])).decision,'update');assert.deepEqual(modes,['identity-only','facts']);
});

test('compact screen cannot invent IDs or suppress an update with repeat',async()=>{
 for(const result of [{decision:'match',eventId:999,confidence:1,reason:'Match'},{decision:'repeat',eventId:1,confidence:1,reason:'No new facts'}]){
  await assert.rejects(compareBrief({json:async(_s,_p,{validate})=>validate(result)},event,[{id:1,canonical:rich}]));
 }
});

test('unchanged directed duplicate decision is reused before consolidation',async()=>{
 const s=new Store(':memory:');let calls=0;try{
  for(const id of [1,2])s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,public_id) VALUES(?,?,?,?,?)').run(id,'dedup-'+id,new Date().toISOString(),JSON.stringify(event),id===1?9:null);
  const p=new Pipeline(s,{model:{json:async(_s,_p,{validate})=>{calls++;return validate({decision:'repeat',eventId:1,reason:'Same facts'});}}});
  assert.equal(await p.deduplicateExisting(2),true);assert.equal(calls,1);assert.equal(s.event(2).merged_into,1);
 }finally{s.close();}
});

test('changed facts invalidate the supplied consolidation decision',async()=>{
 const s=new Store(':memory:');let calls=0;try{
  for(const id of [1,2])s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,public_id) VALUES(?,?,?,?,?)').run(id,'changed-'+id,new Date().toISOString(),JSON.stringify(event),id===1?9:null);
  const confirmedComparison={incomingId:2,targetId:1,fingerprint:comparisonFingerprint(s.event(2).canonical,[s.event(1)]),result:{decision:'repeat',eventId:1}};
  s.db.prepare('UPDATE events SET canonical=? WHERE id=1').run(JSON.stringify({...event,summary:'A different incident on another tram.'}));
  const p=new Pipeline(s,{model:{json:async(_s,_p,{validate})=>{calls++;return validate({decision:'new',reason:'Different incident'});}}});
  assert.deepEqual((await consolidate(p,{eventIds:[2],candidateIds:[1],confirmedComparison})).merged,[]);assert.equal(calls,1);assert.equal(s.event(2).merged_into,null);
 }finally{s.close();}
});

test('known source still nominates its events after language/date changes without auto-merging',()=>{
 const s=new Store(':memory:');try{
  const doc=s.saveDocument({url:'https://www.police.hu/known',sourceId:'police-brfk',sourceKind:'official',title:event.title,text:event.summary});
  for(const id of [1,2]){
   s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(?,?,?,?)').run(id,'linked-'+id,new Date().toISOString(),JSON.stringify(event));
   s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(id,doc.id,doc.contentHash,JSON.stringify(event),new Date().toISOString());
  }
  s.candidates(event); // Install the existing FTS index.
  const changed={...event,title:'Verekedés közben',summary:'Gáz-riasztó fegyver',occurredAt:null,location:{city:'Budapest',label:'Budapest',precision:'city'}};
  assert.equal(indexedCandidates(s,changed).length,0);
  assert.deepEqual(indexedCandidates(s,changed,{documentId:doc.id}).map(r=>r.id),[1,2]);
  assert.equal(s.event(1).merged_into,null);assert.equal(s.event(2).merged_into,null);
 }finally{s.close();}
});
