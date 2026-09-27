import {catalog,sourceFor} from './sources.mjs';
import {usageDashboard} from './usage-dashboard.mjs';

export const jobLabels={feed:'Обход источника',article:'Разбор статьи',archive:'Обход архива',gather:'Поиск дополнительных источников',prepare:'Подготовка карточки',review:'Финальная проверка Pro',repair:'Исправление карточки',translate:'Перевод Flash',localize:'Перевод EN/HU','resolve-date':'Уточнение даты',recheck:'Проверка обновлений'};
const actions={
 'feed-polled':['sources','Источник проверен'], 'feed-article-queued':['articles','Новая статья'], 'feed-article-filtered':['filtered','Отсеяно бесплатно'],
 'document-processed':['articles','Статья разобрана'], 'repeat-skipped':['duplicates','Повтор пропущен'], 'events-merged':['duplicates','Дубли объединены'],
 'uninteresting-update-skipped':['filtered','Обновление неинтересного события'], 'prepared':['events','Карточка подготовлена'], 'pro-final-editor':['events','Проверка Pro завершена'],
 'published':['events','Опубликовано'], 'translations-ready':['events','Переводы готовы'], 'date-resolved':['events','Дата уточнена'],
 'job-started':['tasks','Задача начата'], 'job-finished':['tasks','Задача завершена'], 'job-failure':['errors','Ошибка задачи'],
 'archive-job-failed':['errors','Обработка остановлена'], 'total-budget-stop':['errors','Ожидание бюджета'], 'merge-needs-retry':['errors','Не удалось объединить'],
 'recheck':['sources','Обновления проверены'], 'archive-stopped':['sources','Архивный сбор остановлен'],
 'event-filtered':['filtered','Событие отсеяно до Pro'], 'review-deferred':['events','Сначала подготовка, затем Pro'],
 'editorial-retry':['events','Пересборка поставлена в очередь'],
};
const eventActions=new Set(['repeat-skipped','events-merged','uninteresting-update-skipped','prepared','pro-final-editor','published','translations-ready','date-resolved','merge-needs-retry','recheck','event-filtered','review-deferred','editorial-retry']);
export function readableError(text){
 if(!text)return null;
 if(/budget reached/i.test(text))return 'Недостаточно общего бюджета для следующего запроса. Увеличьте лимит и нажмите «Сохранить и продолжить».';
 if(/geocoder daily/i.test(text))return 'Сработал прежний суточный лимит координат. Этот лимит отменён; запись сохранена для истории.';
 if(/429|rate.limit/i.test(text))return 'Сервис временно ограничил частоту запросов.';
 if(/timeout|timed out|abort/i.test(text))return 'Источник или модель не ответили вовремя.';
 if(/changed numbers|numeric tokens|digit tokens/i.test(text))return 'Числа в переводе не совпали с исходным текстом. Требуется исправление перевода.';
 if(/translation required|translation paths|Unknown final .*display text/i.test(text))return 'В итоговой карточке не хватает согласованного перевода изменённых полей.';
 if(/quotation|quote|evidence/i.test(text))return 'Не удалось подтвердить одну из цитат или фактов по оригиналу источника.';
 if(/duplicate|merge/i.test(text))return 'Найден возможный дубль. Flash не завершила объединение; переход к Pro заблокирован.';
 if(/HTTP (\d{3})/.test(text))return `Внешний сервис вернул ошибку HTTP ${text.match(/HTTP (\d{3})/)[1]}.`;
 if(/event changed|version changed|content changed|superseded/i.test(text))return 'Пока выполнялась задача, появилась новая версия. Требуется повторная обработка.';
 if(/legal|catalog sanctions/i.test(text))return 'Правовые поля не согласованы с фактами или проверенным каталогом. Требуется исправление.';
 return 'Ошибка обработки данных. Подробная диагностика сохранена в серверном журнале.';
}
const parse=s=>{try{return JSON.parse(s??'{}');}catch{return {};}};
const redact=value=>String(value??'').replace(/sk-[A-Za-z0-9_-]+/g,'[скрыто]').replace(/Bearer\s+\S+/gi,'Bearer [скрыто]').replace(/([?&](?:token|key|api_key|password|secret)=)[^\s&#]+/gi,'$1[скрыто]');
const safeUrl=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.origin+u.pathname:null;}catch{return null;}};
export function eventProcessing(store,event){
 const jobs=store.db.prepare("SELECT kind,state,last_error,attempts,due_at FROM jobs WHERE json_extract(payload,'$.eventId')=? AND state IN ('failed','paused','queued','running') AND (json_extract(payload,'$.revision') IS NULL OR json_extract(payload,'$.revision')=?) ORDER BY CASE state WHEN 'failed' THEN 0 WHEN 'paused' THEN 1 WHEN 'running' THEN 2 ELSE 3 END,id").all(event.id,event.revision);
 const stopped=jobs.filter(j=>['failed','paused'].includes(j.state));
 return {stopped:stopped.length>0,issues:stopped.map(j=>({stage:jobLabels[j.kind]??'Обработка',reason:readableError(j.last_error)??'Задача приостановлена.',attempts:j.attempts,state:j.state})),retrying:jobs.some(j=>j.state==='queued'&&j.last_error)};
}
export function activityData(store,{now=new Date(),before=Infinity,category='all',source='all',period='day',queueState='all'}={}){
 const db=store.db,stamp=now.toISOString(),since=period==='all'?'1970-01-01T00:00:00Z':new Date(now.getTime()-(period==='week'?7:1)*86400000).toISOString();
 const events=new Map(db.prepare(`SELECT e.id,e.merged_into,coalesce(json_extract(t.payload,'$.title'),json_extract(e.canonical,'$.title')) title FROM events e LEFT JOIN translations t ON t.event_id=e.id AND t.revision=e.revision AND t.language='ru'`).all().map(r=>[r.id,r]));
 const eventSources=new Map();for(const r of db.prepare('SELECT DISTINCT o.event_id,d.source_id FROM observations o JOIN documents d ON d.id=o.document_id').all()){const a=eventSources.get(r.event_id)??[];a.push(r.source_id);eventSources.set(r.event_id,a);}
 const eventInfo=id=>{let r=events.get(Number(id));const visited=new Set();while(r?.merged_into&&!visited.has(r.id)){visited.add(r.id);r=events.get(r.merged_into);}return r?{eventId:r.id,title:r.title}:{};};
 const sourceInfo=(id,url)=>{const s=catalog.find(s=>s.id===id)??(url?sourceFor(url):null);return {sourceId:s?.id??null,sourceName:s?.name??null};};
 const jobs=db.prepare("SELECT * FROM jobs WHERE state NOT IN ('done','cancelled') ORDER BY CASE state WHEN 'running' THEN 0 WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,due_at,id").all();
 const order={archive:0,feed:1,gather:2,repair:3,prepare:4,translate:5,localize:6,review:7};
 const priorities=new Set(db.prepare("SELECT id FROM events WHERE editorial_mark='priority'").all().map(r=>r.id));
 const queue=jobs.map(j=>{
   const p=parse(j.payload),info=eventInfo(p.eventId),running=j.state==='running',stale=running&&j.lease_until<stamp;
   const state=stale?'stale':j.state==='queued'?(j.due_at<=stamp?'ready':'scheduled'):j.state;
   const started=db.prepare("SELECT created_at FROM audit WHERE action='job-started' AND subject=? ORDER BY id DESC LIMIT 1").get(String(j.id))?.created_at??null;
   return {id:j.id,kind:j.kind,label:jobLabels[j.kind]??'Обработка',state,dueAt:j.due_at,startedAt:running?started:null,attempts:j.attempts,priority:priorities.has(p.eventId)&&j.kind!=='recheck',title:info.title??p.title??null,...info,...sourceInfo(p.sourceId??p.discoveredBy??eventSources.get(info.eventId)?.[0],p.url),sourceIds:eventSources.get(info.eventId)??[],url:safeUrl(p.url),reason:readableError(j.last_error),archive:!!p.campaignId};
 }).sort((a,b)=>{
   const rank=s=>({running:0,stale:1,ready:2,failed:3,paused:4,'waiting-date':5,scheduled:6})[s]??7;
   return rank(a.state)-rank(b.state)||(a.state==='ready'?(Number(b.priority)-Number(a.priority)||(order[a.kind]??8)-(order[b.kind]??8)):0)||a.dueAt.localeCompare(b.dueAt)||a.id-b.id;
 });
 const counts={};for(const j of queue)counts[j.state]=(counts[j.state]??0)+1;
 counts.retry=queue.filter(j=>j.reason&&['ready','scheduled'].includes(j.state)).length;
 const knownActions=Object.keys(actions),marks=knownActions.map(()=>'?').join(',');
 const raw=db.prepare(`SELECT * FROM audit WHERE id<? AND created_at>=? AND action IN (${marks}) ORDER BY id DESC LIMIT 1500`).all(Number.isFinite(before)?before:Number.MAX_SAFE_INTEGER,since,...knownActions);
 const logs=[];let examined=null;
 for(const row of raw){
   examined=row.id;const d=parse(row.detail);let [group,label]=actions[row.action];
   if(row.action==='document-processed'&&d.filtered){group='filtered';label='Статья отсеяна';}
   if(row.action==='document-processed'&&d.repeat){group='duplicates';label='Статья не добавляет новых событий';}
   if(row.action==='job-finished'&&d.outcome!=='complete'){group=d.error?'errors':'tasks';label=d.error?'Задача остановлена с ошибкой':'Задача приостановлена';}
   const jobId=row.action.startsWith('job-')||['total-budget-stop','archive-job-failed'].includes(row.action)?Number(row.subject):null;
   const job=jobId?db.prepare('SELECT payload,kind FROM jobs WHERE id=?').get(jobId):null,p=parse(job?.payload);
   const documentId=d.documentId??(row.action==='document-processed'?row.subject.split(':')[0]:null);
   if(row.action==='document-processed'&&d.filtered){
     const method=db.prepare('SELECT method FROM triage_log WHERE document_id=? AND content_hash=?').get(documentId,row.subject.split(':')[1])?.method;
     label=method==='rules'?'Отсеяно бесплатно':method==='flash-short'?'Отсеяно Flash':'Отсеяно при разборе Flash';
   }
   const doc=documentId?db.prepare('SELECT url,source_id,(SELECT title FROM document_versions WHERE document_id=d.id ORDER BY id DESC LIMIT 1) title FROM documents d WHERE id=?').get(documentId):null;
   const info=eventInfo(d.eventId??(eventActions.has(row.action)?row.subject:p.eventId));
   const src=sourceInfo(d.sourceId??doc?.source_id??p.sourceId??p.discoveredBy??eventSources.get(info.eventId)?.[0]??row.subject,d.url??doc?.url??p.url);
   if(category!=='all'&&category!==group)continue;if(source!=='all'&&source!==src.sourceId&&!eventSources.get(info.eventId)?.includes(source))continue;
   let description=d.reason??d.irrelevantReason??null;
   if(row.action==='feed-polled')description=`В ленте ${d.items??0}; новых ${d.queued??0}; отсеяно ${d.filtered??0}; уже известных ${d.unchanged??0}.`;
   if(row.action==='events-merged')description=`Карточка №${d.duplicateId} объединена с №${row.subject}. ${d.hasNewInformation?'Новые факты сохранены в обновлении.':'Новых фактов нет.'}`;
   if(row.action==='pro-final-editor')description=({pass:'Проверка пройдена',revise:'Нужна автоматическая доработка',reject:'Не прошло проверку'})[d.verdict]??'Проверка завершена';
   if(group==='errors')description=readableError(d.error??(row.action==='total-budget-stop'?'Total model budget reached':null))??'Обработка отложена';
   logs.push({id:row.id,at:row.created_at,category:group,label,description:description?redact(description).slice(0,900):null,kind:jobLabels[d.kind??job?.kind]??null,title:info.title??doc?.title??d.title??p.title??null,...info,...src,url:safeUrl(d.url??doc?.url??p.url),durationSeconds:d.startedAt?Math.max(0,Math.round((Date.parse(row.created_at)-Date.parse(d.startedAt))/1000)):null});
   if(logs.length===60)break;
 }
 const hasPolls=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_polls'").get();
 const polls=hasPolls?db.prepare('SELECT * FROM source_polls').all():[];
 const feeds=db.prepare("SELECT * FROM jobs WHERE kind='feed'").all();
 const sources=catalog.filter(s=>feeds.some(j=>parse(j.payload).sourceId===s.id)).map(s=>{
   const own=polls.filter(p=>p.source_id===s.id),js=feeds.filter(j=>parse(j.payload).sourceId===s.id),times=own.map(p=>p.checked_at).sort();
   return {id:s.id,name:s.name,url:s.url,kind:s.kind??s.type,lastCheckedAt:times.at(-1)??null,nextCheckAt:js.map(j=>j.due_at).sort()[0]??null,intervalMinutes:Math.round((parse(js[0]?.payload).intervalSeconds??3600)/60),items:own.reduce((n,p)=>n+p.item_count,0),queued:own.reduce((n,p)=>n+p.queued_count,0),filtered:own.reduce((n,p)=>n+p.filtered_count,0),error:readableError(js.find(j=>j.last_error)?.last_error),running:js.some(j=>j.state==='running'),overdue:js.some(j=>Date.parse(j.due_at)<now.getTime()-15*60000)};
 });
 const summary=db.prepare("SELECT action,subject,detail FROM audit WHERE created_at>=? AND action IN ('feed-polled','events-merged','repeat-skipped','pro-final-editor','published','job-finished')").all(since).filter(r=>{if(source==='all')return true;const d=parse(r.detail);return r.subject===source||d.sourceId===source||eventSources.get(Number(d.eventId??r.subject))?.includes(source);});
 const stats={newArticles:0,filtered:0,merged:0,repeats:0,reviewed:0,published:0,completed:0};
 for(const r of summary){const d=parse(r.detail);if(r.action==='feed-polled'){stats.newArticles+=d.queued??0;stats.filtered+=d.filtered??0;}if(r.action==='events-merged')stats.merged++;if(r.action==='repeat-skipped')stats.repeats++;if(r.action==='pro-final-editor')stats.reviewed++;if(r.action==='published')stats.published++;if(r.action==='job-finished'&&d.outcome==='complete')stats.completed++;}
 stats.filtered+=db.prepare("SELECT count(*) n FROM triage_log t JOIN documents d ON d.id=t.document_id WHERE t.keep=0 AND t.created_at>=? AND (?='all' OR d.source_id=?)").get(since,source,source).n;
 const filteredQueue=queue.filter(j=>(queueState==='all'||j.state===queueState)&&(source==='all'||j.sourceId===source||j.sourceIds.includes(source)));
 return {generatedAt:stamp,since,budget:store.totalBudget(),usage:usageDashboard(store,since),counts,stats,queue:filteredQueue.slice(0,100),queueTotal:filteredQueue.length,logs,nextBefore:examined&&(logs.length===60||raw.length===1500)?examined:null,sources,lastPollAt:polls.map(p=>p.checked_at).sort().at(-1)??null,historyStartedAt:db.prepare("SELECT min(created_at) at FROM audit WHERE action='job-started'").get().at,archiveDiscoveryStopped:db.prepare('SELECT count(*) n FROM campaigns WHERE discovery_stopped=1').get().n>0};
}
