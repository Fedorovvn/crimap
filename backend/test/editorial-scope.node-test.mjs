import test from 'node:test';
import assert from 'node:assert/strict';
import {cheapDecision,Triage,triageExcerpt} from '../triage.mjs';
import {interestReasons} from '../admin/interest-reasons.mjs';
test('animal attacks and factory chemical leaks are rejected free despite injuries',async()=>{
 const t=new Triage({json:async()=>{throw new Error('No model needed');}});
 for(const [title,text] of [
  ['Kutyatámadás Csepelen','Két embert súlyos sérülésekkel kórházba vittek.'],
  ['Dog attack in Budapest','A woman was seriously injured.'],
  ['Klórgáz szivárgott egy budapesti vegyi üzemben','Hat embert kórházba szállítottak, kiürítették az üzemet.'],
  ['В химическом заводе произошла утечка хлора','Шесть человек госпитализированы.'],
 ]){const r=await t.check({title,text});assert.equal(r.keep,false,title);assert.equal(r.method,'rules');}
});
test('drug raids with weapons and sporting accidents do not bypass contextual filtering on green flags',()=>{
 for(const title of [
  'Rajtaütés Angyalföldön: drogot és fegyvert foglaltak le',
  'Lezuhant és súlyosan megsérült egy ejtőernyős Budapesten',
  'Rendőrségi razzia a túlárazott közbeszerzés miatt',
  'Отец и сын задержаны за торговлю наркотиками',
  'Mass illness at a Budapest festival; drugs suspected, cause unknown',
 ])assert.equal(cheapDecision(title,'').decision,'ambiguous',title);
});
test('free triage rejects property-crime police outcomes and self-risk on infrastructure without a victim',async()=>{
 const t=new Triage({json:async()=>{throw new Error('No model needed');}});
 for(const [title,text] of [
  ['Sorozatbetörőt fogtak el Újbudán', 'A rendőrök őrizetbe vették a férfit több lakásbetörés miatt.'],
  ['Серийного квартирного вора задержали', 'Полиция задержала подозреваемого после нескольких краж из квартир.'],
  ['Férfi sétált az M0 zajvédő falának tetején', 'A bejelentő rendőrautót látott a helyszínen.'],
  ['Man walking on top of a motorway noise barrier', 'Police attended after a witness called emergency services.'],
 ]){const r=await t.check({title,text});assert.equal(r.keep,false,title);assert.equal(r.method,'rules');}
 assert.notEqual(cheapDecision('Késelés egy lakásban Budapesten','A lakót megsebesítették.').decision,'drop');
 assert.notEqual(cheapDecision('Véres férfi mászott egy villamos tetejére Budapesten','A rendőrök intézkedtek.').decision,'drop');
});
test('disappeared social-media pages are not mislabelled as missing people',()=>{
 const result=cheapDecision('Eltűnt Hankó Balázs Facebook-oldala');
 assert.equal(result.decision,'drop');
 assert.match(result.reason,/Техническая или медийная/);
});
test('every candidate surviving the free filter is decided by Flash before extraction',async()=>{
 let calls=0;const t=new Triage({json:async(_stage,_payload,{validate})=>{calls++;return validate({keep:true,defer:false,reason:'В статье описано нападение'});}});
 const result=await t.check({title:'Нападение в Будапеште',text:'На прохожего напали возле остановки.'});
 assert.equal(result.keep,true);assert.equal(result.method,'flash-short');assert.equal(calls,1);
 const long=`${'Начало статьи. '.repeat(1000)}Заключение с уточнённым исходом.`;
 const excerpt=triageExcerpt(long);assert.ok(excerpt.length<=12060);assert.ok(excerpt.includes('Заключение с уточнённым исходом.'));
});
test('mixed human violence and incidental dogs/drugs cannot be rejected by keyword',async()=>{
 let calls=0;const t=new Triage({json:async(_stage,_payload,{validate})=>{calls++;return validate({keep:true,reason:'Нападение на прохожего'});}});
 for(const title of ['Man stabbed while walking his dog in Budapest','Drug dealer stabbed a passerby in Budapest','Chemical attack at a Budapest factory; chlorine released']){
  assert.notEqual(cheapDecision(title).decision,'drop');assert.equal((await t.check({title,text:title})).keep,true);
 }
 assert.equal(calls,3);
});
test('ambulance rollover and residential danger remain eligible; personal marks do not train a ban',()=>{
 for(const [title,text] of [
  ['Felborult egy mentőautó Budapesten','Két mentőst és két beteget kórházba vittek. Öten sérültek meg.'],
  ['Szén-monoxid-mérgezés egy budapesti lakásban','Két lakót mentettek ki.'],
  ['Teherautó csapódott egy épületbe Budapesten','A sérülések súlyossága még nem ismert.'],
  ['Késelés Budapesten','A nő élettársa megszúrta.'],
 ])assert.notEqual(cheapDecision(title,text,{complete:true}).decision,'drop',title);
 for(const key of ['animals','industrial-disaster','drugs','police-routine','economic-case','extreme-activity','property-only'])assert.ok(interestReasons[key]);
});
