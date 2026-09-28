import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {Triage,cheapDecision} from '../triage.mjs';
import {needsFatalityConfirmation,reportsDeath} from '../traffic-policy.mjs';
import {queueEditorialPreparation} from '../editorial-workflow.mjs';
import {setEditorialMark} from '../admin-actions.mjs';
import {filterEvents,normalizeFilters} from '../admin/filters.mjs';
import {publish} from '../publish.mjs';
import {eventDetail} from '../editorial.mjs';

const day=new Date(Date.now()-86400000).toISOString();
const crash={title:'Two cars collided in Budapest',summary:'Two cars collided at Rákosi út in Budapest. One driver was seriously injured.',type:'traffic-accident',status:'investigating',occurredAt:day,timePrecision:'day',location:{city:'Budapest',label:'Rákosi út',precision:'street'},signals:['injury'],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:[]};
function seed(s,event=crash){s.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical) VALUES(1,?,?,?,?)').run('crash',day,event.occurredAt,JSON.stringify(event));}
const fatal={...crash,signals:['death'],summary:'One driver died from injuries sustained in the collision.',evidence:[{field:'signals',documentId:'1',quote:'A sofőr a kórházban belehalt sérüléseibe.'}]};

test('road crashes with unknown, minor or critical outcomes wait for free; violence still passes',async()=>{
 let calls=0;const triage=new Triage({json:async(_stage,_payload,{validate})=>{calls++;return validate({keep:true,defer:false,reason:'Подтверждено нападение'});}});
 for(const text of ['Senki sem sérült meg.','Mentőhelikopter érkezett.','Újraélesztették, életveszélyes állapotban vitték kórházba.','A sérülésekről nincs információ.']){
  assert.equal(cheapDecision('Baleset Budapesten',text,{complete:true}).decision,'defer');
  assert.equal((await triage.check({title:'Baleset Budapesten',text})).defer,true);
 }
 assert.equal((await triage.check({title:'Késelés Budapesten a villamoson',text:'Megszúrtak egy embert.'})).keep,true);
 assert.equal(calls,1);
 assert.equal(needsFatalityConfirmation({...crash,type:'assault'}),false);
});

test('death gate needs source-grounded outcome, not severe injuries, speculation or a stray keyword',()=>{
 assert.equal(needsFatalityConfirmation(crash),true);
 assert.equal(needsFatalityConfirmation({...fatal,evidence:[]}),true);
 assert.equal(needsFatalityConfirmation({...fatal,evidence:[{field:'summary',quote:'A driver died in another crash last year.'}]}),true);
 for(const text of ['No one died.','A non-fatal collision.','He nearly died.','A sofőr nem halt meg.','Погибших нет.','A halálos áldozat nélküli baleset.'])assert.equal(reportsDeath(text),false,text);
 for(const text of ['A nő a helyszínen életét vesztette.','A sofőr a kórházban belehalt sérüléseibe.','One person died in the crash.','Пешеход скончался от травм.'])assert.equal(reportsDeath(text),true,text);
 assert.equal(needsFatalityConfirmation(fatal),false);
});

test('old queued Pro, translations and manual priority cannot bypass waiting; source checks remain',async()=>{
 const s=new Store(':memory:');try{seed(s);
  for(const kind of ['review','prepare','translate','resolve-date'])s.db.prepare('INSERT INTO jobs(kind,job_key,payload,due_at) VALUES(?,?,?,?)').run(kind,'1',JSON.stringify({eventId:1}),day);
  let proCalls=0;const p=new Pipeline(s,{reviewer:{json:()=>{proCalls++;throw new Error('Pro must not run');}},model:{json:()=>{throw new Error('Flash must not run');}}});
  assert.equal((await p.review(1,1)).awaitingFatality,true);
  assert.equal(s.event(1).state,'awaiting-fatality');
  assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE state='waiting-fatality'").get().n,4);
  assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='recheck'").get().state,'queued');
  assert.equal(queueEditorialPreparation(s,1),false);
  setEditorialMark(s,1,'priority','test');s.enqueue('review','forced',{eventId:1,forceReview:true});
  assert.equal(await p.runOne({kinds:['review']}),false);assert.equal(proCalls,0);
  assert.throws(()=>publish(s,1,'unused',{reviewer:'test'}),/ДТП отложено/);
 }finally{s.close();}
});

