import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.mjs';
import { Pipeline } from '../pipeline.mjs';
import { assembleFinal,sourceExcerpts,assertSupportedDetention } from '../final-editor.mjs';
import { applyTranslation,translationStrings,validateEvidence,eventSchema } from '../contract.mjs';
import { displayStrings } from '../site-localization.mjs';
const quote='A man was stabbed on a Budapest tram. Service was interrupted. The police are investigating.';
const doc={id:'1',url:'https://www.police.hu/test',title:'Stabbing on a tram',text:quote,sourceKind:'official',imageUrls:[]};
const event={title:'Tram service interrupted',summary:'Service was interrupted after a stabbing.',type:'transport-disruption',status:'resolved',occurredAt:'2026-09-20T12:00:00Z',timePrecision:'day',location:{city:'Budapest',label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location','occurredAt'].map(field=>({field,documentId:'1',quote}))};
const russian=applyTranslation(event,{language:'ru',strings:{...translationStrings(event),title:'Прервано движение трамваев',summary:'Движение прервано после нападения.', 'location.label':'Будапешт'}});
const translations=Object.fromEntries(['en','hu'].map(l=>[l,Object.fromEntries(displayStrings(russian).map(t=>[t,t]))]));
const context={event,russian,translations,documents:[doc],validateEvent:e=>validateEvidence(eventSchema.parse(e),[doc])};
const changed={...event,title:'Man stabbed on a tram',summary:'A man was stabbed on a Budapest tram. Police are investigating.',type:'assault',status:'investigating'};
const final={event:changed,russian:{title:'Нападение с ножом в трамвае',summary:'В трамвае Будапешта ранили мужчину. Полиция расследует нападение.'},siteTranslations:{en:{'Нападение с ножом в трамвае':changed.title,'В трамвае Будапешта ранили мужчину. Полиция расследует нападение.':changed.summary},hu:{'Нападение с ножом в трамвае':'Késelés egy villamoson','В трамвае Будапешта ранили мужчину. Полиция расследует нападение.':'Egy férfit megszúrtak egy budapesti villamoson. A rendőrség nyomoz.'}}};
const result={legalCoverage:{status:'no-suspect',reason:'В источнике нет описания подозреваемого для правовой оценки.',participants:[]},verdict:'pass',summary:'Исправлены категория, статус и переводы',issues:[],requests:[],final};
test('questioning alone cannot support detained status, while an explicit apprehension quote can',()=>{
 const person={participants:[{status:'detained'}],evidence:[{field:'participants.0.status',quote:'M. Milánt is gyanúsítottként hallgatták ki.'}]};
 assert.throws(()=>assertSupportedDetention(person),/NOT detention/);
 person.participants[0].status='unknown';assert.doesNotThrow(()=>assertSupportedDetention(person));
 person.participants[0].status='detained';person.evidence.push({field:'participants.0.status',quote:'A férfit elfogták és előállították.'});assert.doesNotThrow(()=>assertSupportedDetention(person));
});

test('final editor applies factual and multilingual corrections together and rejects stale translations',()=>{
 const ready=assembleFinal(result,context);assert.equal(ready.event.type,'assault');assert.equal(ready.russian.status,'investigating');assert.equal(ready.review.finalized,true);assert.equal(ready.translations.en[ready.russian.title],changed.title);
 assert.throws(()=>assembleFinal({...result,final:{...final,russian:{}}},context),/required for changed English/);
 assert.throws(()=>assembleFinal({...result,final:{...final,siteTranslations:{en:{},hu:{}}}},context),/invalid_type|Required/);
 assert.throws(()=>assembleFinal({...result,final:undefined},context),/must include final/);
 const bad=structuredClone(result);bad.final.event.evidence[0].quote='Invented source';assert.throws(()=>assembleFinal(bad,context),/Unverifiable/);
 const badMap=structuredClone(result);badMap.final.event.location.latitude=47.6;assert.throws(()=>assembleFinal(badMap,context),/locationResolution/);
 const badMedia=structuredClone(result),image='https://www.police.hu/unreviewed.jpg';badMedia.final.event.media=[{imageUrl:image,sourceUrl:doc.url,outlet:'Police',credit:'Police',caption:'Photo',isSensitive:true,rights:'unknown'}];
 assert.throws(()=>assembleFinal(badMedia,{...context,preparation:{mediaReview:[]},validateEvent:e=>e}),/Flash-approved/);
 const badNumber=structuredClone(result);badNumber.final.russian.summary+=' 30';assert.throws(()=>assembleFinal(badNumber,context),/changed numbers/);
});

test('Pro corrections are atomically saved as a ready revision without Flash repair or publication',async()=>{
 const s=new Store(':memory:');try{
  const saved=s.saveDocument({...doc,sourceId:'police'});
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('tram','2026-09-26',JSON.stringify(event));
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(1,saved.id,saved.contentHash,JSON.stringify(event),'2026-09-26');
  s.db.prepare('INSERT INTO preparation VALUES(1,1,?,?)').run('{}','2026-09-26');
  s.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(russian),'flash','2026-09-26');
  s.db.prepare('INSERT INTO site_translations VALUES(1,1,?,?)').run(JSON.stringify(translations),'2026-09-26');
  let attempt=0;
  const pipeline=new Pipeline(s,{model:{json:async()=>{throw new Error('Unexpected Flash call');}},reviewer:{model:'pro',json:async(stage,payload,{validate})=>{assert.deepEqual(payload.russian,translationStrings(russian));assert.ok(payload.translationPaths.includes('location.label'));assert.ok(payload.siteTranslations.hu);if(attempt++===0){const error=new Error('Correct the unsupported legal claim');error.validationFailure=true;throw error;}assert.equal(payload.previousValidationError,'Correct the unsupported legal claim');return validate(result);}}});
  await assert.rejects(pipeline.review(1,1),/unsupported legal claim/);assert.equal(s.event(1).revision,1);assert.equal(s.db.prepare('SELECT count(*) n FROM quality_reviews').get().n,0);
  assert.equal((await pipeline.review(1,1)).finalized,true);assert.equal(s.event(1).revision,2);assert.equal(s.event(1).canonical.type,'assault');assert.equal(s.event(1).public_id,null);
  assert.equal(JSON.parse(s.db.prepare('SELECT payload FROM quality_reviews WHERE revision=2').get().payload).verdict,'pass');
  assert.equal(s.db.prepare('SELECT count(*) n FROM site_translations WHERE revision=2').get().n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM preparation WHERE revision=2').get().n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM jobs').get().n,0);
  assert.ok((await pipeline.translate(1)).skipped);assert.ok((await pipeline.localize(1)).skipped);
 }finally{s.close();}
});

