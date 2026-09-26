import { z } from 'zod';
import { legalAssessmentSchema } from '../app/legal-model.ts';

export const CONTRACT_VERSION = '2.0';
const text = z.string().trim().min(1).max(12000);
const url = z.string().url().refine(x => /^https?:\/\//.test(x));
const date = z.string().datetime({ offset: true });
const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/);
export const TYPES = ['traffic-accident','assault','fight','robbery','accident','fire','rescue','missing-person','transport-disruption','weather','other'];
export const SIGNALS = ['death','injury','suspect-detained','suspect-wanted'];
export const STATUSES = ['detained','wanted','in-custody','charged','convicted','released','deceased','injured','unknown'];
const person = z.object({kind:z.literal('person'),name:text.optional(),gender:z.enum(['male','female']).optional(),age:z.number().int().min(0).max(120).optional(),ageGroup:z.enum(['child','adult','older']).optional(),citizenship:z.object({code:z.string().regex(/^[A-Z]{2}$/),name:text}).strict().optional()}).strict();
const group = z.object({kind:z.literal('group'),count:z.number().int().min(1).optional(),gender:z.enum(['male','female']).optional(),leader:z.object({person,status:z.enum(STATUSES),sourceUrl:url}).strict().optional()}).strict();
export const participantSchema = z.object({key,role:z.enum(['suspect','victim','convicted','involved']),label:text,status:z.enum(STATUSES),profile:z.discriminatedUnion('kind',[person,group]),note:text.optional(),wantedNotice:z.object({description:text,sourceUrl:url.optional(),isDemo:z.literal(false).optional()}).strict().optional(),sourceUrl:url,sourceLabel:text,asOf:date}).strict();
const context = z.object({key,subject:z.union([z.object({kind:z.literal('event')}).strict(),z.object({kind:z.literal('participant'),participantKey:key}).strict()]),topic:z.enum(['motive','circumstances','citizenship','occupation','visitor-status','housing-status','appearance']),text,origin:z.enum(['source','model']),verification:z.enum(['unverified','corroborated','disputed','retracted']),reviewStatus:z.enum(['pending','approved']),evidence:z.array(z.object({kind:z.enum(['official','media','eyewitness','social']),label:text,url,attribution:text.optional(),relation:z.enum(['supports','disputes','background'])}).strict()).min(1),asOf:date,rationale:text.optional()}).strict();
export const evidenceSchema = z.object({field:text,documentId:text,quote:text,attribution:text.optional()}).strict();
export const eventSchema = z.object({
  title:text,summary:text,type:z.enum(TYPES),status:z.enum(['reported','investigating','suspects-detained','wanted','resolved','closed','unknown']),
  occurredAt:date.nullable(),timePrecision:z.enum(['exact','hour','day','unknown']),
  location:z.object({city:text,district:text.optional(),label:text,precision:z.enum(['exact','street','district','city','unknown']),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional()}).strict(),
  signals:z.array(z.enum(SIGNALS)),caseReferences:z.array(text),
  participants:z.array(participantSchema).max(50),context:z.array(context).max(40),legal:z.array(legalAssessmentSchema).max(20),
  updates:z.array(z.object({key,publishedAt:date,title:text,detail:text,sourceUrl:url}).strict()).max(50),
  media:z.array(z.object({imageUrl:url,sourceUrl:url,outlet:text,credit:text,caption:text,isSensitive:z.boolean(),rights:z.enum(['unknown','link-only','licensed','permission','public-domain'])}).strict()).max(20),
  evidence:z.array(evidenceSchema).min(1).max(150),
}).strict().superRefine((event,ctx)=>{
  const keys=new Set();
  for(const p of event.participants){if(keys.has(p.key))ctx.addIssue({code:'custom',message:'Duplicate participant key'});keys.add(p.key);}
  for(const c of event.context){
    if(c.subject.kind==='participant'&&!keys.has(c.subject.participantKey))ctx.addIssue({code:'custom',message:'Unknown context participant'});
    if(c.origin==='model'&&(c.subject.kind!=='event'||c.topic!=='circumstances'||c.verification==='corroborated'||!c.rationale))ctx.addIssue({code:'custom',message:'Model hypotheses may only concern event circumstances, with rationale'});
  }
  for(const l of event.legal)if(l.participantKey&&!keys.has(l.participantKey))ctx.addIssue({code:'custom',message:'Unknown legal participant'});
  if(event.occurredAt===null&&event.timePrecision!=='unknown')ctx.addIssue({code:'custom',message:'Unknown occurrence time requires unknown precision'});
  if((event.location.latitude===undefined)!==(event.location.longitude===undefined))ctx.addIssue({code:'custom',message:'Coordinates must be a pair'});
});
export const fieldRequestSchema=z.object({kind:z.enum(['field','incident-type','participant-status','source-type','display']),proposedKey:z.string().regex(/^[a-z][a-z0-9_.-]{0,99}$/),label:text,reason:text,example:text,documentId:z.string().optional(),quote:text.optional()}).strict();
export const extractionSchema=z.object({schemaVersion:z.literal(CONTRACT_VERSION),events:z.array(eventSchema).max(10),irrelevantReason:z.string().max(2000).optional(),requests:z.array(fieldRequestSchema).max(10).default([])}).strict();
export const translationSchema=z.object({language:z.literal('ru'),strings:z.record(z.string().max(12000))}).strict();

