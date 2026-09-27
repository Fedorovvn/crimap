import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { hash } from './store.mjs';
import { displayStrings } from './site-localization.mjs';
import { isPublishableContext } from '../app/context-model.ts';
import { isPublishableLegal } from '../app/legal-model.ts';

export const typeLabels={'traffic-accident':'ДТП',assault:'Нападение',fight:'Драка',robbery:'Ограбление',accident:'Несчастный случай',fire:'Пожар',rescue:'Спасательная операция','missing-person':'Пропавший человек','transport-disruption':'Транспорт',weather:'Непогода',other:'Происшествие'};
export const statusLabels={reported:'Сообщается о происшествии',investigating:'В расследовании','suspects-detained':'Подозреваемые задержаны',wanted:'Подозреваемый разыскивается',resolved:'Ситуация разрешена',closed:'Дело закрыто',unknown:'Статус уточняется'};
export const precisionLabels={exact:'Точное место',street:'Улица; точное место не раскрыто',landmark:'Приблизительно: у указанного ориентира',district:'Приблизительно: район',city:'Приблизительно: город',unknown:'Место уточняется'};
export const verificationLabel=docs=>docs.every(d=>(d.sourceKind??d.source_kind)==='official')?'Официальный источник':docs.some(d=>(d.sourceKind??d.source_kind)==='official')?'Официальные данные и сообщения СМИ':'По сообщениям СМИ';
const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).filter(k=>!['reviewStatus'].includes(k)&&value[k]!==undefined).sort().map(k=>[k,clean(value[k])])):value;
const photo=m=>({imageUrl:m.imageUrl,sourceUrl:m.sourceUrl,outlet:m.outlet,credit:m.credit,caption:m.caption,isSensitive:!!m.isSensitive});
const timestamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():value??null;
export function draftPublication(event,documents,preparation,languages,{includeContext=true,includeLegal=true}={}){
  const docs=[...new Map(documents.map(d=>[d.url,d])).values()];
  const context=event.context.filter(c=>isPublishableContext({...c,reviewStatus:includeContext?'approved':c.reviewStatus}));
  const legal=event.legal.filter(l=>isPublishableLegal({...l,reviewStatus:includeLegal?'approved':l.reviewStatus}));
  const media=event.media.filter(m=>preparation?m.rights!=='link-only':['licensed','permission','public-domain'].includes(m.rights));
  const publicTexts=new Set(displayStrings({...event,context,legal,media,retainedMedia:preparation?.retainedMedia}));
  return clean({title:event.title,summary:event.summary,category:typeLabels[event.type],status:statusLabels[event.status],verification:verificationLabel(docs),timePrecision:event.timePrecision,occurredAt:timestamp(event.occurredAt),
    location:{district:event.location.district??'Будапешт',label:event.location.label,precision:precisionLabels[event.location.precision],latitude:event.location.latitude,longitude:event.location.longitude},signals:[...event.signals].sort(),
    participants:event.participants,context,legal,
    updates:event.updates.map(u=>({publishedAt:timestamp(u.publishedAt),title:u.title,detail:u.detail,verification:docs.find(d=>d.url===u.sourceUrl)?.source_kind==='official'||docs.find(d=>d.url===u.sourceUrl)?.sourceKind==='official'?'Официальный источник':'По сообщению СМИ'})),
    media:[...media,...(preparation?.retainedMedia??[])].map(photo),
    sources:docs.map(d=>({url:d.url,outlet:new URL(d.url).hostname,type:(d.sourceKind??d.source_kind)==='official'?'Официально':'Неофициально',publishedAt:timestamp(d.publishedAt??d.published_at??d.first_seen_at),note:d.publishedAt||d.published_at?'':'Дата первой загрузки; время публикации не указано'})),
    translations:languages?Object.fromEntries(Object.entries(languages).map(([lang,strings])=>[lang,Object.fromEntries(Object.entries(strings).filter(([text])=>publicTexts.has(text)))])): {},
  });
}

export function readPublication(pathOrDb,slug){
  if(!pathOrDb||typeof pathOrDb==='string'&&!existsSync(pathOrDb))return null;
  const owned=typeof pathOrDb==='string',db=owned?new DatabaseSync(pathOrDb,{readOnly:true}):pathOrDb;
  if(owned)db.exec('BEGIN');
  try{
    const row=db.prepare('SELECT * FROM incidents WHERE slug=?').get(slug);if(!row)return null;
    const meta=db.prepare('SELECT details FROM incident_metadata WHERE incident_id=?').get(row.id),metadata=meta?JSON.parse(meta.details):{};
    if(metadata.hidden)return null;
    const lists={};for(const name of ['participants','context','legal','updates','sources','media'])lists[name]=db.prepare(`SELECT * FROM incident_${name} WHERE incident_id=? ORDER BY id`).all(row.id);
    const snapshot=clean({title:row.title,summary:row.summary,category:row.category,status:row.status,verification:row.verification,timePrecision:metadata.timePrecision??'unknown',occurredAt:timestamp(row.occurred_at),
      location:{district:row.district,label:row.location_label,precision:row.location_precision,latitude:row.latitude,longitude:row.longitude},signals:[...(metadata.signals??[])].sort(),
      ...Object.fromEntries(['participants','context','legal'].map(k=>[k,lists[k].map(r=>JSON.parse(r.details))])),
      updates:lists.updates.map(u=>({publishedAt:timestamp(u.published_at),title:u.title,detail:u.detail,verification:u.verification})),
      sources:lists.sources.map(s=>({url:s.source_url,outlet:s.outlet,type:s.source_type,publishedAt:timestamp(s.published_at),note:s.note??''})),
      media:lists.media.map(m=>photo({imageUrl:m.image_url,sourceUrl:m.source_url,outlet:m.outlet,credit:m.credit,caption:m.caption,isSensitive:m.is_sensitive})),translations:metadata.translations??{},
    });
    return {...row,revision:metadata.revision??null,snapshot,counts:Object.fromEntries(Object.entries(lists).map(([k,v])=>[k,v.length])),fingerprint:hash({id:row.id,revision:metadata.revision??null,snapshot})};
  }finally{if(owned){db.exec('ROLLBACK');db.close();}}
}

