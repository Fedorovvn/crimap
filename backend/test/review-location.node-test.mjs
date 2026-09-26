import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Geocoder} from '../geocode.mjs';
import {Preparation} from '../prepare.mjs';
import {Pipeline} from '../pipeline.mjs';
import {checkReview} from '../review.mjs';

const quote='A 4-es villamoson, a Wesselényi utca Erzsébet körút megállónál egy férfit megszúrtak.';
const anchor={label:'Wesselényi utca Erzsébet körút',kind:'stop',documentId:'1',quote};
const feature=(value='tram_stop',postcode='1073',coordinates=[19.0688684,47.5003839])=>({properties:{name:'Wesselényi utca / Erzsébet körút',osm_key:'railway',osm_value:value,osm_type:'N',osm_id:826166180,city:'Budapest',countrycode:'HU',postcode},geometry:{type:'Point',coordinates}});
const base={verdict:'revise',summary:'Проверка места',issues:[],requests:[]};

test('headquarters resolution verifies the official address then real map coordinates, not a namesake branch',async()=>{
  const s=new Store(':memory:'),requests=[];
  const a={label:'Országos Mentőszolgálat',kind:'landmark',documentId:'1',quote:'Tragédia történt az Országos Mentőszolgálat székházában.'};
  const g=new Geocoder(s,{delayMs:0,request:async url=>{requests.push(url);return url.includes('mentok.hu')?{status:200,body:'<p>1055 Budapest, Markó utca 22.</p>'}:{status:200,body:JSON.stringify({features:[{properties:{street:'Markó utca',housenumber:'22',osm_type:'N',osm_id:123,city:'Budapest',countrycode:'HU',postcode:'1055'},geometry:{coordinates:[19.049,47.509]}}]})};}});
  try{const result=await g.landmarks(a,{city:'Budapest'});assert.equal(result.length,1);assert.equal(result[0].officialReference.address,'Markó utca 22');assert.equal(result[0].precision,'landmark');assert.equal(requests.length,2);assert.ok(requests[0].startsWith('https://www.mentok.hu/'));}finally{s.close();}
});

test('Pro location tools require original quotes, observed candidates and a bounded search',()=>{
  const docs=[{id:'1',text:quote}], lookup={enabled:true};
  assert.equal(checkReview({...base,locationResolution:{action:'search',queries:[anchor]}},docs,{locationLookup:lookup}).locationResolution.action,'search');
  for(const query of [{...anchor,quote:'invented'}, {...anchor,label:'Oktogon'}, {...anchor,documentId:'2'}])assert.throws(()=>checkReview({...base,locationResolution:{action:'search',queries:[query]}},docs,{locationLookup:lookup}),/source/);
  assert.throws(()=>checkReview({...base,locationResolution:{action:'select',candidateId:'invented',reason:'Here'}},docs,{locationLookup:lookup}),/observed/);
  assert.throws(()=>checkReview({...base,locationResolution:{action:'search',queries:[anchor]}},docs,{locationLookup:{...lookup,searched:true}}),/already completed/);
  assert.throws(()=>checkReview(base,docs,{locationLookup:lookup}),/Review location/);
  assert.equal(checkReview({...base,verdict:'pass'},docs,{locationLookup:{...lookup,applied:true}}).verdict,'pass');
});

test('map lookup preserves real stop coordinates and excludes namesakes, streets, wrong districts and foreign results',async()=>{
  const store=new Store(':memory:');let calls=0;
  const foreign=feature();foreign.properties.countrycode='DE';
  try {
    const geocoder=new Geocoder(store,{delayMs:0,request:async()=>{calls++;return {status:200,body:JSON.stringify({features:[feature(),feature('residential'),feature('tram_stop','1085'),feature('tram_stop','1073',[2,48]),foreign]})};}});
    const places=await geocoder.landmarks(anchor,{district:'VII'});
    assert.equal(places.length,1);assert.equal(places[0].precision,'landmark');assert.equal(places[0].latitude,47.5003839);
    assert.equal(places[0].sourceUrl,'https://www.openstreetmap.org/node/826166180');
    await geocoder.landmarks(anchor,{district:'VII'});assert.equal(calls,1);
  } finally {store.close();}
});

