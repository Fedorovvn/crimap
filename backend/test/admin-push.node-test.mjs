import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {Store} from '../store.mjs';
import {saveAdminPushSubscription,sendAdminReadyPushes} from '../admin-push.mjs';

const now='2026-10-04T12:00:00.000Z';
const event={title:'Knife robbery on Test tér',summary:'Two men threatened a passerby with a knife.',type:'robbery',status:'suspects-detained',occurredAt:now,timePrecision:'exact',location:{city:'Budapest',label:'Test tér',precision:'street',latitude:47.5,longitude:19.05},signals:['suspect-detained'],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:[]};

test('editor-only push is sent once for a Pro-approved unpublished card',async()=>{
 const previous={public:process.env.VAPID_PUBLIC_KEY,private:process.env.VAPID_PRIVATE_KEY,subject:process.env.VAPID_SUBJECT};
 const keys=webpush.generateVAPIDKeys();process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';
 const store=new Store(':memory:');
 try{
  store.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical,state,revision) VALUES(1,?,?,?,?,?,?)').run('knife-robbery',now,now,JSON.stringify(event),'draft',2);
  store.db.prepare('INSERT INTO translations VALUES(1,2,?,?,?,?)').run('ru',JSON.stringify({...event,title:'Ограбление с ножом на тестовой площади'}),'pro',now);
  store.db.prepare('INSERT INTO quality_reviews VALUES(1,2,?,?,?)').run('pro',JSON.stringify({verdict:'pass'}),now);
  saveAdminPushSubscription(store,{endpoint:'https://push.example/editor',keys:{p256dh:'a'.repeat(24),auth:'b'.repeat(24)},locale:'ru'});
  let payload;const result=await sendAdminReadyPushes(store,{eventId:1,revision:2},{send:async(_subscription,raw)=>{payload=JSON.parse(raw);}});
  assert.deepEqual(result,{sent:1,removed:0,failed:0});
  assert.equal(payload.title,'Проверено Pro · ждёт публикации');assert.equal(payload.url,'/admin/?event=1');
  const duplicate=await sendAdminReadyPushes(store,{eventId:1,revision:2},{send:async()=>assert.fail('same editor must not be notified twice')});
  assert.deepEqual(duplicate,{sent:0,removed:0,failed:0});
  store.db.prepare('UPDATE events SET published_revision=2 WHERE id=1').run();
  assert.deepEqual(await sendAdminReadyPushes(store,{eventId:1,revision:2},{send:async()=>assert.fail('published card is not an editorial notification')}),{skipped:true});
 }finally{store.close();for(const [name,value] of Object.entries({VAPID_PUBLIC_KEY:previous.public,VAPID_PRIVATE_KEY:previous.private,VAPID_SUBJECT:previous.subject}))value===undefined?delete process.env[name]:process.env[name]=value;}
});
