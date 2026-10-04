import webpush from 'web-push';
import {normalizePushSubscription,normalizePushEndpoint,pushConfig} from './push.mjs';

export function saveAdminPushSubscription(store,raw){
  const subscription=normalizePushSubscription(raw),now=new Date().toISOString();
  store.db.prepare(`INSERT INTO admin_push_subscriptions(endpoint,p256dh,auth,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,locale=excluded.locale,updated_at=excluded.updated_at`)
    .run(subscription.endpoint,subscription.p256dh,subscription.auth,subscription.locale,now,now);
  store.log('admin-push-subscribed','admin',{locale:subscription.locale});
  return {subscribed:true};
}

export function removeAdminPushSubscription(store,raw){
  const endpoint=normalizePushEndpoint(raw?.endpoint);
  const removed=store.db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint=?').run(endpoint).changes;
  store.log('admin-push-unsubscribed','admin',{removed:removed===1});
  return {unsubscribed:true};
}

const labels={ru:{ready:'Проверено Pro · ждёт публикации',open:'Открыть редактор'},en:{ready:'Pro checked · ready to publish',open:'Open editor'},hu:{ready:'Pro ellenőrizte · publikálásra vár',open:'Szerkesztő megnyitása'}};

export async function sendAdminReadyPushes(store,{eventId,revision},{send=webpush.sendNotification}={}){
  const config=pushConfig();
  if(!config){store.log('admin-push-skipped',eventId,{revision,reason:'VAPID is not configured'});return {skipped:true};}
  const event=store.db.prepare('SELECT slug,revision,published_revision,canonical FROM events WHERE id=?').get(eventId);
  const review=store.db.prepare('SELECT payload FROM quality_reviews WHERE event_id=? AND revision=?').get(eventId,revision);
  if(!event||event.revision!==revision||event.published_revision===revision||JSON.parse(review?.payload??'{}').verdict!=='pass')return {skipped:true};
  const russian=store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(eventId,revision);
  if(!russian)throw new Error('Ready editor push requires Russian card');
  const card=JSON.parse(russian.payload),subscriptions=store.db.prepare('SELECT endpoint,p256dh,auth,locale FROM admin_push_subscriptions').all();
  const delivered=new Set(store.db.prepare('SELECT endpoint FROM admin_push_deliveries WHERE event_id=? AND revision=?').all(eventId,revision).map(row=>row.endpoint));
  let sent=0,removed=0,failed=0;
  await Promise.all(subscriptions.filter(s=>!delivered.has(s.endpoint)).map(async subscription=>{
    const locale=labels[subscription.locale]??labels.ru;
    const payload=JSON.stringify({title:locale.ready,body:String(card.title??'Crime Map').slice(0,220),kind:'editorial',url:`/admin/?event=${eventId}`,tag:`admin-ready-${eventId}-${revision}`});
    try{
      await send({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},payload,{TTL:3600,urgency:'high',topic:`admin-ready-${eventId}-${revision}`,vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey}});
      store.db.prepare('INSERT OR IGNORE INTO admin_push_deliveries(event_id,revision,endpoint,delivered_at) VALUES(?,?,?,?)').run(eventId,revision,subscription.endpoint,new Date().toISOString());sent++;
    }catch(error){if([404,410].includes(error.statusCode)){store.db.prepare('DELETE FROM admin_push_subscriptions WHERE endpoint=?').run(subscription.endpoint);removed++;}else failed++;}
  }));
  store.log('admin-push-delivery',eventId,{revision,subscriptions:subscriptions.length,alreadyDelivered:delivered.size,sent,removed,failed});
  if(failed&&!sent)throw new Error('Admin push delivery failed');
  return {sent,removed,failed};
}