async function fixture({failSearch=false,empty=false,changeRevision=false}={}) {
  const store=new Store(':memory:');let calls=0,searches=0;
  const event={title:'Man stabbed on a Budapest tram',summary:'A man was stabbed on tram 4 at Wesselényi utca Erzsébet körút.',type:'assault',status:'investigating',occurredAt:'2026-09-09T07:50:00Z',timePrecision:'exact',location:{city:'Budapest',district:'VII',label:'Budapest VII',precision:'district'},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location','occurredAt'].map(field=>({field,documentId:'1',quote}))};
  const flash={model:'deepseek-flash',json:async(stage,payload,opts)=>opts.validate(stage==='extract'?{schemaVersion:'2.0',events:[event]}:{language:payload.language??'ru',strings:payload.strings})};
  const geocoder=new Geocoder(store,{delayMs:0,request:async()=>{searches++;if(failSearch&&searches===1)throw new Error('Temporary map outage');if(changeRevision)store.db.prepare('UPDATE events SET revision=revision+1 WHERE id=1').run();return {status:200,body:JSON.stringify({features:empty?[]:[feature()]})};}});
  geocoder.locate=async()=>({latitude:47.5021998,longitude:19.0751535,precision:'district',provider:'photon'});
  const pro={model:'deepseek-v4-pro',json:async(stage,payload,opts)=>{
    calls++;assert.equal(stage,'review');
    let action;
    if(payload.locationLookup.applied)action={action:'keep',reason:'Остановка подтверждена'};
    else if(!payload.locationLookup.searched)action={action:'search',queries:[anchor]};
    else if(!payload.locationLookup.candidates.length)action={action:'keep',reason:'Нет однозначного совпадения; оставлен район'};
    else action={action:'select',candidateId:payload.locationLookup.candidates[0].id,reason:'В статье нападение привязано к этой остановке, не к месту задержания'};
    return opts.validate({...base,verdict:action.action==='keep'?'pass':'revise',locationResolution:action});
  }};
  const pipeline=new Pipeline(store,{reader:{read:async()=>({url:'https://www.police.hu/test',body:`<article>${quote}</article>`})},model:flash,reviewer:pro,preparation:new Preparation(store,{geocoder})});
  await pipeline.ingest('https://www.police.hu/test');await pipeline.prepare(1);
  return {store,pipeline,stats:()=>({calls,searches})};
}

test('final Pro review replaces district point with stop, invalidates approval and rechecks translated revision',async()=>{
  const {store,pipeline,stats}=await fixture();
  try {
    const result=await pipeline.review(1,2);
    assert.equal(result.locationResolved,true);assert.equal(result.revision,3);
    const row=store.event(1);assert.equal(row.state,'draft');assert.equal(row.canonical.location.latitude,47.5003839);assert.equal(row.canonical.location.precision,'landmark');
    assert.equal(store.db.prepare('SELECT count(*) n FROM quality_reviews WHERE event_id=1 AND revision=3').get().n,0);
    assert.equal(store.db.prepare("SELECT count(*) n FROM translations WHERE event_id=1 AND revision=3").get().n,0);
    assert.equal((await pipeline.review(1,3)).verdict,'pass');await pipeline.translate(1);await pipeline.localize(1);
    assert.deepEqual(stats(),{calls:3,searches:1});
    const prep=JSON.parse(store.db.prepare('SELECT payload FROM preparation WHERE event_id=1 AND revision=3').get().payload);
    assert.equal(prep.geocoding.anchor.quote,quote);assert.equal(prep.locationReview.applied,true);
    const rePrepared=await pipeline.preparation.enrich(store.event(1),pipeline.eventDocuments(1));
    assert.equal(rePrepared.geocoding.provider,'photon-pro-reviewed');assert.equal(rePrepared.locationReview.applied,true);
    assert.equal(store.event(1).state,'draft');
  } finally {store.close();}
});

test('map outage resumes the saved Pro request; ambiguous lookup keeps the district without inventing coordinates',async()=>{
  const {store,pipeline,stats}=await fixture({failSearch:true,empty:true});
  try {
    await assert.rejects(pipeline.review(1,2),/Temporary map outage/);
    assert.equal((await pipeline.review(1,2)).verdict,'pass');
    assert.deepEqual(stats(),{calls:2,searches:2});assert.equal(store.event(1).revision,2);assert.equal(store.event(1).canonical.location.precision,'district');
  } finally {store.close();}
});

test('concurrent editorial revision is not overwritten by location resolution',async()=>{
  const {store,pipeline}=await fixture({changeRevision:true});
  try {await assert.rejects(pipeline.review(1,2),/Event changed/);assert.equal(store.event(1).canonical.location.precision,'district');assert.equal(store.db.prepare('SELECT count(*) n FROM quality_reviews').get().n,0);}finally{store.close();}
});
