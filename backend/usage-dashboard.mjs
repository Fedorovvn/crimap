const sum=rows=>rows.reduce((a,r)=>({calls:a.calls+r.calls,input:a.input+r.input,output:a.output+r.output,tokens:a.tokens+r.input+r.output,cost:a.cost+r.cost,reserved:a.reserved+r.reserved,failed:a.failed+r.failed}),{calls:0,input:0,output:0,tokens:0,cost:0,reserved:0,failed:0});
export function usageDashboard(store,since,until=new Date().toISOString()){
 const db=store.db;
 const rows=db.prepare(`SELECT stage,model,count(*) calls,coalesce(sum(input_tokens),0) input,coalesce(sum(output_tokens),0) output,
   coalesce(sum(cost_usd),0) cost,coalesce(sum(CASE WHEN cost_usd IS NULL THEN reserved_usd ELSE 0 END),0) reserved,
   sum(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed FROM usage WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?) GROUP BY stage,model ORDER BY stage,model`).all(since,until);
 const triage=db.prepare('SELECT method,keep,count(*) n FROM triage_log WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?) GROUP BY method,keep').all(since,until);
 const count=(method,keep)=>triage.filter(r=>(!method||r.method===method)&&r.keep===keep).reduce((n,r)=>n+r.n,0);
 const audits=db.prepare("SELECT action,detail FROM audit WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?) AND action IN ('feed-polled','repeat-skipped','events-merged','uninteresting-update-skipped','pro-final-editor','published','model-cache-hit')").all(since,until);
 let found=0,feedFiltered=0,repeats=0,merged=0,ignored=0,passed=0,revised=0,rejected=0,published=0,cacheHits=0;
 for(const r of audits){let d;try{d=JSON.parse(r.detail);}catch{continue;}if(r.action==='feed-polled'){found+=d.queued??0;feedFiltered+=d.filtered??0;}if(r.action==='repeat-skipped')repeats++;if(r.action==='events-merged')merged++;if(r.action==='uninteresting-update-skipped')ignored++;if(r.action==='published')published++;if(r.action==='model-cache-hit')cacheHits++;if(r.action==='pro-final-editor'){if(d.verdict==='pass')passed++;if(d.verdict==='revise')revised++;if(d.verdict==='reject')rejected++;}}
 const definitions=[
  {id:'discovery',label:'Сбор источников',stages:[],engine:'Бесплатно',description:'Часовые ленты, проверка известных ссылок и бесплатные правила. Старая ссылка не запускает новый разбор.',results:[`Новых ссылок: ${found}`,`Отсеяно в лентах: ${feedFiltered}`,`Отсеяно правилами по полному тексту: ${count('rules',0)}`]},
  {id:'triage',label:'Подходит ли нам',stages:['triage'],engine:'Flash',description:'После бесплатного отсева каждый оставшийся кандидат проходит короткую проверку тематики Flash. Неподходящие материалы здесь останавливаются.',results:[`Прошло Flash: ${count('flash-short',1)}`,`Отсеяно Flash: ${count('flash-short',0)}`,`ДТП отложено: ${count('rules-deferred',1)+count('flash-deferred',1)}`]},
  {id:'identity',label:'Поиск дублей',stages:['identify','compare'],engine:'Индекс + Flash',description:'Бесплатный индекс подбирает похожие события. Flash сравнивает краткие факты; повтор без новых сведений останавливается до дорогих этапов.',results:[`Повторов пропущено: ${repeats}`,`Объединений: ${merged}`,`Обновлений неинтересных: ${ignored}`]},
  {id:'compose',label:'Сборка события',stages:['extract','merge'],engine:'Flash',description:'Извлечение участников, обстоятельств и точных цитат. Новые факты объединяются с существующей карточкой.',results:[]},
  {id:'enrich',label:'Детали и фотографии',stages:['research','details','media','media-review','resolve-date'],engine:'Flash + сервисы',description:'Поиск дополнительных источников, полнота карточки, выбор полезных фотографий и уточнение даты. Геокодер выполняет отдельные бесплатные запросы.',results:[]},
  {id:'update-comparison',label:'Есть ли новые сведения',stages:['update-compare'],engine:'Flash',description:'Сравнение обновления с опубликованной карточкой до переводов и Pro. Эквивалентные формулировки пропускаются; новые факты, исправления и сомнения идут в финальную проверку.',results:[]},
  {id:'translation',label:'Переводы',stages:['translate','site-translate'],engine:'Flash',description:'Черновики перевода для всех языков. Неизменные готовые переводы переиспользуются.',results:[]},
  {id:'review',label:'Финальная проверка',stages:['review','repair'],engine:'Pro',description:'Проверка фактов, правовой информации, карты и переводов. Pro сама исправляет финальную карточку. Старые вызовы исправлений Flash тоже видны в детализации.',results:[`Пройдено: ${passed}`,`На доработку: ${revised}`,`Отклонено: ${rejected}`]},
  {id:'publish',label:'Публикация',stages:[],engine:'Редактор',description:'Вы выбираете готовую карточку и публикуете. Автоматическая проверка сама новость не публикует.',results:[`Публикаций и обновлений: ${published}`]},
 ];
 const known=new Set(definitions.flatMap(d=>d.stages));if(rows.some(r=>!known.has(r.stage)))definitions.splice(-1,0,{id:'other',label:'Другие этапы',stages:[...new Set(rows.filter(r=>!known.has(r.stage)).map(r=>r.stage))],engine:'По журналу',description:'Исторические этапы, не относящиеся к текущей схеме.',results:[]});
 const steps=definitions.map(d=>{const own=rows.filter(r=>d.stages.includes(r.stage));return {...d,...sum(own),rows:own};});
 return {since,until,series:usageSeries(db,since,until),totals:sum(rows),cacheHits,models:[...new Set(rows.map(r=>r.model))].map(model=>({model,...sum(rows.filter(r=>r.model===model))})),steps,byDay:db.prepare("SELECT substr(created_at,1,10) day,count(*) calls,coalesce(sum(input_tokens+output_tokens),0) tokens,coalesce(sum(cost_usd),0) cost FROM usage WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?) GROUP BY substr(created_at,1,10) ORDER BY day").all(since,until),cacheHistoryStartedAt:db.prepare("SELECT min(created_at) at FROM audit WHERE action='model-cache-hit'").get().at};
}

