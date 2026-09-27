import {z} from 'zod';
import {normalizeQuote} from './contract.mjs';

export const dateResolutionSchema=z.object({
  occurredAt:z.string().datetime({offset:true}).nullable(),
  timePrecision:z.enum(['exact','hour','day','unknown']),
  documentId:z.string().nullable(),quote:z.string(),reason:z.string().min(1).max(1000),
}).strict();
export function validateResolvedDate(raw,documents,now=Date.now()){
  const result=dateResolutionSchema.parse(raw);
  if(!result.occurredAt){if(result.timePrecision!=='unknown')throw new Error('Unknown date requires unknown precision');return result;}
  if(result.timePrecision==='unknown'||Date.parse(result.occurredAt)>now)throw new Error('The incident date must be in the past with supported precision');
  const document=documents.find(d=>String(d.id)===result.documentId);
  if(!document||!result.quote.trim()||!normalizeQuote(document.text).includes(normalizeQuote(result.quote)))throw new Error('Occurrence date must cite an exact source passage');
  return result;
}
