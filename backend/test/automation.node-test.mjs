import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Triage,cheapDecision} from '../triage.mjs';
import {Geocoder,choosePlace,districtNumber} from '../geocode.mjs';
import {Archive,budapestDate,parsePoliceArchive} from '../archive.mjs';
import {Preparation} from '../prepare.mjs';
import {DeepSeek} from '../model.mjs';
import {Pipeline} from '../pipeline.mjs';
import {translationStrings} from '../contract.mjs';

test('free filters reject routine and minor traffic but retain tram violence and ambiguous severity',async()=>{
  let calls=0;const t=new Triage({json:async()=>{calls++;return {keep:false,reason:'Negated serious injuries'};}});
  assert.equal(cheapDecision('Ideiglenes forgalomkorlátozás Budapesten').decision,'drop');
  assert.equal((await t.check({title:'Baleset Budapesten',text:'Két autó ütközött a fővárosban, senki nem sérült meg.'})).keep,false);
  assert.equal((await t.check({title:'Véres férfi mászott egy villamos tetejére Budapesten',text:'A rendőrök intézkedtek.'})).keep,true);
  assert.equal((await t.check({title:'Verekedés Budapesten',text:'Két férfi megtámadott egy járókelőt.'})).keep,true);
  assert.equal(calls,0);
  assert.equal(cheapDecision('Baleset Budapesten','Két autó ütközött.').decision,'ambiguous');
  await t.check({title:'Baleset Budapesten',text:'Súlyos sérülés nem történt.'});assert.equal(calls,1);
  await t.check({title:'Budapest: két autó ütközött',text:'Forgalmi akadály keletkezett az úton.'});assert.equal(calls,2);
  await t.check({title:'Rablás Szegeden',text:'Szegeden kiraboltak egy üzletet.'});assert.equal(calls,3);
});
test('broad Hungarian green flags prevent free rejection despite routine or minor language',()=>{
  const phrases=['súlyosan megsérült','súlyos sérüléseket szenvedett','állapota válságos','életveszélyes állapotban','újraélesztették','mentőhelikopter érkezett','a roncsok közül szabadították ki','feszítővágóval mentettek','eszméletlenül találták','elvesztette az eszméletét','intenzív osztályra került','koponyasérülést szenvedett','nyílt törése volt','többen sérültek meg','felborult az autó','frontális ütközés','elgázolt egy embert','a villamos alá került','beszorult az utas','lángra kapott az autó','kritikus állapotban','amputálni kellett','keringésleállás történt','belehalt sérüléseibe','kizuhant a járműből','csupa vér volt','félmeztelenül tombolt','megfojtották','kirabolták','ütlegelték','evakuálták a házat'];
  for(const phrase of phrases)for(const complete of [false,true])assert.notEqual(cheapDecision('Forgalomkorlátozás Budapesten','Baleset történt, csak anyagi kár. '+phrase,{complete}).decision,'drop',phrase);
  assert.equal(cheapDecision('Baleset Budapesten','Senki sem sérült meg.',{complete:false}).decision,'ambiguous');
  assert.equal(cheapDecision('Baleset Budapesten','Az egyik utas könnyű sérüléseket szenvedett.',{complete:true}).decision,'ambiguous');
  assert.equal(cheapDecision('Baleset Budapesten','A sérülésekről még nincs információ.',{complete:true}).decision,'ambiguous');
  assert.equal(cheapDecision('Baleset Budapesten','Senki sem sérült meg.',{complete:true}).decision,'drop');
});
const feature=(district,coordinates=[19.0638,47.5015])=>({properties:{name:'Akácfa utca',osm_type:'W',osm_id:123,osm_key:'highway',osm_value:'residential',city:'Budapest',countrycode:'HU',postcode:district},geometry:{type:'Point',coordinates}});
test('geocoder distinguishes identical street names in different districts and never upgrades street precision',()=>{
  const a=feature('1072'),b=feature('1214',[19.06,47.414]);
  assert.equal(districtNumber('VII · Erzsébetváros'),7);
  assert.equal(choosePlace([b,a],{label:'Akácfa utca',district:'VII · Erzsébetváros',precision:'street'}).latitude,47.5015);
  assert.equal(choosePlace([b,a],{label:'Akácfa utca',precision:'street'}),null);
  assert.equal(choosePlace([a],{label:'Other utca',precision:'street'}),null);
  assert.equal(choosePlace([a],{label:'Akácfa utca',precision:'exact'}).precision,'street');
  assert.equal(choosePlace([feature('1072',[2,48])],{label:'Akácfa utca',precision:'street'}),null);
});
test('geocoding is cached and failed requests do not create fake locations',async()=>{
  const s=new Store(':memory:');let calls=0;
  try{const g=new Geocoder(s,{delayMs:0,request:async()=>{calls++;return {status:200,body:JSON.stringify({features:[feature('1072')]})};}});
    await g.locate({label:'Akácfa utca',district:'VII',precision:'street'});await g.locate({label:'Akácfa utca',district:'VII',precision:'street'});assert.equal(calls,1);
    await assert.rejects(new Geocoder(s,{delayMs:0,endpoint:'https://different.example/api/',request:async()=>({status:503})}).locate({label:'Missing',precision:'city'}),/503/);
  }finally{s.close();}
});
test('archive budget is cumulative across dates and models, separate from recurring daily budget',()=>{
  const s=new Store(':memory:');try{
    s.db.prepare('INSERT INTO campaigns(id,from_date,to_date,budget_usd,created_at) VALUES(?,?,?,?,?)').run('two-months','2026-07-25T22:00:00Z','2026-09-26T21:59:59Z',5,'2026-09-26T00:00:00Z');
    const a=s.reserveCost('extract','flash','a',4.8,.5,'2026-09-26T00:00:00Z','two-months');
    assert.throws(()=>s.reserveCost('review','pro','b',.3,.5,'2026-09-27T00:00:00Z','two-months'),/Campaign/);
    s.usageFailed(a,'timeout');assert.throws(()=>s.reserveCost('extract','flash','c',.3,.5,'2026-09-28T00:00:00Z','two-months'),/Campaign/);
    assert.ok(s.reserveCost('extract','flash','ordinary',.2,.5));
  }finally{s.close();}
});
test('campaign prioritizes finished cards and pauses all campaign jobs when its total budget is exhausted',async()=>{
  const s=new Store(':memory:');try{
    s.db.prepare('INSERT INTO campaigns(id,from_date,to_date,budget_usd,created_at) VALUES(?,?,?,?,?)').run('limited','2026-07-25T22:00:00Z','2026-09-26T21:59:59Z',5,'2026-09-26T00:00:00Z');
    s.enqueue('article','first',{campaignId:'limited'});s.enqueue('review','finish',{campaignId:'limited',eventId:1,revision:1});
    const p=new Pipeline(s,{model:{},reviewer:{}});p.review=async()=>{assert.equal(p.model.campaignId,'limited');throw new Error('Campaign model budget reached');};
    await p.runOne();assert.equal(s.db.prepare('SELECT state FROM campaigns').get().state,'budget-exhausted');
    assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE state='paused'").get().n,2);
    assert.equal(p.model.campaignId,null);assert.equal(s.claim(),null);
  }finally{s.close();}
});
test('archives use local timezone, filter dates and resume without duplicate articles',async()=>{
  assert.equal(budapestDate('2026-09-24 13:43'),'2026-09-24T11:43:00.000Z');
  assert.equal(budapestDate('2026-01-24 13:43'),'2026-01-24T12:43:00.000Z');
  const listing=parsePoliceArchive('<article><h1><a href="/hu/hirek-es-informaciok/legfrissebb-hireink/test">Rablás</a></h1><time datetime="2026-09-24 13:43"></time></article><a rel="next" href="?page=1">Next</a>','https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink');
  assert.equal(listing.items.length,1);assert.ok(listing.next.endsWith('?page=1'));
  const s=new Store(':memory:');let reads=0;
  const ar=new Archive(s,{reader:{read:async()=>{reads++;return {body:JSON.stringify([{link:'https://kekvillogo.hu/robbery/',date_gmt:'2026-08-01T12:00:00',title:{rendered:'Rablás Budapesten'},excerpt:{rendered:'<p>Rablót fogtak el.</p>'}},{link:'https://kekvillogo.hu/routine/',date_gmt:'2026-08-01T12:00:00',title:{rendered:'Ideiglenes forgalomkorlátozás Budapesten'},excerpt:{rendered:'Delegáció érkezik.'}},{link:'https://kekvillogo.hu/old/',date_gmt:'2026-01-01T12:00:00',title:{rendered:'Rablás Budapesten'}}])};}}});
  try{ar.start({id:'test',from:'2026-07-25T22:00:00.000Z',to:'2026-09-26T21:59:59.999Z',budget:5});const payload={campaignId:'test',sourceId:'kekvillogo',url:'https://kekvillogo.hu/wp-json/wp/v2/posts',page:1};await ar.scan(payload);await ar.scan(payload);assert.equal(reads,1);assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='article'").get().n,1);assert.equal(s.db.prepare('SELECT filtered FROM archive_pages').get().filtered,1);}finally{s.close();}
});
test('Pro cannot be used for extraction, translation, matching, or image selection',async()=>{
  const s=new Store(':memory:');try{const pro=new DeepSeek(s,{model:'deepseek-v4-pro',key:'fixture'});for(const stage of ['extract','translate','merge','media','triage','repair'])await assert.rejects(pro.json(stage,{}),/reserved/);}finally{s.close();}
});
test('automatic preparation adds coordinates before final Pro review, preserves attribution and budget identity',async()=>{
  const s=new Store(':memory:'),url='https://www.police.hu/test';const text='A robbery occurred in Budapest at Akácfa utca on 20 September 2026. Police are investigating the incident.';
  const e={title:'Robbery in Budapest',summary:text,type:'robbery',status:'investigating',occurredAt:'2026-09-20T12:00:00Z',timePrecision:'day',location:{city:'Budapest',label:'Akácfa utca',district:'VII',precision:'street'},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location','occurredAt'].map(field=>({field,documentId:'1',quote:text}))};
  const seen=[];const flash={model:'deepseek-flash',json:async(stage,payload,opts)=>{seen.push(stage);return opts.validate(stage==='details'?{participants:[],context:[],legal:[],evidence:[],coverage:{participants:'No details in fixture',legal:'no-suspect',reason:'No suspect in fixture'},requests:[]}:stage==='extract'?{schemaVersion:'2.0',events:[e]}:{language:payload.language??'ru',strings:payload.strings});}};
  const pro={model:'deepseek-v4-pro',json:async(stage,payload,opts)=>{assert.equal(stage,'review');assert.equal(payload.event.location.latitude,47.5015);assert.equal(payload.preparation.geocoding.provider,'photon');assert.equal(payload.russian,null);assert.equal(seen.includes('translate'),false);return opts.validate({verdict:'pass',summary:'ok',issues:[],requests:[]});}};
  const prep=new Preparation(s,{geocoder:{locate:async()=>({latitude:47.5015,longitude:19.0638,precision:'street',provider:'photon'})},checkUrl:async()=>{}});
  const p=new Pipeline(s,{reader:{read:async()=>({url,body:`<article>${text}</article>`})},model:flash,reviewer:pro,preparation:prep});
  try{await p.ingest(url);await p.prepare(1);assert.equal(s.event(1).revision,2);await p.review(1,2);await p.translate(1);await p.localize(1);assert.deepEqual(seen,['extract','details','translate','site-translate','site-translate']);assert.equal(s.db.prepare('SELECT count(*) n FROM quality_reviews WHERE revision=2').get().n,1);}finally{s.close();}
});
