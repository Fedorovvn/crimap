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
    s.db.prepare("INSERT INTO campaigns VALUES('archive','a','b',5,'budget-exhausted','2026-09-26')").run();
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
    s.holdForDate(1);await p.runOne({kinds:['resolve-date']});
    assert.equal(s.event(1).revision,2);assert.equal(s.event(1).state,'draft');assert.equal(s.event(1).occurred_at,day);
    assert.equal(s.event(1).public_id,null);assert.equal(s.event(1).canonical.evidence[0].quote,d.text);
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='gather'").get().state,'queued');
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='resolve-date'").get().state,'done');
  }finally{s.close();}
});
test('new dated coverage can nominate an undated incident for comparison; date filter is persisted',()=>{
  assert.equal(matchCandidates({...event,occurredAt:day},[{id:1,canonical:event}]).length,1);
  const filters=normalizeFilters({dateStatus:'pending'});assert.equal(filters.dateStatus,'pending');
  assert.deepEqual(filterEvents([{id:1,occurred_at:null},{id:2,occurred_at:day}],filters).map(e=>e.id),[1]);
});
