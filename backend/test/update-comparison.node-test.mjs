import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePublicationUpdate,protectedChange} from '../update-comparison.mjs';
import {draftPublication} from '../publication-comparison.mjs';

const event={title:'Man attacked',summary:'A man was attacked.',type:'assault',status:'investigating',occurredAt:'2026-09-20T00:00:00Z',timePrecision:'day',location:{label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},signals:[],participants:[],context:[],legal:[],updates:[],media:[]};
const published={snapshot:draftPublication(event,[],{},null)};
const model=result=>({json:async(stage,input,{validate})=>{assert.equal(stage,'update-compare');assert.ok(input.changes.length);return validate(result);}});
const same={decision:'unchanged',confidence:.99,reason:'Изменилась только формулировка.'};

test('identical public facts need neither Flash nor Pro; new source URL alone is not a new fact',async()=>{
 const out=await comparePublicationUpdate({json(){throw Error('No paid call');}},{canonical:event},[{url:'https://example.com/repeat',sourceKind:'official'}],{},published);
 // An extra official source can change verification, so use the same source class.
 assert.equal(out.skip,true);
});
test('Flash can discard equivalent wording, but uncertainty and new facts proceed',async()=>{
 const next={canonical:{...event,title:'Attack on a man'}};
 assert.equal((await comparePublicationUpdate(model(same),next,[],{},published)).skip,true);
 for(const result of [{...same,confidence:.7},{...same,decision:'uncertain'},{...same,decision:'changed'}])assert.equal((await comparePublicationUpdate(model(result),next,[],{},published)).skip,false);
});
test('important structured changes cannot be suppressed even by a mistaken Flash response',async()=>{
 for(const patch of [{status:'wanted'},{signals:['death']},{location:{...event.location,latitude:47.6}},{summary:'A 30-year-old man was attacked.'},{participants:[{key:'victim',label:'Man',profile:{age:30}}]}]){
  const out=await comparePublicationUpdate(model(same),{canonical:{...event,...patch}},[],{},published);
  assert.equal(out.skip,false);assert.ok(out.protectedFields.length);
 }
 assert.ok(protectedChange({path:'legal.0.offense',kind:'changed',before:'Assault',after:'Murder'}));
});
test('published translations are reused for language-neutral comparison without new translation calls',async()=>{
 const snapshot={...published.snapshot,title:'Нападение',translations:{en:{'Нападение':event.title}}};
 const out=await comparePublicationUpdate({json(){throw Error('No call');}},{canonical:event},[],{},{snapshot});
 assert.equal(out.skip,true);
});
