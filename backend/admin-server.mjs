import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store, hash } from './store.mjs';
import { publish } from './publish.mjs';
import { eventDetail, reviseEvent, fail } from './editorial.mjs';

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
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url,origin).pathname;
      if (!path.startsWith('/admin/')) return send(404,{error:'Не найдено'});
      let body;
      if (req.method==='POST') {
        if (req.headers.origin!==base.origin) fail(403,'Недопустимый источник запроса');
        if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'Ожидается JSON');
        let size=0;const chunks=[];
        for await (const chunk of req) {size+=chunk.length;if(size>512_000)fail(413,'Слишком большой запрос');chunks.push(chunk);}
        try { body=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {fail(400,'Некорректный JSON');}
      } else if (req.method!=='GET') fail(405,'Метод недоступен');
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
      const assets={'/admin/':['index.html','text/html; charset=utf-8'],'/admin/app.js':['app.js','text/javascript; charset=utf-8'],'/admin/style.css':['style.css','text/css; charset=utf-8']};
      if (assets[path] && req.method==='GET') return send(200,readFileSync(new URL('./admin/'+assets[path][0],import.meta.url)),assets[path][1]);
      const token=req.headers.cookie?.match(/(?:^|;\s*)crimap_editor=([a-f0-9]{64})(?:;|$)/)?.[1];
      const session=token&&store.db.prepare('SELECT * FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
      if(!session)fail(401,'Войдите в редактор');
      if(req.method==='POST'&&req.headers['x-csrf-token']!==session.csrf)fail(403,'Обновите страницу перед сохранением');
      if(path==='/admin/api/session'&&req.method==='GET')return send(200,{csrf:session.csrf,reviewer});
      if(path==='/admin/api/logout'&&req.method==='POST'){
        store.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(hash(token));res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});
      }
      if(path==='/admin/api/events'&&req.method==='GET'){
        const events=store.db.prepare(`SELECT e.id,e.slug,e.revision,e.published_revision,e.state,e.occurred_at,e.review_reason,
          coalesce(json_extract(t.payload,'$.title'),json_extract(e.canonical,'$.title')) title,
          json_extract(q.payload,'$.verdict') verdict
          FROM events e LEFT JOIN translations t ON t.event_id=e.id AND t.revision=e.revision AND t.language='ru'
          LEFT JOIN quality_reviews q ON q.event_id=e.id AND q.revision=e.revision ORDER BY e.first_seen_at DESC LIMIT 500`).all();
        return send(200,{events,requests:store.db.prepare('SELECT payload,event_id FROM field_requests ORDER BY created_at DESC LIMIT 100').all().map(r=>({...JSON.parse(r.payload),eventId:r.event_id})),
          errors:store.db.prepare('SELECT kind,last_error,due_at FROM jobs WHERE last_error IS NOT NULL ORDER BY due_at DESC LIMIT 10').all(),
          usage:store.db.prepare('SELECT count(*) calls,coalesce(sum(coalesce(cost_usd,reserved_usd)),0) usd FROM usage WHERE created_at>=?').get(new Date().toISOString().slice(0,10)),
        });
      }
      const match=path.match(/^\/admin\/api\/events\/(\d+)(?:\/(save|review|translate|recheck|publish))?$/);
      if(!match)fail(404,'Не найдено');
      const id=Number(match[1]),action=match[2];
      if(!action&&req.method==='GET')return send(200,eventDetail(store,id,publicPath));
      if(!action||req.method!=='POST')fail(405,'Метод недоступен');
      if(action==='save')return send(200,reviseEvent(store,id,body,reviewer));
      const event=eventDetail(store,id,publicPath);
      if(body.revision!==event.revision)fail(409,'Есть новая версия события. Обновите страницу.');
      if(action==='publish'){
        const publicId=store.transaction(()=>{
          const current=eventDetail(store,id,publicPath);
          if(body.approvalToken!==current.approvalToken)fail(409,'Перевод или проверка изменились. Обновите карточку перед публикацией.');
          if(current.blockers.length)fail(422,current.blockers.join('. '));
          if(body.confirm!==true)fail(400,'Подтвердите публикацию');
          return publish(store,id,publicPath,{reviewer,includeContext:body.includeContext===true,includeLegal:body.includeLegal===true});
        });
        return send(200,{publicId});
      }
      if(action==='review'&&!event.russian)fail(422,'Сначала нужен русский перевод');
      if(action==='translate'&&event.russian)fail(409,'Перевод уже есть. Для повторного перевода сохраните новую версию через редактор.');
      store.enqueue(action,action==='review'?`${id}:${event.revision}`:id,{eventId:id,revision:event.revision});
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
