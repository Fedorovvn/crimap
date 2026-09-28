import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.mjs';
import {Pipeline,qualifiesForAutoPublication} from '../pipeline.mjs';
import {migratePublic} from '../publish.mjs';
import {applyTranslation,translationStrings} from '../contract.mjs';
import {displayStrings} from '../site-localization.mjs';

const now='2026-09-28T10:00:00.000Z';
const quote='A pedestrian was attacked on a Budapest street. Police are investigating.';
const event={title:'Pedestrian attacked in Budapest',summary:quote,type:'assault',status:'investigating',occurredAt:'2026-09-28T08:15:00.000Z',timePrecision:'exact',location:{city:'Budapest',label:'Test utca',precision:'street',latitude:47.501,longitude:19.051},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location','occurredAt'].map(field=>({field,documentId:'1',quote}))};

test('Pro-approved assaults are published automatically by a separate retryable job',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'crimap-auto-publish-')),publicPath=join(dir,'public.sqlite'),store=new Store(':memory:');migratePublic(publicPath);
  try{
    const document=store.saveDocument({url:'https://www.police.hu/test',sourceId:'police',sourceKind:'official',title:event.title,text:quote,imageUrls:[]});
    store.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical) VALUES(1,?,?,?,?)').run('auto-assault',now,event.occurredAt,JSON.stringify(event));
    store.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(?,?,?,?,?)').run(1,document.id,document.contentHash,JSON.stringify(event),now);
    const russian=applyTranslation(event,{language:'ru',strings:{...translationStrings(event),title:'Нападение на пешехода в Будапеште',summary:'На улице Будапешта напали на пешехода. Полиция ведёт расследование.','location.label':'Тестовая улица'}});
    const strings=Object.fromEntries(displayStrings(russian).map(value=>[value,value]));
    store.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(russian),'flash',now);
    store.db.prepare('INSERT INTO site_translations VALUES(1,1,?,?)').run(JSON.stringify({en:strings,hu:strings}),now);
    const reviewer={model:'pro',json:async(_stage,_payload,{validate})=>validate({legalCoverage:{status:'no-suspect',reason:'No suspect is named in the source.',participants:[]},verdict:'pass',summary:'Final card is verified.',issues:[],requests:[],final:{}})};
    const pipeline=new Pipeline(store,{model:{model:'flash'},reviewer,publicPath,autoPublish:true});

    assert.equal((await pipeline.review(1,1)).verdict,'pass');
    assert.equal(store.db.prepare("SELECT state FROM jobs WHERE kind='publish' AND job_key='1:1'").get().state,'queued');
    assert.equal(await pipeline.runOne({kinds:['publish']}),true);
    assert.equal(store.event(1).state,'published');
    const publicDb=new DatabaseSync(publicPath,{readOnly:true});
    try{assert.equal(publicDb.prepare('SELECT title FROM incidents WHERE slug=?').get('auto-assault').title,'Нападение на пешехода в Будапеште');}finally{publicDb.close();}
    assert.equal(store.db.prepare("SELECT count(*) n FROM audit WHERE action='auto-published'").get().n,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('automatic publication is limited to assaults and fatal outcomes',()=>{
  assert.equal(qualifiesForAutoPublication({type:'assault',signals:[]}),true);
  assert.equal(qualifiesForAutoPublication({type:'traffic-accident',signals:['death']}),true);
  assert.equal(qualifiesForAutoPublication({type:'traffic-accident',signals:['injury']}),false);
});