test('source excerpts preserve cited paragraphs, dates, attribution and nearby context',()=>{
 const text=Array.from({length:150},(_,i)=>i===85?'The suspect was detained.':`Unrelated promotional paragraph ${i}. `.repeat(8)).join('\n');
 const source={...doc,text,publishedAt:'2026-09-20T12:00:00Z'};
 const excerpt=sourceExcerpts([source],{evidence:[{documentId:'1',quote:'The suspect was detained.'}]})[0];
 assert.ok(excerpt.excerpted);assert.ok(excerpt.text.length<text.length);assert.ok(excerpt.text.includes('The suspect was detained.'));assert.ok(excerpt.text.includes('paragraph 84'));assert.equal(excerpt.publishedAt,source.publishedAt);assert.equal(excerpt.url,doc.url);
});

test('a draft translation may reach Pro with a numeric error but cannot pass final assembly unchanged',()=>{
 const original={...event,summary:'A 30-year-old man was injured.'};
 const draft=applyTranslation(original,{language:'ru',strings:{...translationStrings(original),summary:'Пострадал 31-летний мужчина.'}},{draft:true});
 assert.equal(draft.summary,'Пострадал 31-летний мужчина.');
 assert.throws(()=>assembleFinal({verdict:'pass',summary:'ok',issues:[],requests:[],final:{}},{...context,event:original,russian:draft}),/changed numbers/);
});

test('equivalent full Russian output is normalized without another paid request, structural edits are rejected',()=>{
 const full={verdict:'pass',summary:'Проверено',issues:[],requests:[],final:{russian}};
 const ready=assembleFinal(full,context);assert.deepEqual(ready.russian,russian);
 const wrong=structuredClone(full);wrong.final.russian.location.latitude=48;
 assert.throws(()=>assembleFinal(wrong,context),/non-text data/);
 const wrongDate=structuredClone(full);wrongDate.final.russian.occurredAt='2026-09-19T12:00:00Z';
 assert.throws(()=>assembleFinal(wrongDate,context),/non-text data/);
});

test('serialized translation containers are flattened only after structural and numeric validation',()=>{
 const raw={verdict:'pass',summary:'Проверено',issues:[],requests:[],final:{russian:{location:JSON.stringify(russian.location),signals:'[]',caseReferences:'[]'}}};
 assert.deepEqual(assembleFinal(raw,context).russian,russian);
 const bad=structuredClone(raw);bad.final.russian.signals='["death"]';
 assert.throws(()=>assembleFinal(bad,context),/non-text data/);
 const changed=structuredClone(raw);changed.final.event={...event,summary:'A new factual sentence.'};
 assert.throws(()=>assembleFinal(changed,context),/required for changed English field/);
});
