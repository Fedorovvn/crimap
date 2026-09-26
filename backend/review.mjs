import { z } from 'zod';
import { mkdirSync,writeFileSync,renameSync } from 'node:fs';
import { dirname,join } from 'node:path';
import { hash } from './store.mjs';
import { normalizeQuote,fieldRequestSchema } from './contract.mjs';
const short=z.string().trim().min(1).max(2000);
export const reviewSchema=z.object({verdict:z.enum(['pass','revise','reject']),summary:short,issues:z.array(z.object({severity:z.enum(['error','warning']),field:short,reason:short,documentId:z.string().optional(),quote:short.optional(),quoteOrigin:z.enum(['source','english','russian']).optional()}).strict()).max(30),requests:z.array(fieldRequestSchema).max(10)}).strict();
export function checkReview(raw,documents,{english,russian}={}){
  const result=reviewSchema.parse(raw);
  if(result.verdict==='pass'&&result.issues.some(i=>i.severity==='error'))throw new Error('Review cannot pass with factual errors');
  for(const item of [...result.issues,...result.requests]){
    if(item.documentId&&!documents.some(d=>d.id===item.documentId))throw new Error('Review cites an unknown document');
    if(item.quote){
      const sourceMatch=item.documentId&&documents.some(d=>d.id===item.documentId&&normalizeQuote(d.text).includes(normalizeQuote(item.quote)));
      if(sourceMatch){if(result.issues.includes(item))item.quoteOrigin='source';}
      else if(result.issues.includes(item)&&russian&&normalizeQuote(JSON.stringify(russian)).includes(normalizeQuote(item.quote))){item.quoteOrigin='russian';delete item.documentId;}
      else if(result.issues.includes(item)&&english&&normalizeQuote(JSON.stringify(english)).includes(normalizeQuote(item.quote))){item.quoteOrigin='english';delete item.documentId;}
      else throw new Error('Review quotation is not in the original source or supplied editorial text; omit it if it is a paraphrase');
    }
  }return result;
}
export function recordRequests(store,requests,{eventId,revision,model}){
  for(const item of requests){
    const key=hash({kind:item.kind,key:item.proposedKey});
    store.db.prepare('INSERT OR IGNORE INTO field_requests(request_key,event_id,revision,model,payload,created_at) VALUES(?,?,?,?,?,?)').run(key,eventId,revision,model,JSON.stringify(item),new Date().toISOString());
  }
  return exportRequests(store);
}
export function exportRequests(store){
  const directory=store.path===':memory:'?null:dirname(store.path);if(!directory)return null;
  const rows=store.db.prepare('SELECT * FROM field_requests ORDER BY created_at,request_key').all();
  const clean=s=>String(s).replace(/[\r\n]+/g,' ').replace(/[<>]/g,'').replace(/([\\`*_\[\]])/g,'\\$1');
  const body=['# Предложения моделей по развитию контракта','', 'Это предложения, а не действующие поля сайта. Изменения требуют отдельного решения.',''];
  for(const row of rows){const r=JSON.parse(row.payload);body.push(`## ${clean(r.label)}`,`- Тип: ${r.kind}; ключ: ${clean(r.proposedKey)}; статус: ${row.status}`,`- Зачем: ${clean(r.reason)}`,`- Пример: ${clean(r.example)}`,`- Событие: ${row.event_id}, редакция ${row.revision}; модель: ${row.model}`,`- Документ: ${r.documentId??'не указан'}; цитата: ${clean(r.quote??'не требуется')}`,'');}
  if(!rows.length)body.push('Предложений пока нет.');
  mkdirSync(directory,{recursive:true});const file=join(directory,'field-requests.md');
  writeFileSync(file+'.tmp',body.join('\n')+'\n');renameSync(file+'.tmp',file);
  const json=join(directory,'field-requests.json');writeFileSync(json+'.tmp',JSON.stringify(rows.map(r=>({...r,payload:JSON.parse(r.payload)})),null,2)+'\n');renameSync(json+'.tmp',json);return file;
}
