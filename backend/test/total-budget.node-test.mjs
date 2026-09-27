import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {changeTotalBudget} from '../admin-actions.mjs';
test('one cumulative limit includes archive, daily, reserved and failed usage and does not reset at midnight',()=>{
 const s=new Store(':memory:');try{
 s.db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?)').run('archive','2026-01-01','2026-02-01',1,'running','2026-01-01');
 changeTotalBudget(s,2,'test');
 const a=s.reserveCost('review','pro','a',1.2,.01,'2026-09-27T00:00:00Z','archive');s.usageFailed(a,'timeout');
 s.reserveCost('triage','flash','b',.6,.01,'2026-09-28T00:00:00Z');
 assert.throws(()=>s.reserveCost('review','pro','c',.3,100,'2026-09-29T00:00:00Z'),/Total model budget/);
 assert.throws(()=>changeTotalBudget(s,1,'test'),/потрачено/);
 changeTotalBudget(s,3,'test');assert.ok(s.reserveCost('review','pro','c',.3,.01));
 assert.equal(s.db.prepare('SELECT count(*) n FROM usage').get().n,3);
 }finally{s.close();}
});
test('saving total budget wakes budget waits but preserves manual archive pause and unrelated retry errors',()=>{
 const s=new Store(':memory:');try{
 s.db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?)').run('archive','2026-01-01','2026-02-01',30,'paused','2026-01-01');
 for(const [key,error,campaign] of [['daily','Daily model budget reached',null],['total','Total model budget reached',null],['archive','Daily model budget reached','archive'],['network','Source HTTP 503',null]]){
  s.enqueue('article',key,{campaignId:campaign});s.db.prepare("UPDATE jobs SET state='paused',last_error=?,due_at='2030-01-01' WHERE job_key=?").run(error,key);
 }
 assert.equal(changeTotalBudget(s,30,'test').resumed,2);
 assert.deepEqual(s.db.prepare('SELECT job_key,state FROM jobs ORDER BY id').all().map(r=>[r.job_key,r.state]),[['daily','queued'],['total','queued'],['archive','paused'],['network','paused']]);
 }finally{s.close();}
});
