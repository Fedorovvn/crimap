import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../store.mjs';
import {Pipeline} from '../pipeline.mjs';
import {publish,migratePublic} from '../publish.mjs';
import {eventDetail,documentsFor} from '../editorial.mjs';
import {readPublication,comparisonFor,publicationChanges,reviewChanges} from '../publication-comparison.mjs';
import {displayStrings} from '../site-localization.mjs';
import {renderChanges,highlightChange} from '../admin/changes.mjs';

const quote='Police reported a robbery in Budapest on 20 September 2026. A man was detained.';
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'crimap-comparison-')),s=new Store(':memory:'),path=join(dir,'public.sqlite');migratePublic(path);
 const event={title:'Robbery in Budapest',summary:quote,type:'robbery',status:'suspects-detained',occurredAt:'2026-09-20T00:00:00+02:00',timePrecision:'day',location:{city:'Budapest',label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},signals:['suspect-detained'],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:['title','summary','type','status','location','occurredAt','signals'].map(field=>({field,documentId:'1',quote}))};
 const doc=s.saveDocument({url:'https://www.police.hu/test',sourceId:'police',sourceKind:'official',title:event.title,text:quote,imageUrls:[]});
 s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical) VALUES(1,?,?,?)').run('test','2026-09-26',JSON.stringify(event));
 s.db.prepare('INSERT INTO observations(event_id,document_id,content_hash,extracted,created_at) VALUES(1,?,?,?,?)').run(doc.id,doc.contentHash,JSON.stringify(event),'2026-09-26');
 function drafts(revision,value=event){const strings=Object.fromEntries(displayStrings(value).map(t=>[t,t]));s.db.prepare('INSERT INTO translations VALUES(1,?,?,?,?,?)').run(revision,'ru',JSON.stringify(value),'fixture','2026-09-26');s.db.prepare('INSERT INTO site_translations VALUES(1,?,?,?)').run(revision,JSON.stringify({en:strings,hu:strings}),'2026-09-26');s.db.prepare('INSERT INTO preparation VALUES(1,?,?,?)').run(revision,'{}','2026-09-26');return {en:strings,hu:strings};}
 const languages=drafts(1);s.db.prepare('INSERT INTO quality_reviews VALUES(1,1,?,?,?)').run('fixture',JSON.stringify({verdict:'pass'}),'2026-09-26');publish(s,1,path,{reviewer:'Fixture',includeContext:true,includeLegal:true});
 return {s,path,event,languages,drafts,close(){s.close();rmSync(dir,{recursive:true,force:true});}};
}

test('actual public projection has no false differences for sources, dates, translations and preparation',()=>{
 const f=fixture();try{
  const current=readPublication(f.path,'test'),comparison=comparisonFor(current,f.event,documentsFor(f.s,1),{},f.languages);
  assert.deepEqual(comparison.changes,[]);assert.equal(comparison.revision,1);assert.equal(current.snapshot.status,'Подозреваемые задержаны');
  const db=new DatabaseSync(f.path);db.prepare("UPDATE incident_metadata SET details=json_set(details,'$.hidden',1)").run();db.close();assert.equal(readPublication(f.path,'test'),null);
 }finally{f.close();}
});

test('comparison matches participants by key, shows removals and additions, and compares map and languages',()=>{
 const a={participants:[{key:'one',label:'Мужчина',profile:{age:30}},{key:'two',label:'Женщина'}],location:{latitude:47.5},media:[{imageUrl:'https://example.com/a.jpg',caption:'Старая'}],translations:{hu:{Текст:'Régi'}}};
 const b={...a,participants:[a.participants[1],{...a.participants[0],profile:{age:31}}],location:{latitude:47.51},media:[{imageUrl:'https://example.com/b.jpg',caption:'Новая'}],translations:{hu:{Текст:'Új'}}};
 const changes=publicationChanges(a,b);
 assert.equal(changes.filter(c=>c.group==='participants').length,1);assert.equal(changes.find(c=>c.path==='participants.one.profile.age').before,30);
 assert.ok(changes.some(c=>c.group==='media'&&c.kind==='removed'));assert.ok(changes.some(c=>c.group==='media'&&c.kind==='added'));assert.ok(changes.some(c=>c.group==='translations'));assert.ok(changes.some(c=>c.group==='location'));
});

