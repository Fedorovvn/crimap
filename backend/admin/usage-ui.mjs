import {chartMarkup,bindCharts} from './charts.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n??0).toLocaleString('ru-RU'),compact=n=>Number(n??0).toLocaleString('ru-RU',{notation:'compact',maximumFractionDigits:1}),money=n=>'$'+Number(n??0).toFixed(4);
const stageLabels={'update-compare':'Сравнение обновлений',triage:'Проверка тематики',identify:'Краткое описание события',compare:'Сравнение дублей',extract:'Извлечение фактов',merge:'Объединение сведений',research:'План поиска источников',details:'Полнота карточки',media:'Поиск фотографий','media-review':'Оценка фотографий','resolve-date':'Уточнение даты',translate:'Перевод на русский','site-translate':'Переводы EN/HU',review:'Финальная редактура',repair:'Исправление (старый этап)'};
let current=null,selected='identity',metric='tokens';
function detail(){
 if(!current)return;const step=current.steps.find(s=>s.id===selected)??current.steps[0];
 $('#usage-detail').innerHTML=`<span class="eyebrow">ВЫБРАННЫЙ ЭТАП</span><h3>${esc(step.label)}</h3><p>${esc(step.description)}</p><div class="usage-outcomes">${step.results.map(r=>`<span class="pill">${esc(r)}</span>`).join('')}</div>${step.rows.length?table(step.rows):'<p class="fact">За выбранный период на этом этапе нет оплачиваемых запросов к модели.</p>'}`;
 for(const b of document.querySelectorAll('[data-usage-step]'))b.setAttribute('aria-pressed',String(b.dataset.usageStep===step.id));
}
function table(rows){return `<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>Этап / модель</th><th>Запросы</th><th>Входные</th><th>Выходные</th><th>Всего токенов</th><th>Стоимость</th><th>Резерв</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${esc(stageLabels[r.stage]??r.stage??'Все этапы')}<small>${esc(r.model)}</small>${r.failed?`<small class="activity-reason">Ошибок запросов: ${r.failed}</small>`:''}</th><td>${number(r.calls)}</td><td>${number(r.input)}</td><td>${number(r.output)}</td><td><strong>${number(r.tokens??r.input+r.output)}</strong></td><td>${money(r.cost)}</td><td>${r.reserved?money(r.reserved):'—'}</td></tr>`).join('')}</tbody></table></div>`;}
export function renderUsage(data){
 if(!data)return;current=data;$('#usage-charts').innerHTML=chartMarkup(data,metric,Math.max(300,$('#usage-charts').clientWidth-48));const t=data.totals;
 $('#usage-summary').innerHTML=[[number(t.tokens),'Всего токенов'],[number(t.input),'Входные токены'],[number(t.output),'Выходные токены'],[money(t.cost),'Оценка стоимости'],[money(t.reserved),'Незавершённые резервы'],[number(t.calls),'Попытки запросов']].map(([n,label])=>`<article><strong>${n}</strong><span>${label}</span></article>`).join('');
 const max=Math.max(1,...data.steps.map(s=>s[metric]));
 $('#usage-flow').innerHTML=data.steps.map((s,i)=>`<button class="usage-step" data-usage-step="${esc(s.id)}" aria-pressed="${selected===s.id}"><span class="usage-step-number">${i+1} · ${esc(s.engine)}</span><strong>${esc(s.label)}</strong><span class="usage-step-value">${metric==='cost'?money(s.cost):compact(s[metric])}<small>${metric==='tokens'?'токенов':metric==='cost'?'за период':'запросов'}</small></span><progress value="${s[metric]}" max="${max}" aria-label="${esc(s.label)} — ${metric==='tokens'?'токены':metric==='cost'?'стоимость':'запросы'}"></progress><span class="usage-step-result">${s.results.length?s.results.map(esc).join('<br>'):'Открыть детализацию'}</span></button>`).join('');
 detail();
 $('#usage-models').innerHTML=`<h3>По моделям</h3>${data.models.length?table(data.models):'<p class="fact">Платных запросов пока нет.</p>'}<p class="fact">Повторно использовано готовых ответов без запроса к API: <strong>${number(data.cacheHits)}</strong>. Этот счётчик записывается с ${data.cacheHistoryStartedAt?new Date(data.cacheHistoryStartedAt).toLocaleDateString('ru-RU'):'текущего обновления'}.</p>`;
 const dailyMax=Math.max(1,...data.byDay.map(d=>metric==='calls'?d.calls:metric==='cost'?d.cost:d.tokens));
 $('#usage-days').innerHTML=`<h3>По дням · UTC</h3><div class="usage-daily">${data.byDay.map(d=>`<div><time>${esc(d.day)}</time><progress value="${d[metric]}" max="${dailyMax}" aria-label="${esc(d.day)}"></progress><strong>${metric==='cost'?money(d.cost):number(d[metric])}</strong></div>`).join('')||'<p class="fact">Расходов за период нет.</p>'}</div>`;
}
$('#usage-flow').addEventListener('click',e=>{const b=e.target.closest('[data-usage-step]');if(b){selected=b.dataset.usageStep;detail();}});
$('#usage-metric').addEventListener('change',e=>{metric=e.target.value;renderUsage(current);});

bindCharts($('#usage-charts'),id=>{selected=id;detail();$('#usage-detail').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});});

let chartWidth=0;new ResizeObserver(entries=>{const width=Math.round(entries[0].contentRect.width);if(width>0&&width!==chartWidth){chartWidth=width;renderUsage(current);}}).observe($('#usage-charts'));
