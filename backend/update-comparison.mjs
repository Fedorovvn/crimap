import { z } from 'zod';
import { hash } from './store.mjs';
import { draftPublication, publicationChanges } from './publication-comparison.mjs';

const resultSchema=z.object({decision:z.enum(['unchanged','changed','uncertain']),confidence:z.number().min(0).max(1),reason:z.string().min(1).max(1500)}).strict();
const numbers=text=>JSON.stringify((String(text).match(/\d+(?:[.,]\d+)?/g)??[]).map(n=>n.replace(',','.')).sort());
function comparable(snapshot){
  const en=snapshot.translations?.en??{};
  const textFields=new Set(['title','summary','text','note','detail','description','label','caption','offense','rationale','condition','subjectLabel','sourceLabel','district']);
  const visit=(value,field)=>Array.isArray(value)?value.map(v=>visit(v,field)):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).filter(([key])=>!['translations','sources','reviewStatus','evidence','asOf'].includes(key)).map(([key,v])=>[key,visit(v,key)]))
    :typeof value==='string'&&textFields.has(field)?(en[value]??value):value;
  return visit(snapshot);
}
export function updateInput(event,documents,preparation,published){
  const before=comparable(published.snapshot),after=comparable(draftPublication(event.canonical,documents,preparation,null));
  return {before,after,changes:publicationChanges(before,after)};
}
// Only equivalent prose can be discarded. Status, coordinates, people, legal
// sanctions, photographs and numeric corrections always reach the final editor.
export function protectedChange(change){
  return change.kind!=='changed'||typeof change.before!=='string'||typeof change.after!=='string'
    ||!/(^|\.)(title|summary|text|note|detail|description|label|caption|offense|rationale|condition)$/.test(change.path)
    ||/^(legal|media)\./.test(change.path)||numbers(change.before)!==numbers(change.after);
}
export function currentUpdateAssessment(store,event,published){
  if(!published)return null;
  const row=store.db.prepare("SELECT id,detail FROM audit WHERE action='publication-update-compared' AND subject=? ORDER BY id DESC LIMIT 1").get(String(event.id));
  if(!row)return null;
  const result=JSON.parse(row.detail);
  const prep=store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision=?').get(event.id,event.revision)?.payload??null;
  const retry=store.db.prepare("SELECT id FROM audit WHERE (action='editorial-retry' OR (action='editorial-queue' AND json_extract(detail,'$.action')='review')) AND subject=? ORDER BY id DESC LIMIT 1").get(String(event.id));
  return result.revision===event.revision&&result.baseline===published.fingerprint&&result.preparationHash===hash(prep)&&(!retry||retry.id<row.id)?result:null;
}
export async function comparePublicationUpdate(model,event,documents,preparation,published){
  const input=updateInput(event,documents,preparation,published);
  if(!input.changes.length)return {decision:'unchanged',confidence:1,reason:'Новых сведений по сравнению с публикацией нет.',skip:true,method:'rules'};
  const result=await model.json('update-compare',input,{maxTokens:1400,validate:raw=>resultSchema.parse(raw)});
  const protectedChanges=input.changes.filter(protectedChange);
  const skip=result.decision==='unchanged'&&result.confidence>=0.95&&!protectedChanges.length;
  return {...result,skip,method:'flash',protectedFields:protectedChanges.map(c=>c.path),...(!skip&&result.decision==='unchanged'?{reason:`Нужна финальная проверка: ${protectedChanges.length?'изменились значимые поля':'Flash недостаточно уверена'}. ${result.reason}`}:{})};
}