test('Pro receives the real published version, saves a comparison baseline and cannot publish over a changed baseline',async()=>{
 const f=fixture();try{
  const changed={...f.event,title:'Robbery suspect detained'};f.s.db.prepare('UPDATE events SET canonical=?,revision=2 WHERE id=1').run(JSON.stringify(changed));f.drafts(2,changed);
  let received=false;
  const p=new Pipeline(f.s,{publicPath:f.path,model:{json(){throw new Error('Drafts already prepared');}},reviewer:{model:'pro',json:async(stage,payload,{validate})=>{received=true;assert.ok(payload.schema.required.includes('publicationSummary'));assert.equal(payload.currentPublication.snapshot.title,f.event.title);assert.equal(payload.currentPublication.revision,1);assert.ok(payload.proposedPublicationChanges.some(c=>c.path==='title'));return validate({legalCoverage:{status:'no-suspect',reason:'В источнике нет сведений о подозреваемом.',participants:[]},verdict:'pass',summary:'Проверено',publicationSummary:'В заголовке уточнено задержание подозреваемого.',issues:[],requests:[],final:{}});}}});
  await p.review(1,2);assert.ok(received);
  const detail=eventDetail(f.s,1,f.path);assert.equal(detail.comparison.reviewed,true);assert.equal(detail.blockers.length,0);assert.ok(detail.comparison.changes.some(c=>c.path==='title'));assert.equal(detail.published.title,f.event.title);
  const db=new DatabaseSync(f.path);db.prepare("UPDATE incidents SET summary='Updated separately' WHERE slug='test'").run();db.close();
  const stale=eventDetail(f.s,1,f.path);assert.notEqual(stale.approvalToken,detail.approvalToken);assert.equal(stale.comparison.reviewed,false);assert.ok(stale.blockers.some(t=>t.includes('сравнила')));
  assert.throws(()=>publish(f.s,1,f.path,{reviewer:'Fixture'}),/compared by Pro/);assert.equal(readPublication(f.path,'test').title,f.event.title);
 }finally{f.close();}
});

test('publication changed during Pro processing invalidates the result rather than recording stale approval',async()=>{
 const f=fixture();try{
  f.s.db.prepare('UPDATE events SET revision=2 WHERE id=1').run();f.drafts(2);
  const p=new Pipeline(f.s,{publicPath:f.path,model:{},reviewer:{model:'pro',json:async(stage,payload,{validate})=>{const out=validate({legalCoverage:{status:'no-suspect',reason:'В источнике нет сведений о подозреваемом.',participants:[]},verdict:'pass',summary:'Проверено',publicationSummary:'Содержательных изменений нет.',issues:[],requests:[],final:{}});const db=new DatabaseSync(f.path);db.prepare("UPDATE incidents SET title='Changed while reviewing'").run();db.close();return out;}}});
  await assert.rejects(p.review(1,2),/Published version changed/);assert.equal(f.s.db.prepare('SELECT count(*) n FROM quality_reviews WHERE revision=2').get().n,0);
 }finally{f.close();}
});

test('diff highlights only changed words, escapes source HTML and never hides deletions in a Pro summary',()=>{
 const pair=highlightChange('Мужчина задержан','Мужчина освобождён');assert.ok(pair.before.includes('<del>задержан</del>'));assert.ok(pair.after.includes('<ins>освобождён</ins>'));assert.ok(!pair.before.includes('<del>Мужчина'));
 const changes=publicationChanges({summary:'<img src=x onerror=alert(1)>',participants:[{key:'one',label:'Мужчина'}]},{summary:'Исправлено',participants:[]});
 const html=renderChanges({changes,counts:{added:0,changed:1,removed:1},revision:2},{summary:'<script>bad</script>',reviewed:true});
 assert.ok(html.includes('Сейчас на сайте'));assert.ok(html.includes('После обновления'));assert.ok(html.includes('Будет удалено'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
});

test('Pro change index does not duplicate long translations or omit the changed areas',()=>{
 const text='Длинный перевод '.repeat(2000);
 const changes=[{path:'title',kind:'changed',before:'old',after:'new',label:'Заголовок'},{path:'translations.hu.'+encodeURIComponent(text),kind:'added',after:text},{path:'translations.hu.other',kind:'removed',before:text}];
 const compact=reviewChanges(changes);
 assert.deepEqual(compact,[{path:'title',kind:'changed'},{path:'translations.hu',kind:'changed',changedFields:2}]);
 assert.ok(JSON.stringify(compact).length<200);
 assert.equal(changes[1].after,text);
});

test('updating publication replaces participants, including an explicitly empty list',()=>{
 const f=fixture();try{
  const person=key=>({key,role:'suspect',label:key,status:'detained',profile:{kind:'person'},sourceUrl:'https://www.police.hu/test',sourceLabel:'Police',asOf:'2026-09-20T00:00:00Z'});
  for(const [revision,keys] of [[2,['one','two']],[3,['new-person']],[4,[]]]){
   const baseline=readPublication(f.path,'test');
   const event={...f.event,participants:keys.map(person)};
   f.s.db.prepare('UPDATE events SET revision=?,canonical=? WHERE id=1').run(revision,JSON.stringify(event));f.drafts(revision,event);
   f.s.db.prepare('INSERT INTO quality_reviews VALUES(1,?,?,?,?)').run(revision,'test',JSON.stringify({verdict:'pass',publicationBaseline:baseline.fingerprint}),'2026-09-27');
   publish(f.s,1,f.path,{reviewer:'Test'});
   assert.deepEqual(readPublication(f.path,'test').snapshot.participants.map(p=>p.key),keys);
   const db=new DatabaseSync(f.path);try{assert.deepEqual(db.prepare('SELECT participant_key FROM incident_participants').all().map(p=>p.participant_key),keys);}finally{db.close();}
  }
 }finally{f.close();}
});
