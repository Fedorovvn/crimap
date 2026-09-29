import {z} from 'zod';
import {normalizePlace,districtNumber} from './geocode.mjs';
import {TYPES,normalizeQuote} from './contract.mjs';
import {hash} from './store.mjs';

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
  // Keep the entire source, including corrections in the middle. References
  // avoid paying for copied quotations and cannot fabricate source text.
  const paragraphs=sourceParagraphs(doc.text);
  const fact=z.object({fact:z.string().max(180),paragraphIds:z.array(z.number().int().positive()).min(1).max(3)}).strict();
  const compact=identity.extend({title:z.string().max(180),summary:z.string().max(500),facts:z.array(fact).max(6)});
  for(const expanded of [false,true]){
    try{
      const result=await model.json('identify',{documentId:doc.id,title:doc.title,paragraphs,publishedAt:doc.publishedAt,maxIncidents:expanded?10:3,mode:expanded?'expanded':'compact'},{maxTokens:expanded?7500:3200,validate:raw=>{
        // Legacy exact quotes remain valid for stored fixtures/integrations;
        // the production prompt requests only numeric paragraph references.
        const r=z.object({incidents:z.array(z.union([compact,identity])).max(expanded?10:3),overflow:z.boolean().default(false)}).strict().parse(raw);
        r.incidents=r.incidents.map(e=>({...e,facts:e.facts.flatMap(f=>{
          if(f.paragraphIds){
            const selected=f.paragraphIds.map(id=>paragraphs.find(p=>p.id===id));
            if(selected.some(p=>!p))throw new Error('Unknown identity source paragraph');
            return selected.map(p=>({fact:f.fact,quote:p.text}));
          }
          if(!normalizeQuote(doc.text).includes(normalizeQuote(f.quote)))throw new Error('Identity quote is not in original source');
          return f;
        })}));
        return r;
      }});
      if(!result.overflow)return result.incidents;
      if(expanded)throw new Error('Source has too many incidents; split source before processing');
    }catch(error){
      if(expanded||!/^Model response incomplete \(length/.test(error.message))throw error;
    }
  }
}
export function sourceParagraphs(text){
  const parts=String(text??'').split(/\n+/).filter(p=>p.trim());
  return parts.flatMap(p=>{const chunks=[];for(let i=0;i<p.length;i+=900)chunks.push(p.slice(i,i+900));return chunks;}).map((text,i)=>({id:i+1,text}));
}

export function compactComparisonCard(e){
  return {title:e.title,summary:e.summary,type:e.type,occurredAt:e.occurredAt,timePrecision:e.timePrecision,
    location:e.location,caseReferences:e.caseReferences,signals:e.signals,
    facts:e.facts?.map(f=>({fact:f.fact})),
    people:e.participants?.map(p=>({role:p.role,status:p.status,name:p.profile?.name,age:p.profile?.age})),
    sourceKind:e.sourceKind};
}
export const comparisonFingerprint=(incoming,candidates)=>hash({incoming,candidates:candidates.map(r=>({id:r.id,revision:r.revision,canonical:r.canonical,mark:r.editorial_mark,reasons:r.editorial_reasons,sourceKinds:r.sourceKinds}))});
export function provisionalEvent(brief,doc){
  const quote=brief.facts.find(f=>normalizeQuote(doc.text).includes(normalizeQuote(f.quote)))?.quote??doc.title;
  if(!normalizeQuote(doc.text).includes(normalizeQuote(quote)))throw new Error('Undated identity needs a source quotation');
  return {
    title:brief.title,summary:brief.summary,type:brief.type,status:'reported',occurredAt:null,timePrecision:'unknown',location:brief.location,
    signals:[],caseReferences:brief.caseReferences,participants:[],context:[],legal:[],updates:[],media:[],
    evidence:['title','summary','type','location','status'].map(field=>({field,documentId:String(doc.id),quote}))
  };
}
export async function compareBrief(model,incoming,candidates,{document}={}){
  // Topic/editorial exclusions win, but a duplicate-only rejection must not
  // swallow updates belonging to the retained active event. No reason text is
  // sent to the model or generalized to other incidents.
  const duplicateOnly=e=>{try{const reasons=JSON.parse(e.editorial_reasons??'[]');return reasons.length===1&&reasons[0]==='duplicate';}catch{return false;}};
  const ignored=e=>e.editorial_mark==='uninteresting';
  const groups=[candidates.filter(e=>ignored(e)&&!duplicateOnly(e)),candidates.filter(e=>!ignored(e)),candidates.filter(e=>ignored(e)&&duplicateOnly(e))];
  for(const group of groups)for(let offset=0;offset<group.length;offset+=4){
    const shortlist=group.slice(offset,offset+4);
    const full={mode:'facts',incoming:comparisonCard(incoming),candidates:shortlist.map(r=>({id:r.id,published:!!r.public_id,sourceKinds:r.sourceKinds,event:comparisonCard(r.canonical)}))};
    // Small comparisons already cost less than two calls. Large ones first
    // eliminate clearly different incidents; no candidate is dropped by a cap.
    const compact={mode:'identity-only',incoming:compactComparisonCard(incoming),candidates:shortlist.map(r=>({id:r.id,event:compactComparisonCard(r.canonical)}))};
    if(JSON.stringify(full).length>6000&&JSON.stringify(compact).length<JSON.stringify(full).length*.65){
      const screened=await model.json('compare',compact,{maxTokens:300,validate:raw=>{
        const r=z.object({decision:z.enum(['new','match','uncertain']),eventId:z.number().int().nullable().optional(),confidence:z.number().min(0).max(1),reason:z.string().max(500)}).strict().parse(raw);
        if(r.decision==='match'&&!shortlist.some(e=>e.id===r.eventId))throw new Error('Unknown duplicate candidate');
        return r;
      }});
      // This is only an identity screen. Even a confident match still gets
      // complete facts: a small sketch must never suppress a real update.
      const dated=incoming.occurredAt&&shortlist.every(r=>r.canonical.occurredAt);
      if(screened.decision==='new'&&screened.confidence>=.98&&dated)continue;
    }
    if(document)full.sourceDocument={id:document.id,title:document.title,text:document.text,publishedAt:document.publishedAt};
    const result=await model.json('compare',full,{maxTokens:700,validate:raw=>{
      const r=z.object({decision:z.enum(['new','repeat','update']),eventId:z.number().int().nullable().optional(),reason:z.string()}).strict().parse(raw);
      if(r.decision!=='new'&&!shortlist.some(e=>e.id===r.eventId))throw new Error('Unknown duplicate candidate');
      return r;
    }});
    if(result.decision!=='new')return result;
  }
  return {decision:'new'};
}