export function normalizeQuote(text){return text.normalize('NFKC').replace(/\s+/g,' ').trim();}
export function validateEvidence(event,documents){
  const urls=new Set(documents.map(d=>d.url));
  for(const e of event.evidence){
    const matching=documents.filter(d=>String(d.id)===e.documentId);
    const supported=matching.some(doc=>normalizeQuote(doc.text).includes(normalizeQuote(e.quote))||e.field.startsWith('media.')&&doc.imageUrls.includes(e.quote.trim()));
    if(!supported)throw new Error(`Unverifiable quotation for ${e.field}: quote must be exact source text, or an observed image URL for media; omit optional unsupported media`);
  }
  const required=['title','summary','type','location','status'];
  if(event.signals.length)required.push('signals');
  for(const list of ['participants','updates','context','legal'])event[list].forEach((_,i)=>required.push(`${list}.${i}`));
  event.participants.forEach((p,i)=>{required.push(`participants.${i}.status`);if(p.profile.kind==='person')for(const k of ['name','age','gender','citizenship'])if(p.profile[k]!==undefined)required.push(`participants.${i}.profile.${k}`);});
  for(const field of required)if(!event.evidence.some(e=>e.field===field||e.field.startsWith(field+'.')))throw new Error(`Missing evidence: ${field}`);
  if(event.occurredAt&&!event.evidence.some(e=>e.field==='occurredAt'))throw new Error('Missing occurrence-time evidence');
  for(let i=0;i<event.participants.length;i++)if(!event.evidence.some(e=>e.field===`participants.${i}`||e.field.startsWith(`participants.${i}.`)))throw new Error('Participant needs evidence');
  const references=[...event.participants.flatMap(p=>[p.sourceUrl,...(p.wantedNotice?.sourceUrl?[p.wantedNotice.sourceUrl]:[]),...(p.profile.kind==='group'&&p.profile.leader?[p.profile.leader.sourceUrl]:[])]),...event.updates.map(u=>u.sourceUrl),...event.media.map(m=>m.sourceUrl),...event.context.flatMap(c=>c.evidence.map(e=>e.url)),...event.legal.map(l=>l.source.url)];
  if(references.some(u=>!urls.has(u)))throw new Error('Reference was not read by the collector');
  for(const p of event.participants)if(p.wantedNotice&&p.status!=='wanted')throw new Error('Wanted notice requires current wanted status');
  // Source classification is owned by the registry, never by model output.
  for(const claim of event.context)for(const e of claim.evidence){const d=documents.find(d=>d.url===e.url);e.kind=d.sourceKind==='official'?'official':d.sourceKind==='media'?'media':'social';}
  event.context.forEach(c=>{c.reviewStatus='pending';});
  event.legal.forEach(l=>{l.reviewStatus='pending';const d=documents.find(d=>d.url===l.source.url);if(l.qualification==='official'&&d.sourceKind!=='official')throw new Error('Nonofficial legal attribution');});
  return event;
}

const translatable=new Set(['title','summary','label','note','description','offense','subjectLabel','condition','text','detail','caption','locationLabel']);
export function translationStrings(event){
  const result={};
  function walk(value,path=[]){
    if(typeof value==='string'&&translatable.has(path.at(-1))&&!path.includes('evidence')&&!path.includes('caseReferences')&&!path.includes('statutes'))result[path.join('.')]=value;
    else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))walk(v,[...path,k]);
  }
  walk(event);return result;
}
export function applyTranslation(event,payload){
  const {strings}=translationSchema.parse(payload), expected=translationStrings(event);
  if(JSON.stringify(Object.keys(strings).sort())!==JSON.stringify(Object.keys(expected).sort()))throw new Error('Translation paths do not match');
  const copy=structuredClone(event);
  for(const [path,value] of Object.entries(strings)){
    const numbers=s=>(s.match(/\d+(?:[.,]\d+)?/g)??[]).map(x=>x.replace(',','.')).sort().join('|');
    if(!value.trim()||numbers(value)!==numbers(expected[path]))throw new Error(`Translation changed numbers at ${path}`);
    const parts=path.split('.');let parent=copy;for(const part of parts.slice(0,-1))parent=parent[part];parent[parts.at(-1)]=value;
  }
  return eventSchema.parse(copy);
}
