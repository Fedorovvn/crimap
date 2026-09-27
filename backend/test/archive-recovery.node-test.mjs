import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {recoverArchive} from '../archive-recovery.mjs';
const campaign=s=>s.db.prepare('INSERT INTO campaigns(id,from_date,to_date,budget_usd,created_at) VALUES(?,?,?,?,?)').run('archive','2026-07-01','2026-09-26',15,'2026-09-26');
const event={title:'Robbery in Budapest',summary:'Police reported a robbery in Budapest.',type:'robbery',status:'investigating',occurredAt:null,timePrecision:'unknown',location:{city:'Budapest',label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location'].map(field=>({field,documentId:'1',quote:'Police reported a robbery in Budapest.'}))};
function seed(s,id=1){s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,campaign_id) VALUES(?,?,?,?,?)').run(id,'test-'+id,'2026-09-26',JSON.stringify(event),'archive');}
test('legacy retries inherit archive allowance despite exhausted daily budget; explicit new work stays daily',async()=>{
 const s=new Store(':memory:');try{campaign(s);seed(s);s.reserveCost('test','flash','daily',.5,.5);
  s.db.prepare("INSERT INTO jobs(kind,job_key,payload,due_at) VALUES('review','1:1',?,?)").run(JSON.stringify({eventId:1,campaignId:null}),'2026-01-01');
  const p=new Pipeline(s,{model:{},reviewer:{}});
  p.review=async()=>{assert.equal(p.reviewer.campaignId,'archive');s.reserveCost('review','pro','archive',.01,.5,undefined,p.reviewer.campaignId);s.enqueue('translate','1',{eventId:1,campaignId:p.campaignId,budgetScope:p.budgetScope});};
  await p.runOne();assert.equal(s.db.prepare("SELECT campaign_id FROM usage WHERE stage='review'").get().campaign_id,'archive');
  assert.equal(JSON.parse(s.db.prepare("SELECT payload FROM jobs WHERE kind='translate'").get().payload).campaignId,'archive');
  s.enqueue('prepare','1',{eventId:1,budgetScope:'daily'});
  assert.equal(JSON.parse(s.db.prepare("SELECT payload FROM jobs WHERE kind='prepare'").get().payload).campaignId,null);
  s.enqueue('recheck','1',{eventId:1});assert.equal(JSON.parse(s.db.prepare("SELECT payload FROM jobs WHERE kind='recheck'").get().payload).campaignId,null);
 }finally{s.close();}
});
test('manual archive retry resumes completed campaign without increasing its cap',()=>{
 const s=new Store(':memory:');try{campaign(s);seed(s);s.db.prepare("UPDATE campaigns SET state='complete-with-errors'").run();s.enqueue('repair','1:1',{eventId:1});
  assert.equal(s.db.prepare('SELECT state FROM campaigns').get().state,'running');assert.equal(s.db.prepare('SELECT budget_usd FROM campaigns').get().budget_usd,15);
 }finally{s.close();}
});
test('recovery restores orphaned review once and does not wake daily jobs or republish',()=>{
 const s=new Store(':memory:');try{campaign(s);seed(s);s.db.prepare('INSERT INTO preparation VALUES(?,?,?,?)').run(1,1,'{}','2026-09-26');
  s.enqueue('article','daily',{budgetScope:'daily'});s.db.prepare("UPDATE jobs SET due_at='2099-01-01' WHERE job_key='daily'").run();
  const report=recoverArchive(s,'archive');assert.deepEqual(report.queued,[{id:1,revision:1,kind:'review'}]);
  assert.equal(s.event(1).published_revision,null);assert.equal(s.db.prepare("SELECT due_at FROM jobs WHERE job_key='daily'").get().due_at,'2099-01-01');
  assert.deepEqual(recoverArchive(s,'archive'),{alreadyRecovered:true});
 }finally{s.close();}
});
test('review runs on an unknown date; legacy repair jobs also use the final Pro editor',async()=>{
 const s=new Store(':memory:');try{campaign(s);seed(s);
  const doc=s.saveDocument({url:'https://www.police.hu/test',sourceId:'police',sourceKind:'official',title:event.title,text:event.summary,imageUrls:[]});
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(1,doc.id,doc.contentHash,JSON.stringify(event),'2026-09-26');
  let reviewed=0;
  const p=new Pipeline(s,{preparation:{},reviewer:{model:'pro',json:async(stage,payload,{validate})=>{reviewed++;assert.ok(payload.schema.properties.verdict);assert.equal(payload.event.occurredAt,null);return validate({verdict:'revise',summary:'Check date in source',issues:[],requests:[]});}},model:{model:'flash',json:async(stage,payload,{validate})=>{assert.notEqual(stage,'repair');return validate({language:payload.language??'ru',strings:payload.strings});}}});
  await p.review(1);assert.ok(reviewed);await p.repair(1,1);assert.equal(reviewed,2);assert.equal(s.event(1).revision,1);
 }finally{s.close();}
});
