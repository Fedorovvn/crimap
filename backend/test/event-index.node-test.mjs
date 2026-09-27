import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';

const cyclist={title:'Young cyclist killed by concrete mixer',summary:'A 23-year-old cyclist was crushed by a concrete mixer turning towards Oktogon.',occurredAt:'2026-07-29T12:00:00Z',location:{label:'Erzsébet körút and Király utca',district:'VII'},participants:[],caseReferences:[]};
function insert(s,id,event,mark='normal'){
 s.db.prepare('INSERT INTO events(id,slug,first_seen_at,canonical,occurred_at,editorial_mark) VALUES(?,?,?,?,?,?)').run(id,'e'+id,new Date().toISOString(),JSON.stringify(event),event.occurredAt,mark);
}
test('index retrieves the scene even with a missing date and a wrong place/category; ignored events remain searchable',()=>{
 const s=new Store(':memory:');try{
  insert(s,1,cyclist,'uninteresting');
  insert(s,2,{...cyclist,title:'Police investigation',summary:'Police arrested a man for theft.',location:{label:'Budapest'}});
  const incoming={...cyclist,occurredAt:null,location:{label:'Budapest',district:'IX'},type:'other'};
  assert.deepEqual(s.candidates(incoming).map(r=>r.id),[1]);
  s.db.prepare("UPDATE events SET merged_into=2 WHERE id=1").run();
  assert.deepEqual(s.candidates(incoming).map(r=>r.id),[]);
 }finally{s.close();}
});
test('index backfills existing data, follows inserts, corrections and deletes; accents and hostile query syntax are harmless',()=>{
 const s=new Store(':memory:');try{
  insert(s,1,cyclist);
  const query={title:'Erzsebet Kiraly Oktogon',summary:'',occurredAt:null,location:{label:'Unknown'}};
  assert.deepEqual(s.candidates(query).map(r=>r.id),[1]);
  insert(s,2,cyclist);
  assert.equal(s.candidates(query).length,2);
  s.db.prepare('UPDATE events SET canonical=? WHERE id=1').run(JSON.stringify({title:'Burglary',summary:'House burglary',location:{label:'Obuda'},occurredAt:null}));
  assert.deepEqual(s.candidates(query).map(r=>r.id),[2]);
  s.db.prepare('DELETE FROM events WHERE id=2').run();
  assert.deepEqual(s.candidates(query),[]);
  assert.doesNotThrow(()=>s.candidates({...query,title:'" OR * NEAR( ) --'}));
 }finally{s.close();}
});
test('a distinctive full participant name nominates a retrospective report despite date and place differences',()=>{
 const s=new Store(':memory:');try{
  insert(s,1,{...cyclist,participants:[{profile:{name:'Réka Papacsek'}}]});
  assert.deepEqual(s.candidates({title:'Reka Papacsek memorial',summary:'',occurredAt:'2025-09-17T00:00:00Z',location:{label:'Unknown'}}).map(r=>r.id),[1]);
 }finally{s.close();}
});
