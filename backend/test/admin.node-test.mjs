import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,hash} from '../store.mjs';
import {createAdmin} from '../admin-server.mjs';
import {translationStrings} from '../contract.mjs';
import {migratePublic} from '../publish.mjs';
import {DatabaseSync} from 'node:sqlite';
import {displayStrings} from '../site-localization.mjs';
const url='https://www.police.hu/test',quote='A robbery occurred in Budapest at Test utca. Police are investigating.';
const fixture=()=>({title:'Robbery in Budapest',summary:quote,type:'robbery',status:'investigating',occurredAt:null,timePrecision:'unknown',location:{city:'Budapest',label:'Test utca',precision:'street'},signals:[],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location'].map(field=>({field,documentId:'1',quote}))});
test('editor authenticates, rejects CSRF/stale edits and publishes only a reviewed current revision',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'crimap-admin-')),s=new Store(join(dir,'collector.sqlite')),publicPath=join(dir,'public.sqlite');migratePublic(publicPath);
  const now=new Date().toISOString(),canonical=fixture();
  canonical.media=[{imageUrl:'https://www.police.hu/photo.jpg',sourceUrl:url,outlet:'Police',credit:'Police photographer',caption:'Scene photo',isSensitive:true,rights:'unknown'}];
  canonical.context=[{key:'circumstances',subject:{kind:'event'},topic:'circumstances',text:'Police are investigating.',origin:'source',verification:'unverified',reviewStatus:'pending',evidence:[{kind:'official',label:'Police',url,relation:'supports'}],asOf:now}];
  canonical.evidence.push({field:'context.0',documentId:'1',quote});
  const doc=s.saveDocument({url,sourceId:'police-brfk',sourceKind:'official',text:quote,title:'Test',imageUrls:[canonical.media[0].imageUrl]});
  s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('test',now,JSON.stringify(canonical));
  s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,1,?,?,?)').run(doc.contentHash,JSON.stringify(canonical),now);
  s.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(canonical),'fixture',now);
  const origin='http://localhost',server=createAdmin({store:s,publicPath,tokenHash:hash('test-token'),origin,secure:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${server.address().port}/admin/api/`;
  let cookie='',csrf='';
  const request=(path,body,headers={})=>fetch(root+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin,'Content-Type':'application/json','X-CSRF-Token':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    assert.equal((await request('events')).status,401);
    assert.equal((await request('login',{password:'test-token'})).status,401);
    assert.equal((await request('login',{token:'wrong'})).status,401);
    const login=await request('login',{token:'test-token'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
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
    const retained={...canonical.media[0],imageUrl:'https://www.police.hu/retained.jpg',isSensitive:false,caption:'Retained photo'};
    s.db.prepare('INSERT INTO preparation VALUES(1,3,?,?)').run(JSON.stringify({retainedMedia:[retained]}),now);
    const strings=Object.fromEntries(displayStrings({...modified,retainedMedia:[retained]}).map(text=>[text,text]));
    s.db.prepare('INSERT INTO site_translations VALUES(1,3,?,?)').run(JSON.stringify({en:strings,hu:strings}),now);
    detail=await(await request('events/1')).json();assert.equal(detail.blockers.length,0);
    const listing=await(await request('events')).json();assert.equal(listing.events[0].ready,true);assert.equal(listing.events[0].first_seen_at,now);assert.equal(listing.events[0].facets.homicide,false);assert.equal(listing.events[0].canonical,undefined);
    assert.equal((await request('events/1/publish',{revision:3,approvalToken:'stale',confirm:true})).status,409);
    assert.equal((await request('events/1/publish',{revision:3,approvalToken:detail.approvalToken,confirm:true})).status,200);
    assert.equal(s.event(1).published_revision,3);
    const publicDb=new DatabaseSync(publicPath);
    try {
      const photos=publicDb.prepare('SELECT image_url,source_url,credit,caption,is_sensitive FROM incident_media ORDER BY id').all();
      assert.equal(photos.length,2);assert.equal(photos[0].image_url,canonical.media[0].imageUrl);assert.equal(photos[0].source_url,url);assert.equal(photos[0].credit,'Police photographer');assert.equal(photos[0].is_sensitive,1);assert.equal(photos[1].caption,'Retained photo');assert.equal(photos[1].is_sensitive,0);
      assert.equal(publicDb.prepare('SELECT count(*) n FROM incident_context').get().n,1);
      detail=await(await request('events/1')).json();
      assert.equal((await request('events/1/publish',{revision:3,approvalToken:detail.approvalToken,confirm:true})).status,200);
      assert.equal(publicDb.prepare('SELECT count(*) n FROM incidents').get().n,1);
      assert.equal(publicDb.prepare('SELECT count(*) n FROM incident_media').get().n,2);
      assert.equal((await request('events/1/withdraw',{revision:2,confirm:true})).status,409);
      assert.equal((await request('events/1/withdraw',{revision:3})).status,400);
      assert.equal((await request('events/1/withdraw',{revision:3,confirm:true})).status,200);
      assert.ok(s.event(1).withdrawn_at);assert.equal(s.event(1).published_revision,null);
      assert.equal(publicDb.prepare("SELECT count(*) n FROM incidents i WHERE NOT EXISTS (SELECT 1 FROM incident_metadata m WHERE m.incident_id=i.id AND json_extract(m.details,'$.hidden')=1)").get().n,0);
      detail=await(await request('events/1')).json();assert.equal(detail.published,null);
      assert.equal((await request('events/1/publish',{revision:3,approvalToken:detail.approvalToken,confirm:true})).status,200);
      assert.equal(s.event(1).withdrawn_at,null);assert.equal(s.event(1).public_id,1);
      assert.equal(publicDb.prepare("SELECT json_extract(details,'$.hidden') hidden FROM incident_metadata WHERE incident_id=1").get().hidden,null);

      const beforeMark=s.event(1),approvalBeforeMark=(await(await request('events/1')).json()).approvalToken;
      assert.equal((await request('events/1/mark',{mark:'priority'},{'X-CSRF-Token':''})).status,403);
      assert.equal((await request('events/1/mark',{mark:'invalid'})).status,400);
      assert.equal((await request('events/999/mark',{mark:'priority'})).status,404);
      for(const mark of ['priority','uninteresting','normal']){
        const response=await request('events/1/mark',{mark});assert.equal(response.status,200);assert.equal((await response.json()).editorial_mark,mark);
        assert.equal((await(await request('events')).json()).events[0].editorial_mark,mark);
        const markedDetail=await(await request('events/1')).json();assert.equal(markedDetail.editorial_mark,mark);assert.equal(markedDetail.approvalToken,approvalBeforeMark);
        if(mark==='uninteresting')assert.equal((await request('events/1/review',{revision:3})).status,409);
        assert.deepEqual(s.event(1),{...beforeMark,editorial_mark:mark});
        assert.equal(publicDb.prepare("SELECT json_extract(details,'$.hidden') hidden FROM incident_metadata WHERE incident_id=1").get().hidden,null);
      }

    }finally{publicDb.close();}

    s.db.prepare("INSERT INTO campaigns VALUES('archive','a','b',5,'budget-exhausted',?)").run(now);
    s.enqueue('article','paused',{campaignId:'archive'});s.db.prepare("UPDATE jobs SET state='paused' WHERE job_key='paused'").run();
    assert.equal((await request('campaigns/archive/budget',{budget:10})).status,200);
    assert.equal(s.db.prepare("SELECT budget_usd FROM campaigns WHERE id='archive'").get().budget_usd,10);
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE job_key='paused'").get().state,'paused');
    assert.equal((await(await request('events')).json()).campaigns[0].paused,1);
    assert.equal((await request('campaigns/archive/resume',{}, {'X-CSRF-Token':''})).status,403);
    const resumed=await request('campaigns/archive/resume',{});assert.equal(resumed.status,200);assert.equal((await resumed.json()).resumed,1);
    assert.equal(s.db.prepare("SELECT state FROM jobs WHERE job_key='paused'").get().state,'queued');
    assert.equal((await(await request('campaigns/archive/resume',{})).json()).resumed,0);
    assert.equal((await request('campaigns/archive/budget',{budget:-1})).status,400);
    s.reserveCost('review','fixture','budget-check',4,.5,now,'archive');
    assert.equal((await request('campaigns/archive/budget',{budget:3})).status,409);
    assert.equal((await request('logout',{})).status,200);assert.equal((await request('events')).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));s.close();rmSync(dir,{recursive:true,force:true});}
});
test('login rate limit and secure production cookie',async()=>{
  const s=new Store(':memory:'),server=createAdmin({store:s,tokenHash:hash('correct'),origin:'https://crimap.online'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/admin/api/login`;
  const post=token=>fetch(url,{method:'POST',headers:{Origin:'https://crimap.online','Content-Type':'application/json'},body:JSON.stringify({token})});
  try{
    const ok=await post('correct');assert.equal(ok.status,200);assert.ok(ok.headers.get('set-cookie').includes('; Secure'));
    for(let n=0;n<5;n++)assert.equal((await post('wrong')).status,401);
    assert.equal((await post('correct')).status,429);
  }finally{await new Promise(resolve=>server.close(resolve));s.close();}
});