test('in-flight legacy job is held before spending anything and keeps no active lease',async()=>{
 const s=new Store(':memory:');try{seed(s);
  s.db.prepare("INSERT INTO jobs(kind,job_key,payload,due_at) VALUES('review','1:1','{\"eventId\":1}',?)").run(day);
  const model={json:()=>{throw new Error('No model may run');}};const p=new Pipeline(s,{model,reviewer:model});
  assert.equal(await p.runOne({kinds:['review']}),true);
  const j=s.db.prepare("SELECT state,lease_token FROM jobs WHERE kind='review'").get();
  assert.equal(j.state,'waiting-fatality');assert.equal(j.lease_token,null);
 }finally{s.close();}
});

test('unchanged saved article is checked without models or paid research while waiting',async()=>{
 const s=new Store(':memory:');try{seed(s);
  const d=s.saveDocument({url:'https://www.police.hu/test',sourceId:'police-brfk',sourceKind:'official',title:crash.title,text:crash.summary});
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,?,?,?,?)').run(d.id,d.contentHash,'{}',day);
  s.log('document-processed',`${d.id}:${d.contentHash}`,{events:1});s.holdForFatality(1);
  const model={json:()=>{throw new Error('No model may run');}};
  const p=new Pipeline(s,{model,reviewer:model,search:{key:'test',query:()=>{throw new Error('No paid search');}}});p.readDocument=async()=>d;
  assert.ok(await p.recheck(1));assert.equal(s.event(1).state,'awaiting-fatality');
 }finally{s.close();}
});

test('new fatal update merges into waiting event and resumes gathering, retaining observations',async()=>{
 const s=new Store(':memory:');try{seed(s);s.holdForFatality(1);
  const text='One driver died in the collision at Rákosi út in Budapest.';
  const d=s.saveDocument({url:'https://www.police.hu/follow-up',sourceId:'police-brfk',sourceKind:'official',title:'Fatal collision',text});
  const incoming={...fatal,title:'Fatal collision in Budapest',summary:text,evidence:['title','summary','type','status','location','occurredAt','signals'].map(field=>({field,documentId:d.id,quote:text}))};
  const p=new Pipeline(s,{preparation:{},model:{json:async(stage,payload,{validate})=>{assert.equal(stage,'merge');return validate({sameEvent:true,hasNewInformation:true,reason:'Victim died later',event:incoming});}}});
  assert.equal(await p.upsert(incoming,d,{confirmedTarget:1}),1);
  assert.equal(s.event(1).revision,2);assert.equal(s.event(1).state,'draft');
  assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='gather'").get().state,'queued');
  assert.equal(s.db.prepare('SELECT count(*) n FROM events').get().n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM observations WHERE event_id=1').get().n,1);
 }finally{s.close();}
});

test('no date does not launch date research while waiting; uninteresting cancels source checks too',()=>{
 const s=new Store(':memory:');try{seed(s,{...crash,occurredAt:null,timePrecision:'unknown'});
  s.enqueue('resolve-date',1,{eventId:1});assert.equal(s.event(1).state,'awaiting-fatality');
  assert.equal(s.db.prepare("SELECT count(*) n FROM jobs WHERE kind='resolve-date'").get().n,0);
  assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='recheck'").get().state,'queued');
  setEditorialMark(s,1,'uninteresting','test');assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='recheck'").get().state,'cancelled');
 }finally{s.close();}
});

test('old Pro approval remains history but detail blocks publication; waiting filter persists',()=>{
 const s=new Store(':memory:');try{seed(s);
  s.db.prepare('INSERT INTO quality_reviews VALUES(1,1,?,?,?)').run('pro',JSON.stringify({verdict:'pass',issues:[],summary:'Old policy'}),day);
  const d=eventDetail(s,1,null);assert.equal(d.awaitingFatality,true);assert.ok(d.blockers.some(s=>s.startsWith('ДТП отложено')));assert.equal(d.quality.payload.verdict,'pass');
  const rows=[{id:1,awaitingFatality:true,verdict:'pass',ready:true,occurred_at:day},{id:2,verdict:'pass',ready:true,occurred_at:day}];
  assert.deepEqual(filterEvents(rows,{review:'pass'}).map(e=>e.id),[2]);
  assert.deepEqual(filterEvents(rows,normalizeFilters({review:'awaiting-fatality'})).map(e=>e.id),[1]);
 }finally{s.close();}
});
