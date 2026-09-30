import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store, hash } from './store.mjs';
import { publish } from './publish.mjs';
import { eventDetail, reviseEvent, fail } from './editorial.mjs';
import { catalog } from './sources.mjs';
import {changeTotalBudget,changeBudget,resumeCampaign,setEditorialMark,withdraw,retryEvent} from './admin-actions.mjs';
import { eventFacets } from './admin-facets.mjs';
import { readPublication } from './publication-comparison.mjs';
import {activityData,eventProcessing} from './activity.mjs';
import {currentUpdateAssessment} from './update-comparison.mjs';
import {pushCities,pushConfig,removePushSubscription,savePushSubscription} from './push.mjs';
import {needsFatalityConfirmation,TRAFFIC_HOLD_REASON} from './traffic-policy.mjs';

export function createAdmin({store,publicPath,tokenHash,origin,reviewer='Редактор',secure=true}) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash??'')) throw new Error('Configure ADMIN_TOKEN_HASH');
  const base = new URL(origin);
  if (secure && base.protocol!=='https:') throw new Error('HTTPS admin origin required');
  store.db.exec('CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires_at INTEGER NOT NULL)');
  const attempts = new Map();
  const cookie = (token, age=28800) => `crimap_editor=${token}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${age}${secure?'; Secure':''}`;
  return createServer(async (req,res) => {
    const send = (code,data,type='application/json; charset=utf-8') => {
      res.writeHead(code,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(data):data);
    };
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url,origin).pathname;
      const isPushApi=path==='/api/push/config'||path==='/api/push/subscriptions'||path==='/api/push/subscriptions/cancel';
      if (!path.startsWith('/admin/')&&!isPushApi) return send(404,{error:'Не найдено'});
      let body;
      if (req.method==='POST') {
        if (req.headers.origin!==base.origin) fail(403,'Недопустимый источник запроса');
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'Ожидается JSON');
        let size=0;const chunks=[];
        for await (const chunk of req) {size+=chunk.length;if(size>512_000)fail(413,'Слишком большой запрос');chunks.push(chunk);}
        try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {fail(400,'Некорректный JSON');}
      } else if (req.method!=='GET') fail(405,'Метод недоступен');
      if(path==='/api/push/config'&&req.method==='GET'){
        const config=pushConfig();
        return send(200,{enabled:!!config,publicKey:config?.publicKey??null,cities:pushCities});
      }
      if(path==='/api/push/subscriptions'&&req.method==='POST'){
        if(!pushConfig())fail(503,'Уведомления пока не настроены');
        return send(201,savePushSubscription(store,body));
      }
      if(path==='/api/push/subscriptions/cancel'&&req.method==='POST') return send(200,removePushSubscription(store,body));
      if (path==='/admin/api/login' && req.method==='POST') {
        const now=Date.now(),ip=req.headers['x-real-ip']??req.socket.remoteAddress;
        for (const [key,value] of attempts) if(value.until<now)attempts.delete(key);
        const a=attempts.get(ip)??{count:0,until:now+900_000};
        if(a.count>=5)fail(429,'Слишком много попыток. Попробуйте через 15 минут.');
        a.count++;attempts.set(ip,a);
        const candidate=typeof body.token==='string'&&body.token.length<=1024?body.token:'';
        if(!candidate||!timingSafeEqual(Buffer.from(hash(candidate),'hex'),Buffer.from(tokenHash,'hex')))fail(401,'Недействительный токен. Откройте вашу приватную ссылку.');
        attempts.delete(ip);
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
        store.db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(now);
        store.db.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(hash(token),csrf,now+28_800_000);
        res.setHeader('Set-Cookie',cookie(token));return send(200,{csrf,reviewer});
      }
      // The shell contains no private data. Every API except login requires a valid session.
      const assets={'/admin/':['index.html','text/html; charset=utf-8'],'/admin/app.js':['app.js','text/javascript; charset=utf-8'],'/admin/interest-reasons.mjs':['interest-reasons.mjs','text/javascript; charset=utf-8'],'/admin/filters.mjs':['filters.mjs','text/javascript; charset=utf-8'],'/admin/changes.mjs':['changes.mjs','text/javascript; charset=utf-8'],'/admin/style.css':['style.css','text/css; charset=utf-8']};
      Object.assign(assets,{'/admin/activity/':['activity.html','text/html; charset=utf-8'],'/admin/activity.js':['activity.js','text/javascript; charset=utf-8'],'/admin/usage-ui.mjs':['usage-ui.mjs','text/javascript; charset=utf-8'],'/admin/charts.mjs':['charts.mjs','text/javascript; charset=utf-8'],'/admin/range-ui.mjs':['range-ui.mjs','text/javascript; charset=utf-8']});
      if (assets[path] && req.method==='GET') return send(200,readFileSync(new URL('./admin/'+assets[path][0],import.meta.url)),assets[path][1]);
      const token=req.headers.cookie?.match(/(?:^|;\s*)crimap_editor=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session=token&&store.db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
      if(!session)fail(401,'Войдите в редактор');
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)fail(403,'Обновите страницу перед сохранением');
      if(path==='/admin/api/session'&&req.method==='GET')return send(200,{csrf:session.csrf,reviewer});
      if(path==='/admin/api/activity'&&req.method==='GET'){
        const q=new URL(req.url,origin).searchParams;
        return send(200,activityData(store,{before:q.has('before')?Number(q.get('before')):Infinity,category:q.get('category')??'all',source:q.get('source')??'all',period:q.get('period')??'day',from:q.get('from'),to:q.get('to'),queueState:q.get('queueState')??'all'}));
      }
      if(path==='/admin/api/logout'&&req.method==='POST'){
        store.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(token));res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});
      }
      if(path==='/admin/api/events'&&req.method==='GET'){
        const events=store.db.prepare(`SELECT e.id,e.slug,e.revision,e.published_revision,e.public_id,e.state,e.occurred_at,e.first_seen_at,e.review_reason,e.canonical,e.withdrawn_at,e.editorial_mark,
          t.payload IS NOT NULL hasRussian,
          EXISTS(SELECT 1 FROM preparation p WHERE p.event_id=e.id AND p.revision=e.revision) prepared,
          EXISTS(SELECT 1 FROM site_translations l WHERE l.event_id=e.id AND l.revision=e.revision) localized,
          EXISTS(SELECT 1 FROM observations o WHERE o.event_id=e.id) hasDocuments,
          coalesce(json_extract(t.payload,'$.title'),json_extract(e.canonical,'$.title')) title,
          json_extract(q.payload,'$.publicationBaseline') publicationBaseline, json_extract(q.payload,'$.verdict') verdict, json_extract(e.canonical,'$.type') eventType
          FROM events e LEFT JOIN translations t ON t.event_id=e.id AND t.revision=e.revision AND t.language='ru'
          LEFT JOIN quality_reviews q ON q.event_id=e.id AND q.revision=e.revision WHERE e.merged_into IS NULL AND e.state!='excluded' ORDER BY e.first_seen_at DESC`).all().map(({canonical,hasRussian,prepared,localized,hasDocuments,...row})=>{
            const event=JSON.parse(canonical);
            row.awaitingFatality=needsFatalityConfirmation(event);
            if(row.awaitingFatality)row.verdict=null;
            const baseline=row.public_id&&row.published_revision!==row.revision?readPublication(publicPath,row.slug):null;
            const comparisonReady=!baseline||row.publicationBaseline===baseline.fingerprint;
            row.updateAssessment=currentUpdateAssessment(store,row,baseline);
            return {...row,processing:eventProcessing(store,row),searchText:[event.title,event.summary,event.location.label,event.location.district].filter(Boolean).join(' '),facets:eventFacets(event),ready:!row.awaitingFatality&&row.published_revision!==row.revision&&!!(comparisonReady&&hasRussian&&hasDocuments&&row.verdict==='pass'&&event.occurredAt&&event.location.latitude!==undefined&&(!prepared||localized))};
          });
          return send(200,{events,budget:store.totalBudget(),requests:store.db.prepare('SELECT payload,event_id FROM field_requests ORDER BY created_at DESC LIMIT 100').all().map(r=>({...JSON.parse(r.payload),eventId:r.event_id})),
          campaigns:store.db.prepare(`SELECT c.*,coalesce((SELECT sum(coalesce(cost_usd,reserved_usd)) FROM usage WHERE campaign_id=c.id),0) spent,
            (SELECT count(*) FROM events WHERE campaign_id=c.id) events,
            (SELECT count(*) FROM jobs WHERE json_extract(payload,'$.campaignId')=c.id AND state='done') done,
            (SELECT count(*) FROM jobs WHERE json_extract(payload,'$.campaignId')=c.id AND state IN ('queued','running')) pending,
            (SELECT count(*) FROM jobs WHERE json_extract(payload,'$.campaignId')=c.id AND state='paused') paused,
            (SELECT count(*) FROM jobs WHERE json_extract(payload,'$.campaignId')=c.id AND state='failed') failed
            FROM campaigns c ORDER BY created_at DESC`).all(),
          archivePages:store.db.prepare('SELECT campaign_id,source_id,count(*) pages,min(earliest) earliest,max(latest) latest,sum(found) found,sum(filtered) filtered FROM archive_pages GROUP BY campaign_id,source_id').all(),
          triage:store.db.prepare('SELECT keep,method,count(*) count FROM triage_log GROUP BY keep,method').all(),
          sources:catalog.map(s=>({id:s.id,name:s.name,url:s.url,active:(s.feeds??[]).some(f=>store.db.prepare("SELECT 1 FROM jobs WHERE kind='feed' AND job_key=?").get(f.url)),archive:['police-brfk','kekvillogo'].includes(s.id)})),
          errors:store.db.prepare('SELECT kind,last_error,due_at FROM jobs WHERE last_error IS NOT NULL ORDER BY due_at DESC LIMIT 10').all(),
          usage:store.db.prepare('SELECT count(*) calls,coalesce(sum(coalesce(cost_usd,reserved_usd)),0) usd FROM usage WHERE created_at>=?').get(new Date().toISOString().slice(0,10)),
        });
      }
      if(path==='/admin/api/budget'&&req.method==='POST')return send(200,changeTotalBudget(store,body.budget,reviewer));
      const campaign=path.match(/^\/admin\/api\/campaigns\/([^/]+)\/budget$/);
      if(campaign&&req.method==='POST')return send(200,changeBudget(store,decodeURIComponent(campaign[1]),body.budget,reviewer));
      const resume=path.match(/^\/admin\/api\/campaigns\/([^/]+)\/resume$/);
      if(resume&&req.method==='POST')return send(200,resumeCampaign(store,decodeURIComponent(resume[1]),reviewer));
      const match=path.match(/^\/admin\/api\/events\/(\d+)(?:\/(save|review|translate|recheck|publish|withdraw|mark|resolve-date|retry))?$/);
      if(!match)fail(404,'Не найдено');
      const id=Number(match[1]),action=match[2];
      if(!action&&req.method==='GET')return send(200,eventDetail(store,id,publicPath));
      if(!action||req.method!=='POST')fail(405,'Метод недоступен');
      if(action==='mark')return send(200,setEditorialMark(store,id,body.mark,reviewer,{reasons:body.reasons,note:body.note,publicPath}));
      if(action==='save')return send(200,reviseEvent(store,id,body,reviewer));
      if(action==='retry')return send(200,retryEvent(store,id,body.revision,reviewer));
      const event=eventDetail(store,id,publicPath);
      if(['review','translate','recheck','resolve-date'].includes(action)&&event.editorial_mark==='uninteresting')fail(409,'Сначала верните событие из неинтересных');
      if(body.revision!==event.revision)fail(409,'Есть новая версия события. Обновите страницу.');
      if(action==='withdraw'){if(body.confirm!==true)fail(400,'Подтвердите снятие с публикации');return send(200,withdraw(store,id,publicPath,{revision:body.revision,reviewer}));}
      if(action==='publish'){
        const publicId=store.transaction(()=>{
          const current=eventDetail(store,id,publicPath);
          if(body.approvalToken!==current.approvalToken)fail(409,'Перевод или проверка изменились. Обновите карточку перед публикацией.');
          if(current.blockers.length)fail(422,current.blockers.join('. '));
          if(body.confirm!==true)fail(400,'Подтвердите публикацию');
          return publish(store,id,publicPath,{reviewer,includeContext:true,includeLegal:true});
        });
        return send(200,{publicId});
      }
      if(['review','translate','resolve-date'].includes(action)&&event.awaitingFatality)fail(409,TRAFFIC_HOLD_REASON);
      if(action==='resolve-date'&&event.canonical.occurredAt)fail(409,'Дата уже установлена');
      if(action==='translate'&&event.russian)fail(409,'Перевод уже есть. Для повторного перевода сохраните новую версию через редактор.');
      store.enqueue(action,action==='review'?`${id}:${event.revision}`:id,{eventId:id,revision:event.revision,campaignId:action==='recheck'?null:event.campaign_id,...(action==='review'?{forceReview:true}:{})});
      store.log('editorial-queue',id,{action,reviewer,revision:event.revision});
      return send(200,{queued:action});
    } catch(e) {
      const status=e.status??(e.name==='ZodError'?400:500);
      // Never expose stack traces, environment values, SQL or filesystem paths.
      send(status,{error:status===500?'Не удалось выполнить действие. Проверьте данные или журнал сервиса.':e.message});
      if(status===500)console.error('Admin request failed:',e.name);
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const store=new Store(process.env.COLLECTOR_DATABASE_PATH??'data/collector.sqlite');
  const server=createAdmin({store,publicPath:process.env.DATABASE_PATH,tokenHash:process.env.ADMIN_TOKEN_HASH,origin:process.env.ADMIN_ORIGIN,reviewer:process.env.ADMIN_REVIEWER??'Редактор'});
  server.listen(Number(process.env.ADMIN_PORT??8083),'127.0.0.1',()=>console.log('Crimap editorial service ready'));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
