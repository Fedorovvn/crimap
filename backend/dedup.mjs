import {z} from 'zod';
import {normalizePlace,districtNumber} from './geocode.mjs';
import {TYPES,normalizeQuote} from './contract.mjs';

const placeWords=s=>normalizePlace(s).split(' ').filter(w=>w.length>3&&!['budapest','district','kerulet','megallo','street','ter','utca','korut','hungary','intersection','corner','junction','sarka','sarok','keresztezodese'].includes(w));
export function matchCandidates(event,rows){
  return rows.filter(row=>{
    if(row.merged_into||row.state==='excluded')return false;
    const old=row.canonical;
    if(event.caseReferences?.some(r=>old.caseReferences?.includes(r)))return true;
    const delta=Math.abs(Date.parse(event.occurredAt)-Date.parse(old.occurredAt));
    const words=placeWords(event.location.label),other=placeWords(old.location.label);
    const sameScene=new Set(words.filter(w=>other.includes(w))).size>=2;
    // District and inferred year can be extraction mistakes (workplace district,
    // retrospective article). A distinctive intersection nominates for Flash;
    // it never establishes identity or changes a date by itself.
    const yearConflict=event.occurredAt&&old.occurredAt&&event.occurredAt.slice(5,10)===old.occurredAt.slice(5,10)&&Math.abs(Number(event.occurredAt.slice(0,4))-Number(old.occurredAt.slice(0,4)))===1;
    if(sameScene&&(!Number.isFinite(delta)||delta<=36*3600000||yearConflict))return true;
    if(Number.isFinite(delta)&&delta>36*3600000)return false;
    const a=districtNumber(event.location.district),b=districtNumber(old.location.district);
    if(a&&b&&a!==b)return false;
    if(!Number.isFinite(delta))return words.some(w=>other.includes(w))&&placeWords(event.title).filter(w=>placeWords(old.title).includes(w)).length>=3;
    if(words.some(w=>other.includes(w)))return true;
    const precise=x=>['exact','landmark'].includes(x.location.precision);
    if(precise(event)&&precise(old)&&Number.isFinite(event.location.latitude)&&Number.isFinite(old.location.latitude))return Math.hypot(event.location.latitude-old.location.latitude,(event.location.longitude-old.location.longitude)*.68)<.003;
    // City-only locations are never a match on their own. A narrow time and a
    // distinctive title overlap only nominate a pair for Flash, never auto-merge.
    const title=placeWords(event.title),oldTitle=placeWords(old.title);
    return delta<3*3600000&&title.filter(w=>oldTitle.includes(w)).length>=3;
  }).sort((a,b)=>Number(!!b.public_id)-Number(!!a.public_id)||Math.abs(Date.parse(event.occurredAt)-Date.parse(a.canonical.occurredAt))-Math.abs(Date.parse(event.occurredAt)-Date.parse(b.canonical.occurredAt))||a.id-b.id);
}
const identity=z.object({title:z.string(),summary:z.string(),type:z.enum(TYPES),occurredAt:z.string().datetime({offset:true}).nullable(),location:z.object({city:z.string(),label:z.string(),district:z.string().nullish().transform(value=>value??undefined),precision:z.enum(['exact','street','landmark','district','city','unknown'])}).strict(),caseReferences:z.array(z.string()),facts:z.array(z.object({fact:z.string(),quote:z.string()}).strict()).max(20)}).strict();
export function comparisonCard(e){
  return {title:e.title,summary:e.summary,type:e.type,status:e.status,occurredAt:e.occurredAt,timePrecision:e.timePrecision,location:e.location,caseReferences:e.caseReferences,signals:e.signals,facts:e.facts,
    participants:e.participants?.map(p=>({key:p.key,role:p.role,status:p.status,profile:p.profile,note:p.note})),
    context:e.context?.map(c=>({text:c.text,verification:c.verification})),
    legal:e.legal?.map(l=>({participantKey:l.participantKey,offense:l.offense,qualification:l.qualification})),
    updates:e.updates?.map(u=>({title:u.title,detail:u.detail,publishedAt:u.publishedAt})),
    identityEvidence:e.evidence?.filter(q=>/^(occurredAt|timePrecision|location|summary|participants\.)/.test(q.field)).slice(0,12).map(q=>({field:q.field,quote:q.quote.slice(0,900)})),
    sourceKind:e.sourceKind,sourceUrl:e.sourceUrl};
}
export async function identify(model,doc){
  return model.json('identify',{documentId:doc.id,title:doc.title,text:doc.text,publishedAt:doc.publishedAt},{maxTokens:2400,validate:raw=>{
    const r=z.object({incidents:z.array(identity).max(10)}).strict().parse(raw);
    for(const e of r.incidents)for(const f of e.facts)if(!normalizeQuote(doc.text).includes(normalizeQuote(f.quote)))throw new Error('Identity quote is not in original source');
    return r.incidents;
  }});
}
export async function compareBrief(model,incoming,candidates){
  // Topic/editorial exclusions win, but a duplicate-only rejection must not
  // swallow updates belonging to the retained active event. No reason text is
  // sent to the model or generalized to other incidents.
  const duplicateOnly=e=>{try{const reasons=JSON.parse(e.editorial_reasons??'[]');return reasons.length===1&&reasons[0]==='duplicate';}catch{return false;}};
  const ignored=e=>e.editorial_mark==='uninteresting';
  const groups=[candidates.filter(e=>ignored(e)&&!duplicateOnly(e)),candidates.filter(e=>!ignored(e)),candidates.filter(e=>ignored(e)&&duplicateOnly(e))];
  for(const group of groups)for(let offset=0;offset<group.length;offset+=4){
    const shortlist=group.slice(offset,offset+4);
    const result=await model.json('compare',{incoming:comparisonCard(incoming),candidates:shortlist.map(r=>({id:r.id,published:!!r.public_id,sourceKinds:r.sourceKinds,event:comparisonCard(r.canonical)}))},{maxTokens:700,validate:raw=>{
      const r=z.object({decision:z.enum(['new','repeat','update']),eventId:z.number().int().nullable().optional(),reason:z.string()}).strict().parse(raw);
      if(r.decision!=='new'&&!shortlist.some(e=>e.id===r.eventId))throw new Error('Unknown duplicate candidate');
      return r;
    }});
    if(result.decision!=='new')return result;
  }
  return {decision:'new'};
}
