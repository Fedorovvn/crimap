import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.mjs';
import {createAdmin,passwordHash} from '../admin-server.mjs';
import {translationStrings} from '../contract.mjs';
import {migratePublic} from '../publish.mjs';
const url='https://www.police.hu/test',quote='A robbery occurred in Budapest at Test utca. Police are investigating.';
const fixture=()=>({title:'Robbery in Budapest',summary:quote,type:'robbery',status:'investigating',occurredAt:null,timePrecision:'unknown',location:{city:'Budapest',label:'Test utca',precision:'street'},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location'].map(field=>({field,documentId:'1',quote}))});
test('editor authenticates, rejects CSRF/stale edits and publishes only a reviewed current revision',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'crimap-admin-')),s=new Store(join(dir,'collector.sqlite')),publicPath=join(dir,'public.sqlite');migratePublic(publicPath);
  const now=new Date().toISOString(),canonical=fixture();
  const doc=s.saveDocument({url,sourceId:'police-brfk',sourceKind:'official',text:quote,title:'Test'});
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('test',now,JSON.stringify(canonical));
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,1,?,?,?)').run(doc.contentHash,JSON.stringify(canonical),now);
  s.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(canonical),'fixture',now);
  const origin='http://localhost',server=createAdmin({store:s,publicPath,password:passwordHash('test-password'),origin,secure:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${server.address().port}/admin/api/`;
  let cookie='',csrf='';
  const request=(path,body,headers={})=>fetch(root+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin,'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    assert.equal((await request('events')).status,401);
    assert.equal((await request('login',{password:'wrong'})).status,401);
    const login=await request('login',{password:'test-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
    assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
    assert.equal((await request('events/1/review',{revision:1},{'X-CSRF-Token':''})).status,403);
    assert.equal((await request('events/1/review',{revision:1},{origin:'https://evil.example'})).status,403);
    assert.equal((await request('events')).status,200);
    let detail=await(await request('events/1')).json();assert.equal(detail.documents[0].text,quote);assert.equal(detail.blockers.length,3);
    assert.equal((await request('events/1/publish',{revision:1,approvalToken:detail.approvalToken,confirm:true})).status,422);
    const modified=structuredClone(canonical);modified.location.latitude=47.5;modified.location.longitude=19.06;
    s.enqueue('translate',1,{eventId:1});
    assert.equal((await request('events/1/save',{revision:1,canonical:modified,strings:translationStrings(canonical)})).status,200);
    assert.equal(s.event(1).revision,2);assert.equal(s.db.prepare("SELECT state FROM jobs WHERE kind='translate'").get().state,'done');
    assert.equal((await request('events/1/save',{revision:1,canonical:modified})).status,409);
    assert.equal((await request('events/1/save',{revision:2,canonical:{...modified,type:'made-up'}})).status,422);assert.equal(s.event(1).revision,2);
    modified.occurredAt='2026-09-20T12:00:00Z';modified.timePrecision='day';modified.evidence.push({field:'occurredAt',documentId:'1',quote});
    assert.equal((await request('events/1/save',{revision:2,canonical:modified,strings:translationStrings(modified)})).status,200);
    s.db.prepare('INSERT INTO quality_reviews VALUES(1,3,?,?,?)').run('fixture',JSON.stringify({verdict:'pass',summary:'ok',issues:[],requests:[]}),now);
    detail=await(await request('events/1')).json();assert.equal(detail.blockers.length,0);
    assert.equal((await request('events/1/publish',{revision:3,approvalToken:'stale',confirm:true})).status,409);
    assert.equal((await request('events/1/publish',{revision:3,approvalToken:detail.approvalToken,confirm:true})).status,200);
    assert.equal(s.event(1).published_revision,3);
    assert.equal((await request('logout',{})).status,200);assert.equal((await request('events')).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));s.close();rmSync(dir,{recursive:true,force:true});}
});
test('login rate limit and secure production cookie',async()=>{
  const s=new Store(':memory:'),server=createAdmin({store:s,password:passwordHash('correct'),origin:'https://crimap.online'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/admin/api/login`;
  const post=password=>fetch(url,{method:'POST',headers:{Origin:'https://crimap.online','Content-Type':'application/json'},body:JSON.stringify({password})});
  try{
    const ok=await post('correct');assert.equal(ok.status,200);assert.ok(ok.headers.get('set-cookie').includes('; Secure'));
    for(let n=0;n<5;n++)assert.equal((await post('wrong')).status,401);
    assert.equal((await post('correct')).status,429);
  }finally{await new Promise(resolve=>server.close(resolve));s.close();}
});