// Bound chart resolution to at most 120 intervals; empty intervals remain visible.
export function usageSeries(db,since,until){
 const first=db.prepare('SELECT min(created_at) at FROM usage WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?)').get(since,until).at;
 const end=Date.parse(until),start=Number.isFinite(Date.parse(since))?Date.parse(since):Date.parse(first??until);
 const span=Math.max(1,end-start),hour=3600000;
 const bucketMs=span<=2*86400000?hour:span<=45*86400000?86400000:Math.ceil(span/(120*86400000))*86400000;
 const count=Math.max(1,Math.ceil(span/bucketMs));
 const points=Array.from({length:count},(_,i)=>({at:new Date(start+i*bucketMs).toISOString(),until:new Date(Math.min(end,start+(i+1)*bucketMs)).toISOString(),flash:{tokens:0,cost:0,calls:0},pro:{tokens:0,cost:0,calls:0},other:{tokens:0,cost:0,calls:0}}));
 const rows=db.prepare(`SELECT min(?,max(0,CAST(round((julianday(created_at)-julianday(?))*86400000)/? AS INTEGER))) bucket,model,count(*) calls,coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0) tokens,coalesce(sum(cost_usd),0) cost FROM usage WHERE julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?) GROUP BY bucket,model`).all(count-1,new Date(start).toISOString(),bucketMs,since,until);
 for(const row of rows){const group=/pro|reasoner/i.test(row.model)?'pro':/flash|chat/i.test(row.model)?'flash':'other';for(const key of ['tokens','cost','calls'])points[row.bucket][group][key]+=row[key];}
 return {bucketMs,points};
}
