const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={checkedAt:'Проверено',versionDate:'Редакция закона',jurisdiction:'Юрисдикция',source:'Источник',stage:'Стадия дела',label:'Название',name:'Имя',role:'Роль',status:'Статус',profile:'Сведения о человеке',age:'Возраст',gender:'Пол',ageGroup:'Возрастная группа',citizenship:'Гражданство',count:'Количество',leader:'Лидер',note:'Сведения',sourceUrl:'Источник',sourceLabel:'Источник',asOf:'Дата сведений',kind:'Тип',wantedNotice:'Ориентировка',description:'Описание',offense:'Правонарушение',condition:'Условия',statutes:'Статьи',penalties:'Санкции',act:'Закон',section:'Параграф',url:'Ссылка',text:'Текст',detail:'Подробности',title:'Заголовок',caption:'Подпись',credit:'Автор',imageUrl:'Изображение',outlet:'Издание',isSensitive:'Чувствительное изображение',publishedAt:'Дата публикации',topic:'Тема',origin:'Происхождение',evidence:'Основания',rationale:'Обоснование',subject:'Относится к',relation:'Связь',attribution:'Со слов',verification:'Подтверждение',qualification:'Квалификация',statuteMatch:'Сопоставление',subjectLabel:'Относится к',min:'От',max:'До',unit:'Единица',code:'Код',type:'Тип'};
const values={reported:'По сообщению источника',investigation:'Расследование',trial:'Судебное разбирательство',sentence:'Приговор',appeal:'Обжалование',HU:'Венгрия',criminal:'Уголовный кодекс',administrative:'Административное право',detained:'Задержан',wanted:'Разыскивается','in-custody':'Под стражей',charged:'Предъявлено обвинение',convicted:'Осуждён',released:'Освобождён',deceased:'Погиб',injured:'Пострадал',unknown:'Неизвестно',suspect:'Подозреваемый',victim:'Потерпевший',involved:'Участник',male:'Мужчина',female:'Женщина',person:'Человек',group:'Группа',official:'Официальный источник',media:'СМИ',social:'Соцсеть',unverified:'Не подтверждено',corroborated:'Подтверждено несколькими источниками',disputed:'Оспаривается',retracted:'Отозвано',source:'Источник',model:'Предположение модели',editorial:'Сопоставление с законом','source-explicit':'Указано источником',supports:'Подтверждает',disputes:'Оспаривает',background:'Контекст',adult:'Взрослый',child:'Ребёнок',older:'Пожилой',death:'Погибшие',injury:'Пострадавшие','suspect-detained':'Подозреваемый задержан','suspect-wanted':'Подозреваемый разыскивается',imprisonment:'Лишение свободы',years:'Лет',months:'Месяцев',days:'Дней',hours:'Часов',fine:'Штраф',detention:'Арест','community-service':'Общественные работы','life-imprisonment':'Пожизненное лишение свободы',day:'До дня',hour:'До часа',exact:'Точно',circumstances:'Обстоятельства',motive:'Мотив',occupation:'Занятие','housing-status':'Жилищная ситуация','visitor-status':'Пребывание в городе',appearance:'Внешность',event:'Событие',participant:'Участник'};
export function displayValue(value){
  if(value===null||value===undefined)return 'Нет';
  if(typeof value==='boolean')return value?'Да':'Нет';
  if(Array.isArray(value))return value.map(displayValue).join('\n\n')||'Нет';
  if(typeof value==='object')return Object.entries(value).filter(([k])=>!['key','participantKey','reviewStatus'].includes(k)).map(([k,v])=>`${labels[k]??k}: ${displayValue(v)}`).join('\n');
  if(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Budapest',dateStyle:'medium',timeStyle:'short'});
  return values[value]??String(value);
}
export function highlightChange(before,after){
  const a=displayValue(before),b=displayValue(after);
  const at=a.match(/\s+|[^\s]+/gu)??[],bt=b.match(/\s+|[^\s]+/gu)??[];
  const render=(tokens,flags,tag)=>tokens.map((t,i)=>flags.has(i)?`<${tag}>${escape(t)}</${tag}>`:escape(t)).join('');
  // Bound the quadratic diff. Large passages keep matching prefix/suffix and
  // highlight the changed middle instead of risking a blocked mobile browser.
  const removed=new Set(at.map((_,i)=>i)),added=new Set(bt.map((_,i)=>i));
  if(at.length*bt.length<=90000){
    const rows=Array.from({length:at.length+1},()=>new Uint16Array(bt.length+1));
    for(let i=at.length-1;i>=0;i--)for(let j=bt.length-1;j>=0;j--)rows[i][j]=at[i]===bt[j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
    let i=0,j=0;while(i<at.length&&j<bt.length){if(at[i]===bt[j]){removed.delete(i++);added.delete(j++);}else if(rows[i+1][j]>=rows[i][j+1])i++;else j++;}
  }else{
    let i=0;while(i<at.length&&i<bt.length&&at[i]===bt[i]){removed.delete(i);added.delete(i++);}
    let x=at.length-1,y=bt.length-1;while(x>=i&&y>=i&&at[x]===bt[y]){removed.delete(x--);added.delete(y--);}
  }
  return {before:before===null?'<span class="muted">Не было</span>':render(at,removed,'del'),after:after===null?'<span class="muted">Будет удалено</span>':render(bt,added,'ins')};
}
const groups={event:'Основное',participants:'Участники',location:'Локация и геометка',updates:'Хронология',context:'Контекст и предположения',legal:'Правовая информация',media:'Фотографии',sources:'Источники',translations:'Английская и венгерская версии'};
export function renderChanges(comparison,{summary,reviewed=false}={}){
  if(!comparison)return '<p class="muted">Эта новость ещё не опубликована.</p>';
  if(comparison.pending)return '<p class="muted">Готовится перевод. После него появится точное сравнение с публикацией.</p>';
  const changes=comparison.changes,counts=comparison.counts;
  const intro=`<section class="publication-changes"><h3>Что изменится на сайте</h3><p class="meta">Сравнение с ${comparison.revision?'опубликованной версией '+escape(comparison.revision):'текущей публикацией'}. Неизменённые сведения скрыты.</p>${summary&&reviewed?`<div class="change-explanation"><strong>Pro об обновлении</strong><p>${escape(summary)}</p></div>`:''}`;
  if(!changes.length)return intro+'<p>Отличий в публикуемом содержимом нет.</p></section>';
  const totals=`<div class="change-totals"><span class="change-added">Добавлено: ${counts.added}</span><span>Изменено: ${counts.changed}</span><span class="change-removed">Удалено: ${counts.removed}</span></div>`;
  return intro+totals+Object.entries(groups).map(([group,label])=>{
    const items=changes.filter(c=>c.group===group);if(!items.length)return '';
    return `<details class="change-group" ${group==='translations'?'':'open'}><summary>${label} · ${items.length}</summary>${items.map(c=>{const pair=highlightChange(c.before,c.after);return `<article class="change-item"><div class="change-heading"><strong>${escape(c.label)}</strong><span class="pill ${c.kind==='added'?'good':c.kind==='removed'?'removed':'update'}">${({added:'Добавлено',removed:'Удалено',changed:'Изменено'})[c.kind]}</span></div><div class="change-columns"><div class="change-before"><small>Сейчас на сайте</small><div class="change-value">${pair.before}</div></div><div class="change-after"><small>После обновления</small><div class="change-value">${pair.after}</div></div></article>`;}).join('')}</details>`;
  }).join('')+'</section>';
}