export const changeLabels={title:'Заголовок',summary:'Описание',category:'Тип события',status:'Статус',verification:'Подтверждение',occurredAt:'Дата происшествия',timePrecision:'Точность времени',location:'Место',district:'Район',label:'Название',precision:'Точность места',latitude:'Широта',longitude:'Долгота',signals:'Последствия',participants:'Участники',context:'Контекст',legal:'Правовая информация',updates:'Хронология',sources:'Источники',media:'Фотографии',translations:'Переводы',en:'Английский',hu:'Венгерский',role:'Роль',profile:'Сведения о человеке',age:'Возраст',gender:'Пол',citizenship:'Гражданство',name:'Имя',ageGroup:'Возрастная группа',count:'Количество',leader:'Лидер',note:'Сведения',asOf:'Дата сведений',sourceUrl:'Источник',sourceLabel:'Название источника',wantedNotice:'Ориентировка',description:'Описание',offense:'Правонарушение',condition:'Условия',statutes:'Статьи',penalties:'Санкции',qualification:'Квалификация',statuteMatch:'Сопоставление',source:'Источник',act:'Закон',section:'Параграф',url:'Ссылка',text:'Текст',detail:'Подробности',caption:'Подпись',credit:'Автор',imageUrl:'Изображение',outlet:'Издание',isSensitive:'Чувствительное изображение',publishedAt:'Дата публикации',topic:'Тема',origin:'Происхождение',evidence:'Основания',rationale:'Обоснование',subject:'К кому относится',kind:'Тип',relation:'Связь',attribution:'Со слов',participantKey:'Участник',subjectLabel:'К кому относится',min:'От',max:'До',unit:'Единица',code:'Код',key:'Идентификатор',type:'Тип'};
const groupFor=key=>['participants','context','legal','updates','sources','media','translations','location'].includes(key)?key:'event';
export function publicationChanges(before,after){
  const changes=[];
  function walk(a,b,path,labels,group){
    if(isDeepStrictEqual(a,b))return;
    const add=()=>changes.push({path,group,label:labels.join(' · '),kind:a===undefined?'added':b===undefined?'removed':'changed',before:a??null,after:b??null});
    if(a===undefined||b===undefined)return add();
    if(Array.isArray(a)&&Array.isArray(b)){
      if(path==='signals')return add();
      // Stable identities prevent every subsequent item looking changed after
      // an insertion. Timeline entries without keys are matched by position.
      const identity=v=>v?.key??v?.imageUrl??v?.url??v?.publishedAt;
      if([...a,...b].every(v=>identity(v))&&new Set(a.map(identity)).size===a.length&&new Set(b.map(identity)).size===b.length){
        const am=new Map(a.map(v=>[identity(v),v])),bm=new Map(b.map(v=>[identity(v),v]));
        for(const key of new Set([...am.keys(),...bm.keys()])){const item=bm.get(key)??am.get(key);walk(am.get(key),bm.get(key),`${path}.${encodeURIComponent(key)}`,[...labels,item.label??(item.offense?[item.offense,item.subjectLabel].filter(Boolean).join(' · '):null)??item.caption??item.outlet??item.text?.slice(0,90)??String(key)],group);}
      }else for(let i=0;i<Math.max(a.length,b.length);i++)walk(a[i],b[i],`${path}.${i}`,[...labels,String(i+1)],group);
    }else if(a&&b&&typeof a==='object'&&typeof b==='object'){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[key],b[key],path?`${path}.${key}`:key,[...labels,changeLabels[key]??key],group??groupFor(key));
    }else add();
  }
  walk(before,after,'',[],undefined);return changes;
}
export function comparisonFor(published,event,documents,preparation,languages){
  if(!published)return null;
  if(!event)return {baseline:published.fingerprint,revision:published.revision,pending:true,changes:[]};
  const changes=publicationChanges(published.snapshot,draftPublication(event,documents,preparation,languages));
  return {baseline:published.fingerprint,revision:published.revision,pending:false,changes,counts:Object.fromEntries(['added','changed','removed'].map(k=>[k,changes.filter(c=>c.kind===k).length]))};
}

// Full old/new snapshots are already in the Pro input. UI labels and values in
// the per-field diff repeat them (translation keys can themselves be paragraphs).
export function reviewChanges(changes){
  const languages=new Map(),result=[];
  for(const change of changes){
    if(change.path.startsWith('translations.')){
      const path=change.path.split('.').slice(0,2).join('.');
      languages.set(path,(languages.get(path)??0)+1);
    }else result.push({path:change.path,kind:change.kind});
  }
  return [...result,...[...languages].map(([path,count])=>({path,kind:'changed',changedFields:count}))];
}
