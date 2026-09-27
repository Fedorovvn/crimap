import test from 'node:test';
import assert from 'node:assert/strict';
import {correctFinalTranslations,protectTranslationNumbers} from '../final-corrections.mjs';
import {applyTranslation,translationStrings} from '../contract.mjs';
import {Store} from '../store.mjs';
import {DeepSeek} from '../model.mjs';
import {identify} from '../dedup.mjs';
const event={title:'A man injured',summary:'A 30-year-old man was injured at 13.',type:'assault',status:'investigating',occurredAt:'2026-09-20T12:00:00Z',timePrecision:'day',location:{city:'Budapest',label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:[{field:'summary',documentId:'1',quote:'A 30-year-old man was injured at 13.'}]};

test('Pro corrects just erroneous fields, fills new translation keys and removes nonexistent text paths',async()=>{
 const russian=applyTranslation(event,{language:'ru',strings:{...translationStrings(event),summary:'Пострадал 31-летний мужчина в 13:00.'}},{draft:true});
 const raw={verdict:'pass',final:{russian:{'legal.0.source.label':'Unused'},siteTranslations:{en:{},hu:{}}}};
 const calls=[];
 const model={json:async(stage,payload,{validate})=>{
  calls.push(payload);assert.equal(stage,'review');assert.equal(payload.mode,'correct-translation-fields');
  return validate({strings:Object.fromEntries(Object.entries(payload.fields).map(([id,f])=>[id,f.language==='ru'?'Пострадал ⟦NUM_A⟧-летний мужчина в ⟦NUM_B⟧.':f.source]))});
 }};
 const fixed=await correctFinalTranslations(raw,{event,russian,translations:{},preparation:null},model);
 assert.equal(calls.length,2);assert.equal(Object.keys(calls[0].fields).length,1);
 assert.equal(fixed.final.russian.summary,'Пострадал 30-летний мужчина в 13.');
 assert.ok(!('legal.0.source.label' in fixed.final.russian));
 assert.equal(fixed.final.siteTranslations.hu[fixed.final.russian.summary],fixed.final.russian.summary);
 assert.equal(raw.final.russian['legal.0.source.label'],'Unused');
 const invalid={json:async(_s,p,{validate})=>validate({strings:Object.fromEntries(Object.keys(p.fields).map(k=>[k,'31']))})};
 await assert.rejects(correctFinalTranslations(raw,{event,russian,translations:{}},invalid),/numeric tokens/);
});

test('protected number markers preserve districts, round-the-clock durations, phones and repeated floors',()=>{
 const phone=protectTranslationNumbers('Call the 24-hour line 06-80-555-111 or 112.');
 assert.equal(phone.restore('Линия работает ⟦NUM_A⟧ часа: ⟦NUM_B⟧-⟦NUM_C⟧-⟦NUM_D⟧-⟦NUM_E⟧ или ⟦NUM_F⟧.'),'Линия работает 24 часа: 06-80-555-111 или 112.');
 assert.throws(()=>phone.restore('Круглосуточная линия ⟦NUM_B⟧-⟦NUM_C⟧-⟦NUM_D⟧-⟦NUM_E⟧ или ⟦NUM_F⟧.'),/numeric tokens/);
 const floors=protectTranslationNumbers('15. emelet, 14. kerület; 15. emelet.');
 assert.equal(floors.restore('⟦NUM_A⟧-й этаж, ⟦NUM_B⟧-й район; ⟦NUM_C⟧-й этаж.'),'15-й этаж, 14-й район; 15-й этаж.');
 assert.throws(()=>floors.restore('⟦NUM_A⟧ этаж, XIV район; ⟦NUM_C⟧ этаж.'),/numeric tokens/);
 assert.throws(()=>floors.restore('⟦NUM_A⟧ ⟦NUM_B⟧ ⟦NUM_C⟧ 30'),/numeric tokens/);
 assert.throws(()=>floors.restore('⟦NUM_A⟧ ⟦NUM_A⟧ ⟦NUM_B⟧ ⟦NUM_C⟧'),/numeric tokens/);
});

test('async model validation saves a corrected response and reuses it without another paid call',async()=>{
 const s=new Store(':memory:');let calls=0;
 try{
  const model=new DeepSeek(s,{key:'fixture',fetcher:async()=>{calls++;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"value":1}'}}],usage:{prompt_tokens:10,completion_tokens:5}}));}});
  const options={validate:async raw=>{await Promise.resolve();raw.value=2;return raw;}};
  assert.equal((await model.json('extract',{},options)).value,2);
  assert.equal((await model.json('extract',{},options)).value,2);assert.equal(calls,1);
  assert.equal(JSON.parse(s.db.prepare('SELECT payload FROM model_cache').get().payload).value,2);
 }finally{s.close();}
});

test('unknown district returned as null is accepted without inventing a district',async()=>{
 const model={json:async(_s,_p,{validate})=>validate({incidents:[{title:'Incident',summary:'Incident',type:'assault',occurredAt:null,location:{city:'Budapest',label:'Budapest',district:null,precision:'city'},caseReferences:[],facts:[]}]})};
 const result=await identify(model,{text:'Incident'});assert.equal(result[0].location.district,undefined);
});
