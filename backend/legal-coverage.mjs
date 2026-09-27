import {z} from 'zod';
import {normalizeQuote} from './contract.mjs';
const reason=z.string().trim().min(10).max(2000);
const basis=z.array(z.object({documentId:z.string().min(1),quote:z.string().min(1)}).strict()).max(5).optional();
const outcome=z.enum(['mapped','insufficient-facts','no-catalog-match','no-suspect','not-applicable']);
export const legalCoverageSchema=z.object({
  status:z.enum(['mapped','partial','insufficient-facts','no-catalog-match','no-suspect','not-applicable']),
  reason,basis,
  participants:z.array(z.object({participantKey:z.string().min(1),status:outcome,reason,basis}).strict()).max(50),
}).strict();
export function validateLegalCoverage(raw,event,documents=[]){
  const coverage=legalCoverageSchema.parse(raw);
  for(const item of [coverage,...coverage.participants]){
    for(const evidence of item.basis??[]){
      if(!documents.some(d=>d.id===evidence.documentId&&normalizeQuote(d.text).includes(normalizeQuote(evidence.quote))))throw new Error('Legal coverage basis must quote a supplied source exactly');
    }
    if(item.status==='not-applicable'&&!(item.basis??[]).some(e=>documents.some(d=>d.id===e.documentId&&d.sourceKind==='official')))throw new Error('No legal consequences requires explicit official source evidence; otherwise use insufficient-facts');
  }
  const suspects=event.participants.filter(p=>['suspect','convicted'].includes(p.role));
  // A non-suspect disclaimer is bookkeeping, not a legal assessment. Keep the
  // overall explanation, but do not require the model to invent a suspect to
  // retain an "insufficient facts" row for a witness or other involved person.
  coverage.participants=coverage.participants.filter(item=>{
    const person=event.participants.find(p=>p.key===item.participantKey);
    return !(person&&!['suspect','convicted'].includes(person.role)&&['insufficient-facts','no-suspect'].includes(item.status)&&!event.legal.some(l=>l.participantKey===item.participantKey));
  });
  const keys=new Set(suspects.map(p=>p.key)),seen=new Set();
  for(const item of coverage.participants){
    if(!keys.has(item.participantKey)||seen.has(item.participantKey))throw new Error('Legal coverage must identify each suspect exactly once, without victims or unknown keys');
    seen.add(item.participantKey);
    const mapped=event.legal.some(l=>l.participantKey===item.participantKey);
    if((item.status==='mapped')!==mapped)throw new Error('Participant legal coverage disagrees with final legal assessments');
    if(item.status==='no-suspect')throw new Error('A present suspect cannot have no-suspect legal coverage');
  }
  if(seen.size!==keys.size)throw new Error('Legal coverage is required for EVERY suspect, including those with no assessment');
  const expected=event.legal.length?(coverage.participants.every(p=>p.status==='mapped')?'mapped':'partial'):null;
  if(expected?coverage.status!==expected:['mapped','partial'].includes(coverage.status))throw new Error('Legal coverage disagrees with final legal assessments');
  if(coverage.status==='no-suspect'&&keys.size)throw new Error('Cannot report no-suspect when suspects are present');
  return coverage;
}
