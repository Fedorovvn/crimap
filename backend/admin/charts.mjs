const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n??0).toLocaleString('ru-RU',{maximumFractionDigits:0});
const amount=(n,metric)=>metric==='cost'?'$'+Number(n).toFixed(4):number(n);
const short=(n,metric)=>metric==='cost'?'$'+Number(n).toFixed(n<1?3:2):Number(n).toLocaleString('ru-RU',{notation:'compact',maximumFractionDigits:1});
const stamp=(s,options={})=>new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Budapest',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',...options});
const groups=[['flash','Flash'],['pro','Pro'],['other','Другие']];
export function chartMarkup(data,metric,availableWidth=920){
 const points=data.series?.points??[],total=data.totals[metric]??0;
 const active=groups.filter(([g])=>points.some(p=>p[g][metric]>0));
 const max=Math.max(...points.map(p=>groups.reduce((n,[g])=>n+p[g][metric],0)),0);
 const ceiling=max?max*1.12:1;
 const W=Math.max(300,availableWidth),H=250,L=W<500?48:68,R=12,T=18,B=35,inner=W-L-R,height=H-T-B;
 const grid=[0,.25,.5,.75,1].map(f=>{const y=T+height*(1-f);return `<line class="chart-gridline" x1="${L}" x2="${W-R}" y1="${y}" y2="${y}"/><text class="chart-axis" x="${L-12}" y="${y+4}" text-anchor="end">${esc(short(f*ceiling,metric))}</text>`;}).join('');
 const width=inner/Math.max(1,points.length);
 const bars=points.map((p,i)=>{
  let y=T+height;const sum=groups.reduce((n,[g])=>n+p[g][metric],0);
  const text=`${stamp(p.at)} — ${stamp(p.until)} · ${amount(sum,metric)}${metric==='tokens'?' токенов':metric==='calls'?' запросов':''}`;
  const parts=groups.map(([g,label])=>{const h=p[g][metric]/ceiling*height;y-=h;return `<rect class="series-${g}" x="${L+i*width+width*.15}" y="${y}" width="${Math.max(.4,width*.7)}" height="${h}" rx="2"/>`;}).join('');
  const values=active.map(([g,label])=>`${label}: ${amount(p[g][metric],metric)}`).join(' · ');
  return `<g class="chart-column" tabindex="0" role="button" aria-label="${esc(text+'; '+values)}" data-chart-index="${i}" data-chart-tip="${esc(text)}" data-chart-values="${esc(values)}"><rect class="chart-hit" x="${L+i*width}" y="${T}" width="${width}" height="${height}"/>${parts}</g>`;
 }).join('');
 const labels=[...new Set((W<550?[0,points.length-1]:[0,Math.floor(points.length/2),points.length-1]))].filter(i=>points[i]).map(i=>`<text class="chart-axis" x="${L+(i+.5)*width}" y="${H-7}" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(stamp(points[i].at))}</text>`).join('');
 const steps=data.steps.filter(s=>s[metric]>0).sort((a,b)=>b[metric]-a[metric]);
 const top=Math.max(1e-9,...steps.map(s=>s[metric]));
 return `<div class="chart-card chart-timeline"><div class="chart-heading"><div><span class="eyebrow">ДИНАМИКА</span><h3>${metric==='tokens'?'Токены во времени':metric==='cost'?'Расходы во времени':'Запросы во времени'}</h3></div><div class="chart-total">${esc(amount(total,metric))}<small>за выбранный период</small></div></div><div class="chart-legend">${active.map(([g,label])=>`<span><i class="series-${g}"></i>${label}</span>`).join('')}<span class="chart-resolution">${data.series?.bucketMs<86400000?'По часам':data.series?.bucketMs===86400000?'По суткам':`Интервалы по ${Math.round(data.series?.bucketMs/86400000)} дн`} · Будапешт</span></div>${max?`<div class="timeline-scroll"><svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="График по времени: выберите столбец для подробностей">${grid}${bars}${labels}</svg></div><div class="chart-readout" aria-live="polite"><strong>Наведите на столбец или нажмите на него</strong><span>Flash и Pro показаны разными цветами</span></div>`:'<div class="chart-empty">За этот период нет данных для графика</div>'}</div><div class="chart-card"><div class="chart-heading"><div><span class="eyebrow">РАСПРЕДЕЛЕНИЕ</span><h3>На какие этапы уходит больше</h3></div></div><div class="stage-bars">${steps.map(s=>`<button class="stage-bar" data-chart-stage="${esc(s.id)}"><span>${esc(s.label)}</span><strong>${esc(amount(s[metric],metric))}<small>${(s[metric]/Math.max(1e-9,total)*100).toFixed(1)}%</small></strong><svg viewBox="0 0 1000 5" preserveAspectRatio="none" aria-hidden="true"><rect class="stage-bar-track" width="1000" height="5" rx="2"/><rect class="stage-bar-fill" width="${s[metric]/top*1000}" height="5" rx="2"/></svg></button>`).join('')||'<p class="fact">Нет расходов за выбранный период.</p>'}</div><p class="fact">Нажмите на этап для подробной разбивки по моделям.</p></div>`;
}
export function bindCharts(root,onStage){
 const show=target=>{const column=target.closest?.('[data-chart-tip]');if(!column)return;const readout=root.querySelector('.chart-readout');readout.querySelector('strong').textContent=column.dataset.chartTip;readout.querySelector('span').textContent=column.dataset.chartValues;for(const el of root.querySelectorAll('.chart-column'))el.classList.toggle('is-highlighted',el===column);};
 root.addEventListener('pointerover',e=>show(e.target));root.addEventListener('focusin',e=>show(e.target));
 root.addEventListener('click',e=>{show(e.target);const stage=e.target.closest('[data-chart-stage]');if(stage)onStage(stage.dataset.chartStage);});
 root.addEventListener('keydown',e=>{const el=e.target.closest('[data-chart-index]');if(!el||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const next=Number(el.dataset.chartIndex)+(e.key==='ArrowRight'?1:-1);root.querySelector(`[data-chart-index="${next}"]`)?.focus();});
}
