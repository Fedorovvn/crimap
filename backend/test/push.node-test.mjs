import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {Store} from '../store.mjs';
import {matchesPushPreferences,removePushSubscription,savePushSubscription,sendPublishedPushes} from '../push.mjs';

const now='2026-09-28T11:00:00.000Z';
const event={title:'Knife attack near Test utca',summary:'A person was injured during a reported attack.',type:'assault',status:'investigating',occurredAt:now,timePrecision:'exact',location:{city:'Budapest',label:'Test utca',precision:'street',latitude:47.5,longitude:19.05},signals:['injury'],caseReferences:[],participants:[],context:[],legal:[],updates:[],media:[],evidence:[]};

test('validated subscriptions receive one localized notification and expired endpoints are removed',async()=>{
  const previous={public:process.env.VAPID_PUBLIC_KEY,private:process.env.VAPID_PRIVATE_KEY,subject:process.env.VAPID_SUBJECT};
  const keys=webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';
  const store=new Store(':memory:');
  try{
    store.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical,state,revision,published_revision) VALUES(1,?,?,?,?,?,?,?)').run('knife-attack',now,now,JSON.stringify(event),'published',1,1);
    store.db.prepare('INSERT INTO translations VALUES(1,1,?,?,?,?)').run('ru',JSON.stringify(event),'fixture',now);
    savePushSubscription(store,{endpoint:'https://push.example/current',keys:{p256dh:'a'.repeat(24),auth:'b'.repeat(24)},locale:'en'});
    savePushSubscription(store,{endpoint:'https://push.example/expired',keys:{p256dh:'c'.repeat(24),auth:'d'.repeat(24)},locale:'ru'});
    const calls=[];
    const result=await sendPublishedPushes(store,{eventId:1,revision:1},{send:async(subscription,payload)=>{
      if(subscription.endpoint.endsWith('/expired')) { const error=new Error('gone');error.statusCode=410;throw error; }
      calls.push({subscription,payload:JSON.parse(payload)});
    }});
    assert.deepEqual(result,{sent:1,removed:1,failed:0});
    assert.equal(calls[0].payload.title,event.title);
    assert.equal(calls[0].payload.url,'/?incident=knife-attack');
    assert.equal(store.db.prepare('SELECT count(*) n FROM push_subscriptions').get().n,1);
    assert.deepEqual(removePushSubscription(store,{endpoint:'https://push.example/current'}),{unsubscribed:true});
    assert.equal(store.db.prepare('SELECT count(*) n FROM push_subscriptions').get().n,0);
    assert.throws(()=>savePushSubscription(store,{endpoint:'http://not-secure.example',keys:{p256dh:'x'.repeat(24),auth:'y'.repeat(24)}}));
  }finally{
    store.close();
    for(const [name,value] of Object.entries({VAPID_PUBLIC_KEY:previous.public,VAPID_PRIVATE_KEY:previous.private,VAPID_SUBJECT:previous.subject})) value===undefined?delete process.env[name]:process.env[name]=value;
  }
});

test('notification preferences filter by severity and city before delivery',async()=>{
  const previous={public:process.env.VAPID_PUBLIC_KEY,private:process.env.VAPID_PRIVATE_KEY,subject:process.env.VAPID_SUBJECT};
  const keys=webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY=keys.publicKey;process.env.VAPID_PRIVATE_KEY=keys.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';
  const store=new Store(':memory:');
  const fatal={...event,signals:['death'],participants:[{status:'deceased'}]};
  try {
    store.db.prepare('INSERT INTO events(id,slug,first_seen_at,occurred_at,canonical,state,revision,published_revision) VALUES(2,?,?,?,?,?,?,?)').run('fatal-attack',now,now,JSON.stringify(fatal),'published',1,1);
    store.db.prepare('INSERT INTO translations VALUES(2,1,?,?,?,?)').run('ru',JSON.stringify(fatal),'fixture',now);
    for (const [name,severity] of [['all','all'],['serious','serious'],['fatal','fatal']]) savePushSubscription(store,{endpoint:`https://push.example/${name}`,keys:{p256dh:(name[0]).repeat(24),auth:(name[0].toUpperCase()).repeat(24)},locale:'ru',severity,cities:['Budapest']});
    store.db.prepare("INSERT INTO push_subscriptions(endpoint,p256dh,auth,locale,severity,cities,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run('https://push.example/other-city','z'.repeat(24),'Z'.repeat(24),'ru','all','[\"Other\"]',now,now);
    const sent=[];
    const result=await sendPublishedPushes(store,{eventId:2,revision:1},{send:async(subscription)=>sent.push(subscription.endpoint)});
    assert.deepEqual(result,{sent:3,removed:0,failed:0});
    assert.deepEqual(sent.sort(),['https://push.example/all','https://push.example/fatal','https://push.example/serious']);
    assert.equal(matchesPushPreferences(event,{severity:'fatal',cities:'["Budapest"]'}),false);
    assert.throws(()=>savePushSubscription(store,{endpoint:'https://push.example/not-city',keys:{p256dh:'q'.repeat(24),auth:'Q'.repeat(24)},cities:['Other']}));
  } finally {
    store.close();
    for(const [name,value] of Object.entries({VAPID_PUBLIC_KEY:previous.public,VAPID_PRIVATE_KEY:previous.private,VAPID_SUBJECT:previous.subject})) value===undefined?delete process.env[name]:process.env[name]=value;
  }
});
