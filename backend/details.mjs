import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {eventSchema,evidenceSchema,fieldRequestSchema} from './contract.mjs';
import {hash} from './store.mjs';

const fields=eventSchema.innerType().shape;
export const detailsSchema=z.object({
  participants:fields.participants,context:fields.context,legal:fields.legal,
  evidence:z.array(evidenceSchema).max(150),
  coverage:z.object({participants:z.string().min(1).max(3000),legal:z.enum(['mapped','no-reported-qualification','no-catalog-match','no-suspect']),reason:z.string().min(1).max(3000)}).strict(),
  requests:z.array(fieldRequestSchema).max(10).default([]),
}).strict();
const detailPath=path=>/^(participants|context|legal)(\.|$)/.test(path);
export function detailFingerprint(event,documents,laws){return hash({version:1,title:event.title,summary:event.summary,type:event.type,participants:event.participants,context:event.context,legal:event.legal,documents:documents.map(d=>({id:d.id,hash:d.contentHash??hash(d.text)})),laws});}
export function validateLegalLinks(event){
  for(const law of event.legal){const p=event.participants.find(p=>p.key===law.participantKey);if(!p||!['suspect','convicted'].includes(p.role))throw new Error('Legal assessment must reference its supported suspect/convicted participantKey; never attach a charge to a victim or all suspects indiscriminately');
    if(p.profile.kind==='person'&&(p.profile.age!==undefined?p.profile.age<18:p.profile.ageGroup==='child'))throw new Error('Adult catalog sanctions cannot be assigned to a minor; request a verified juvenile-law mapping');
  }
}
export async function completeDetails(model,event,documents,laws,validate){
  const raw=await model.json('details',{schema:zodToJsonSchema(detailsSchema),event,documents,verifiedLawCatalog:laws},{maxTokens:10000,validate:raw=>{
    const result=detailsSchema.parse(raw);
    if(result.evidence.some(e=>!detailPath(e.field)))throw new Error('Detail completion evidence may only reference participants, context or legal');
    const combined={...structuredClone(event),participants:result.participants,context:result.context,legal:result.legal,evidence:[...event.evidence.filter(e=>!detailPath(e.field)),...result.evidence]};
    validateLegalLinks(combined);
    if((result.coverage.legal==='mapped')!==Boolean(combined.legal.length))throw new Error('Legal coverage must agree with mapped assessments');
    const checked=validate(combined,documents);
    return {...result,participants:checked.participants,context:checked.context,legal:checked.legal,evidence:checked.evidence.filter(e=>detailPath(e.field))};
  }});
  const result=detailsSchema.parse(raw);
  const completed=validate({...structuredClone(event),participants:result.participants,context:result.context,legal:result.legal,evidence:[...event.evidence.filter(e=>!detailPath(e.field)),...result.evidence]},documents);
  return {event:completed,coverage:result.coverage,requests:result.requests,fingerprint:detailFingerprint(completed,documents,laws)};
}
