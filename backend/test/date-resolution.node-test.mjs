import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {validateResolvedDate} from '../date-resolution.mjs';
import {setEditorialMark} from '../admin-actions.mjs';
import {matchCandidates} from '../dedup.mjs';
import {filterEvents,normalizeFilters} from '../admin/filters.mjs';
const day='2026-09-20T00:00:00+02:00';
const event={title:'Man stabbed aboard Budapest tram',summary:'A man was stabbed at Wesselényi utca.',type:'assault',status:'investigating',occurredAt:null,timePrecision:'unknown',location:{city:'Budapest',label:'Wesselényi utca',precision:'street'},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:[]};
function seed(s,text='A man was stabbed at Wesselényi utca.'){
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('test','2026-09-26',JSON.stringify(event));
  const d=s.saveDocument({url:'https://www.police.hu/test',sourceId:'police-brfk',sourceKind:'official',title:event.title,text,publishedAt:'2026-09-26T12:00:00Z'});
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,?,?,?,?)').run(d.id,d.contentHash,'{}','2026-09-26');return d;
}
const unknown={occurredAt:null,timePrecision:'unknown',documentId:null,quote:'',reason:'Дата происшествия не указана'};
test('date result needs a source quote and supported precision; future dates are rejected',()=>{
  const doc={id:'1',text:'The stabbing happened on 20 September 2026.'};
  const result={occurredAt:day,timePrecision:'day',documentId:'1',quote:doc.text,reason:'Дата из текста'};
  assert.equal(validateResolvedDate(result,[doc]).occurredAt,day);
  assert.deepEqual(validateResolvedDate(unknown,[doc]),unknown);
  assert.throws(()=>validateResolvedDate({...result,quote:'invented'},[doc]),/exact source/);
  assert.throws(()=>validateResolvedDate({...result,timePrecision:'unknown'},[doc]),/precision/);
  assert.throws(()=>validateResolvedDate({...result,occurredAt:'2099-01-01T00:00:00Z'},[doc]),/past/);
});
test('unknown date blocks queued heavy work and priority does not bypass the hold or archive cap',()=>{
  const s=new Store(':memory:');try{seed(s);
    s.db.prepare("INSERT INTO jobs(kind,job_key,payload,due_at) VALUES('review','1:1','{\"eventId\":1}','2026-01-01')").run();
    s.db.prepare("INSERT INTO campaigns(id,from_date,to_date,budget_usd,state,created_at) VALUES('archive','a','b',5,'budget-exhausted','2026-09-26')").run();
    s.db.prepare("UPDATE events SET campaign_id='archive'").run();
    setEditorialMark(s,1,'priority','test');
    assert.equal(s.event(1).state,'awaiting-date');
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='review'").get().state,'waiting-date');
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='resolve-date'").get().state,'paused');
    assert.equal(s.claim(),null);
    setEditorialMark(s,1,'uninteresting','test');assert.ok(s.db.prepare('SELECT state FROM jobs').all().every(j=>j.state==='cancelled'));
  }finally{s.close();}
});
test('undated sources stay reusable; unchanged text does not spend Flash again or use publication time',async()=>{
  const s=new Store(':memory:');try{seed(s);let calls=0;
    const p=new Pipeline(s,{model:{json:async(stage,input,{validate})=>{assert.equal(stage,'resolve-date');calls++;return validate(unknown);}}});
    s.holdForDate(1);assert.ok(await p.resolveDate(1));assert.ok(await p.resolveDate(1));
    assert.equal(calls,1);assert.equal(s.event(1).canonical.occurredAt,null);assert.equal(p.eventDocuments(1).length,1);
    assert.equal(s.db.prepare('SELECT reason FROM date_checks').get().reason,unknown.reason);
  }finally{s.close();}
});
test('a supported day creates a new revision and resumes preparation without publishing',async()=>{
  const s=new Store(':memory:');try{const d=seed(s,'The stabbing happened on 20 September 2026.');
    const p=new Pipeline(s,{preparation:{},model:{json:async(stage,input,{validate})=>validate({occurredAt:day,timePrecision:'day',documentId:d.id,quote:d.text,reason:'Дата из текста'})}});
    s.holdForDate(1);s.db.prepare("UPDATE jobs SET due_at=? WHERE kind='resolve-date' AND job_key='1'").run(new Date().toISOString());await p.runOne({kinds:['resolve-date']});
    assert.equal(s.event(1).revision,2);assert.equal(s.event(1).state,'draft');assert.equal(s.event(1).occurred_at,day);
    assert.equal(s.event(1).public_id,null);assert.equal(s.event(1).canonical.evidence[0].quote,d.text);
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='gather'").get().state,'queued');
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='resolve-date'").get().state,'done');
  }finally{s.close();}
});
test('undated traffic waiting for a fatality uses the quiet date cadence',()=>{
  const s=new Store(':memory:');try{
    const traffic={...event,type:'traffic-accident',occurredAt:null,timePrecision:'unknown',summary:'A collision was reported.',title:'Collision at Wesselényi utca'};
    s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('undated-traffic',new Date().toISOString(),JSON.stringify(traffic));
    s.holdForFatality(1);
    const row=s.db.prepare("SELECT due_at FROM jobs WHERE kind='recheck' AND job_key='1'").get();
    assert.ok(Date.parse(row.due_at)>Date.now()+60*60000&&Date.parse(row.due_at)<Date.now()+3*3600000,'undated traffic gets its first fact check after two hours');
  }finally{s.close();}
});
test('startup refresh replaces an old fast fatality check with the quiet undated cadence',()=>{
  const s=new Store(':memory:');try{
    const traffic={...event,type:'traffic-accident',occurredAt:null,timePrecision:'unknown',summary:'A collision was reported.',title:'Collision at Wesselényi utca'};
    s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('old-undated-traffic',new Date().toISOString(),JSON.stringify(traffic));
    s.db.prepare("INSERT INTO jobs(kind,job_key,payload,due_at) VALUES('recheck','1','{\"eventId\":1}',?)").run(new Date(Date.now()+15*60000).toISOString());
    s.holdForDate(1,{eventId:1},{refresh:true});
    const due=Date.parse(s.db.prepare("SELECT due_at FROM jobs WHERE kind='recheck' AND job_key='1'").get().due_at);
    assert.ok(due>Date.now()+60*60000&&due<Date.now()+3*3600000,'startup replaces the former rapid due time');
  }finally{s.close();}
});
test('a new undated article stops after the cheap identity record',async()=>{
  const s=new Store(':memory:');let stages=[];
  const article='A man was stabbed at Wesselényi utca, Budapest. The incident date is not stated.';
  const p=new Pipeline(s,{reader:{read:async()=>({url:'https://www.police.hu/undated',body:`<article><h1>Knife incident</h1><p>${article}</p></article>`})},triage:{check:async()=>({keep:true,defer:false,reason:'Подходит',method:'test'})},model:{json:async(stage,input,{validate})=>{
    stages.push(stage);if(stage!=='identify')throw new Error(`Unexpected expensive stage: ${stage}`);
    return validate({incidents:[{title:'Knife incident at Wesselényi utca',summary:'A man was stabbed in Budapest.',type:'assault',occurredAt:null,location:{city:'Budapest',label:'Wesselényi utca',precision:'street'},caseReferences:[],facts:[{fact:'A man was stabbed.',quote:'A man was stabbed at Wesselényi utca, Budapest.'}]}]});
  }}});
  try{
    const result=await p.ingest('https://www.police.hu/undated');
    assert.deepEqual(stages,['identify']);assert.equal(result.deferredDate,1);
    const saved=s.event(1);assert.equal(saved.state,'awaiting-date');assert.equal(saved.canonical.occurredAt,null);
    const due=Date.parse(s.db.prepare("SELECT due_at FROM jobs WHERE kind='resolve-date'").get().due_at);
    assert.ok(due>Date.now()+60*60000&&due<Date.now()+3*3600000,'the first fact check is two hours after discovery');
    assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind IN ('gather','prepare','review','translate')").get().n,0);
  }finally{s.close();}
});
test('a matched uninteresting event is retained as an ignored update and never reaches extraction',async()=>{
  const s=new Store(':memory:'),dated={...event,occurredAt:day,timePrecision:'day',location:{city:'Budapest',label:'Wesselényi utca tram stop',precision:'street'}};
  s.db.prepare("INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical,editorial_mark,editorial_reasons) VALUES(1,?,?,?,?,?,?)").run('not-for-map','2026-09-20',day,JSON.stringify(dated),'uninteresting','["self-risk"]');
  const article='A man was stabbed at Wesselényi utca tram stop in Budapest on 20 September 2026.';let stages=[];
  const p=new Pipeline(s,{reader:{read:async()=>({url:'https://www.police.hu/known',body:`<article><h1>Known incident</h1><p>${article}</p></article>`})},triage:{check:async()=>({keep:true,defer:false,reason:'Подходит',method:'test'})},model:{json:async(stage,input,{validate})=>{
    stages.push(stage);
    if(stage==='identify')return validate({incidents:[{title:'Man stabbed at Wesselényi utca tram stop',summary:'A man was stabbed in Budapest.',type:'assault',occurredAt:day,location:dated.location,caseReferences:[],facts:[{fact:'A man was stabbed.',quote:article}]}]});
    if(stage==='compare')return validate({decision:'repeat',eventId:1,reason:'Same place, day and victim'});
    throw new Error(`Unexpected expensive stage: ${stage}`);
  }}});
  try{
    const result=await p.ingest('https://www.police.hu/known');
    assert.equal(result.repeat,true);assert.deepEqual(stages,['identify','compare']);
    assert.equal(s.db.prepare('SELECT count(*) n FROM ignored_updates WHERE event_id=1').get().n,1);
    assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind IN ('gather','prepare','review')").get().n,0);
  }finally{s.close();}
});
test('new dated coverage can nominate an undated incident for comparison; date filter is persisted',()=>{
  assert.equal(matchCandidates({...event,occurredAt:day},[{id:1,canonical:event}]).length,1);
  const filters=normalizeFilters({dateStatus:'pending'});assert.equal(filters.dateStatus,'pending');
  assert.deepEqual(filterEvents([{id:1,occurred_at:null},{id:2,occurred_at:day}],filters).map(e=>e.id),[1]);
});

