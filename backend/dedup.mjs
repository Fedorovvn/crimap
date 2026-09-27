import {z} from 'zod';
import {normalizePlace,districtNumber} from './geocode.mjs';
import {TYPES,normalizeQuote} from './contract.mjs';

const placeWords=s=>normalizePlace(s).split(' ').filter(w=>w.length>3&&!['budapest','district','kerulet','megallo','street','ter','utca','korut','hungary'].includes(w));
export function matchCandidates(event,rows){
  return rows.filter(row=>{
    if(row.merged_into||row.state==='excluded')return false;
    const old=row.canonical;
    if(event.caseReferences?.some(r=>old.caseReferences?.includes(r)))return true;
    const delta=Math.abs(Date.parse(event.occurredAt)-Date.parse(old.occurredAt));
    if(!Number.isFinite(delta)||delta>36*3600000)return false;
    const a=districtNumber(event.location.district),b=districtNumber(old.location.district);
    if(a&&b&&a!==b)return false;
    const words=placeWords(event.location.label),other=placeWords(old.location.label);
    if(words.some(w=>other.includes(w)))return true;
    const precise=x=>['exact','landmark'].includes(x.location.precision);
    if(precise(event)&&precise(old)&&Number.isFinite(event.location.latitude)&&Number.isFinite(old.location.latitude))return Math.hypot(event.location.latitude-old.location.latitude,(event.location.longitude-old.location.longitude)*.68)<.003;
    // City-only locations are never a match on their own. A narrow time and a
    // distinctive title overlap only nominate a pair for Flash, never auto-merge.
    const title=placeWords(event.title),oldTitle=placeWords(old.title);
    return delta<3*3600000&&title.filter(w=>oldTitle.includes(w)).length>=3;
  }).sort((a,b)=>Number(!!b.public_id)-Number(!!a.public_id)||Math.abs(Date.parse(event.occurredAt)-Date.parse(a.canonical.occurredAt))-Math.abs(Date.parse(event.occurredAt)-Date.parse(b.canonical.occurredAt))||a.id-b.id);
}
const identity=z.object({title:z.string(),summary:z.string(),type:z.enum(TYPES),occurredAt:z.string().datetime({offset:true}).nullable(),location:z.object({city:z.string(),label:z.string(),district:z.string().optional(),precision:z.enum(['exact','street','landmark','district','city','unknown'])}).strict(),caseReferences:z.array(z.string()),facts:z.array(z.object({fact:z.string(),quote:z.string()}).strict()).max(20)}).strict();
export async function identify(model,doc){
  return model.json('identify',{documentId:doc.id,title:doc.title,text:doc.text,publishedAt:doc.publishedAt},{maxTokens:2400,validate:raw=>{
    const r=z.object({incidents:z.array(identity).max(10)}).strict().parse(raw);
    for(const e of r.incidents)for(const f of e.facts)if(!normalizeQuote(doc.text).includes(normalizeQuote(f.quote)))throw new Error('Identity quote is not in original source');
    return r.incidents;
  }});
}
export async function compareBrief(model,incoming,candidates){
  // Check ignored identities first so an older visible duplicate cannot bypass
  // the editor's decision. Reasons are deliberately absent from the model input.
  const groups=[candidates.filter(e=>e.editorial_mark==='uninteresting'),candidates.filter(e=>e.editorial_mark!=='uninteresting')];
  for(const group of groups)for(let offset=0;offset<group.length;offset+=4){
    const shortlist=group.slice(offset,offset+4);
    const result=await model.json('compare',{incoming,candidates:shortlist.map(r=>({id:r.id,published:!!r.public_id,sourceKinds:r.sourceKinds,event:Object.fromEntries(Object.entries(r.canonical).filter(([key])=>!['evidence','media'].includes(key)))}))},{maxTokens:700,validate:raw=>{
      const r=z.object({decision:z.enum(['new','repeat','update']),eventId:z.number().int().optional(),reason:z.string()}).strict().parse(raw);
      if(r.decision!=='new'&&!shortlist.some(e=>e.id===r.eventId))throw new Error('Unknown duplicate candidate');
      return r;
    }});
    if(result.decision!=='new')return result;
  }
  return {decision:'new'};
}
