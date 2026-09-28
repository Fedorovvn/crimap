import webpush from 'web-push';
import { siteTranslations } from './site-localization.mjs';

const base64Url=/^[A-Za-z0-9_-]{16,512}$/;
const locales=new Set(['ru','en','hu']);

export function pushConfig() {
  const publicKey=process.env.VAPID_PUBLIC_KEY,privateKey=process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  if (!base64Url.test(publicKey) || !base64Url.test(privateKey)) throw new Error('Invalid VAPID keys');
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT ?? 'mailto:privacy@crimap.online' };
}

export function normalizePushSubscription(raw) {
  if (!raw || typeof raw!=='object') throw new Error('Invalid push subscription');
  const endpoint=typeof raw.endpoint==='string'&&raw.endpoint.length<=2048?raw.endpoint:'';
  let parsed;try { parsed=new URL(endpoint); } catch { throw new Error('Invalid push endpoint'); }
  if (parsed.protocol!=='https:' || !parsed.hostname) throw new Error('Invalid push endpoint');
  const p256dh=typeof raw.keys?.p256dh==='string'?raw.keys.p256dh:'';
  const auth=typeof raw.keys?.auth==='string'?raw.keys.auth:'';
  if (!base64Url.test(p256dh)||!base64Url.test(auth)) throw new Error('Invalid push encryption keys');
  return {endpoint,p256dh,auth,locale:locales.has(raw.locale)?raw.locale:'ru'};
}

export function savePushSubscription(store, raw) {
  const subscription=normalizePushSubscription(raw),now=new Date().toISOString();
  store.db.prepare(`INSERT INTO push_subscriptions(endpoint,p256dh,auth,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,locale=excluded.locale,updated_at=excluded.updated_at`).run(subscription.endpoint,subscription.p256dh,subscription.auth,subscription.locale,now,now);
  store.log('push-subscribed','web',{locale:subscription.locale});
  return {subscribed:true};
}

function localized(strings, locale, text) { return locale==='ru'?text:strings?.[locale]?.[text]??text; }

export async function sendPublishedPushes(store, {eventId,revision}, {send=webpush.sendNotification}={}) {
  const config=pushConfig();
  if (!config) { store.log('push-skipped',eventId,{revision,reason:'VAPID is not configured'}); return {skipped:true}; }
  const event=store.db.prepare('SELECT slug,published_revision FROM events WHERE id=?').get(eventId);
  if (!event || event.published_revision!==revision) return {skipped:true};
  const russian=store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(eventId,revision);
  if (!russian) throw new Error('Published Russian text is missing for push notification');
  const card=JSON.parse(russian.payload),translations=siteTranslations(store,eventId,revision);
  const subscriptions=store.db.prepare('SELECT endpoint,p256dh,auth,locale FROM push_subscriptions').all();
  let sent=0,removed=0,failed=0;
  await Promise.all(subscriptions.map(async subscription => {
    const payload=JSON.stringify({title:localized(translations,subscription.locale,card.title),body:localized(translations,subscription.locale,card.summary).slice(0,240),url:`/?incident=${encodeURIComponent(event.slug)}`,tag:`incident-${event.slug}`});
    try {
      await send({endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth}},payload,{TTL:3600,urgency:'high',topic:`incident-${eventId}`,vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey}});
      sent++;
    } catch (error) {
      if ([404,410].includes(error.statusCode)) { store.db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(subscription.endpoint); removed++; return; }
      failed++;
    }
  }));
  store.log('push-delivery',eventId,{revision,subscriptions:subscriptions.length,sent,removed,failed});
  if (failed && !sent) throw new Error('Push delivery failed');
  return {sent,removed,failed};
}
