import {renderUsage} from './usage-ui.mjs';
import {setupRange,updateRange,rangeParams,rangeEditing} from './range-ui.mjs';
const $=s=>document.querySelector(s),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>s?new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Budapest',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Ещё не было';
const states={running:'Выполняется',ready:'В очереди',scheduled:'Запланировано',paused:'На паузе',failed:'Обработка остановлена','waiting-fatality':'ДТП: ожидает сведений о погибших','waiting-date':'Ожидает даты',stale:'Прервано'};
const external=(url,label)=>/^https?:\/\//.test(url??'')?`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>`:escape(label);
const title=r=>r.eventId?`<a href="/admin/?event=${r.eventId}">${escape(r.title??`Событие №${r.eventId}`)}</a>`:external(r.url,r.title??r.sourceName??'Без отдельного события');
let requestId=0,controller=null,nextBefore=null,older=false,view='queue',logs=[],sourceOptions='';
function tab(name){view=name;$('#activity-stats').hidden=name==='usage';$('#activity-source').disabled=name==='usage';for(const v of ['queue','journal','sources','usage']){$('#panel-'+v).hidden=v!==name;$('#tab-'+v).setAttribute('aria-selected',String(v===name));}}
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{tab(b.dataset.view);history.replaceState(null,'','#'+view);});
document.querySelector('.activity-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const vs=['queue','journal','sources','usage'],i=vs.indexOf(view),n=e.key==='Home'?0:e.key==='End'?3:(i+(e.key==='ArrowRight'?1:3))%4;tab(vs[n]);$('#tab-'+vs[n]).focus();});
function render(data,append){
 updateRange(data);renderUsage(data.usage);
 $('#activity-updated').textContent='Обновлено '+date(data.generatedAt);
 const c=data.counts,b=data.budget;
 $('#activity-health').innerHTML=`<div class="activity-health-row"><span class="pill ${c.running?'good':''}">${c.running?`В работе: ${c.running}`:'Нет активных задач'}</span><span>Готовы к запуску: <strong>${c.ready??0}</strong></span><span>На паузе: <strong>${c.paused??0}</strong></span><span>Ожидают даты: <strong>${c['waiting-date']??0}</strong></span><span>Ошибки: <strong>${(c.failed??0)+(c.stale??0)}</strong></span><span>Ожидают повтора: <strong>${c.retry??0}</strong></span></div><p class="fact">Последний успешный обход: ${escape(date(data.lastPollAt))}. Источники проверяются каждый час.${data.archiveDiscoveryStopped?' Архивный сбор остановлен.':''} Время — Будапешт.</p>${b?`<p class="fact">Общий бюджет: $${b.limit.toFixed(2)} · Учтено $${b.spent.toFixed(3)} · Осталось <strong>$${b.remaining.toFixed(3)}</strong>. <a href="/admin/#budget">Изменить лимит</a></p>`:''}`;
 const labels={newArticles:'Новых статей',filtered:'Отсеяно',merged:'Объединений',repeats:'Повторов пропущено',reviewed:'Проверок Pro',published:'Публикаций'};
 $('#activity-stats').innerHTML=Object.entries(labels).map(([key,label])=>`<article><strong>${data.stats[key]}</strong><span>${label}</span></article>`).join('');
 const selected=$('#activity-source').value;
 const options=data.sources.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}</option>`).join('');
 if(options!==sourceOptions){sourceOptions=options;$('#activity-source').innerHTML='<option value="all">Все источники</option>'+options;$('#activity-source').value=selected;}
 $('#activity-queue').innerHTML=data.queue.map(j=>`<article class="activity-record" data-state="${j.state}"><div class="activity-record-meta"><span class="pill ${j.state==='running'?'good':['paused','failed'].includes(j.state)?'danger':j.state==='stale'?'warn':''}">${states[j.state]??j.state}</span>${j.priority?'<span class="pill good">★ Приоритет</span>':''}<span>${escape(j.label)}</span><span class="muted">№${j.id}</span></div><h3>${title(j)}</h3><p class="fact">${j.sourceName?escape(j.sourceName)+' · ':''}${j.archive?'Сохранённые материалы · ':''}${j.state==='running'?'Начало: '+escape(date(j.startedAt)):'Запуск не ранее: '+escape(date(j.dueAt))}</p>${j.reason?`<p class="activity-reason">${escape(j.reason)}</p><p class="fact">${j.state==="failed"?"Автоматические попытки закончились; задача сама больше не повторяется.":["ready","scheduled"].includes(j.state)?"Автоматический повтор в очереди. Выполнено попыток: "+j.attempts:""}</p>`:''}</article>`).join('')||'<p class="empty">Задач с такими условиями нет.</p>';
 $('#activity-queue-count').textContent=`Показано ${data.queue.length} из ${data.queueTotal}. В очередь не входят завершённые и отменённые задачи; их результаты — в журнале.`;
 logs=append?[...logs,...data.logs]:data.logs;nextBefore=data.nextBefore;
 $('#activity-journal').innerHTML=logs.map(r=>`<article class="activity-record"><div class="activity-record-meta"><time>${escape(date(r.at))}</time><span class="pill ${r.category==='errors'?'warn':r.category==='duplicates'?'good':''}">${escape(r.label)}</span>${r.kind?`<span>${escape(r.kind)}</span>`:''}${r.durationSeconds!==null?`<span>${r.durationSeconds} сек.</span>`:''}</div><h3>${title(r)}</h3>${r.description?`<p>${escape(r.description)}</p>`:''}${r.sourceName?`<p class="fact">${escape(r.sourceName)}</p>`:''}</article>`).join('')||'<p class="empty">За этот период действий с такими условиями нет.</p>';
 $('#activity-more').hidden=!nextBefore;
 $('#activity-history-note').textContent=`Результаты сохраняются между перезапусками. Подробное время выполнения задач записывается ${data.historyStartedAt?'с '+date(data.historyStartedAt):'с этого обновления'}; более ранние решения доступны из прежнего журнала.`;
 $('#activity-sources').innerHTML=data.sources.map(s=>`<article class="activity-source"><div class="activity-record-meta"><span class="pill ${s.error||s.overdue?'warn':'good'}">${s.error?'Ошибка':s.running?'Проверяется':s.overdue?'Обход задерживается':'Подключён'}</span><span>Каждые ${s.intervalMinutes} мин.</span></div><h3>${external(s.url,s.name)}</h3><dl><div><dt>Последний обход</dt><dd>${escape(date(s.lastCheckedAt))}</dd></div><div><dt>Следующий обход</dt><dd>${escape(date(s.nextCheckAt))}</dd></div></dl><p>В ленте <strong>${s.items}</strong> · новых <strong>${s.queued}</strong> · отсеяно <strong>${s.filtered}</strong></p>${s.error?`<p class="activity-reason">${escape(s.error)}</p>`:''}</article>`).join('')||'<p class="empty">Источники пока не подключены.</p>';
}
async function load(append=false){
 if(append&&controller)return;controller?.abort();const own=++requestId;controller=new AbortController();$('#activity-page').setAttribute('aria-busy','true');$('#activity-refresh').disabled=true;$('#activity-more').disabled=true;
 try{
  const params=new URLSearchParams({period:$('#activity-period').value,source:$('#activity-source').value,category:$('#activity-category').value,queueState:$('#activity-state').value,...rangeParams()});
  if(append&&nextBefore)params.set('before',nextBefore);
  const response=await fetch('/admin/api/activity?'+params,{signal:controller.signal});if(response.status===401){$('#activity-error').innerHTML='Сессия завершена. <a href="/admin/">Войти в редактор</a>';$('#activity-error').hidden=false;return;}
  if(!response.ok)throw new Error('Не удалось обновить данные. Последние полученные результаты оставлены на экране.');
  const data=await response.json();if(own!==requestId)return;$('#activity-error').hidden=true;render(data,append);older=append;
 }catch(e){if(e.name!=='AbortError'&&own===requestId){$('#activity-error').textContent=e.message;$('#activity-error').hidden=false;}}finally{if(own===requestId){controller=null;$('#activity-page').setAttribute('aria-busy','false');$('#activity-refresh').disabled=false;$('#activity-more').disabled=false;}}
}
$('#activity-refresh').addEventListener('click',()=>load());$('#activity-more').addEventListener('click',()=>load(true));
for(const id of ['source','category','state'])$('#activity-'+id).addEventListener('change',()=>load());
setInterval(()=>{if(!document.hidden&&$('#activity-auto').checked&&!older&&!controller&&!rangeEditing())load();},15000);
if(['queue','journal','sources','usage'].includes(location.hash.slice(1)))tab(location.hash.slice(1));
const requestedCategory=new URLSearchParams(location.search).get('category');
if([...$('#activity-category').options].some(o=>o.value===requestedCategory))$('#activity-category').value=requestedCategory;
const requestedQueue=new URLSearchParams(location.search).get('queueState');
if([...$('#activity-state').options].some(o=>o.value===requestedQueue))$('#activity-state').value=requestedQueue;
setupRange(()=>{older=false;load();});
load();
