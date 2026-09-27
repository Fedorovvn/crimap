import { z } from 'zod';
import { eventSchema, translationStrings, applyTranslation, normalizeQuote } from './contract.mjs';
import { reviewSchema, checkReview } from './review.mjs';
import { displayStrings, validateSiteTranslation } from './site-localization.mjs';
import { isDeepStrictEqual } from 'node:util';

const edits=z.record(z.string().trim().min(1).max(12000));
export const finalEditorSchema=reviewSchema.extend({final:z.object({
  event:eventSchema.optional(), russian:edits.default({}),
  siteTranslations:z.object({en:edits.default({}),hu:edits.default({})}).strict().default({en:{},hu:{}}),
}).strict().optional()}).strict();

// Excerpts stay verbatim; retain cited passages and neighbouring context. Source
// timestamps/identity are preserved, and validation still uses full originals.
export function sourceExcerpts(documents,event){
  const quotes=[];
  function walk(v){if(!v||typeof v!=='object')return;if(v.documentId&&v.quote)quotes.push(v);for(const x of Object.values(v))if(typeof x==='object')walk(x);}
  walk(event);
  const relevant=/kés|szúr|bántalmaz|vereked|rabl|lop|gyilk|meghalt|elhunyt|sérül|éves|gyanús|őrizet|letartóztat|vádemel|megálló|utca|körút|kerület|tűz|baleset|tegnap|hétfő|kedd|szerd|csütört|péntek|szombat|vasárnap|victim|suspect|injur|stab|detain|died|street|stop/iu;
  return documents.map(doc=>{
    const text=doc.text??'';
    if(text.length<=14000)return {...doc,excerpted:false};
    const paragraphs=text.match(/[^\n]+(?:\n+|$)/g)??[text],selected=new Set();
    const own=quotes.filter(q=>String(q.documentId)===String(doc.id));
    let cursor=0;const spans=paragraphs.map(p=>{const start=cursor;cursor+=p.length;return {start,end:cursor};});
    const add=i=>{for(let j=Math.max(0,i-1);j<=Math.min(paragraphs.length-1,i+1);j++)selected.add(j);};
    paragraphs.forEach((p,i)=>{if(i<4||own.some(q=>normalizeQuote(p).includes(normalizeQuote(q.quote))))add(i);});
    for(const q of own){const start=text.indexOf(q.quote);if(start>=0)spans.forEach((p,i)=>{if(p.start<start+q.quote.length&&p.end>start)add(i);});}
    let used=[...selected].reduce((n,i)=>n+paragraphs[i].length,0);
    for(let i=0;i<paragraphs.length&&used<18000;i++)if(!selected.has(i)&&relevant.test(paragraphs[i])){add(i);used=[...selected].reduce((n,j)=>n+paragraphs[j].length,0);}
    const ordered=[...selected].sort((a,b)=>a-b);
    return {...doc,excerpted:ordered.length<paragraphs.length,text:ordered.map((i,n)=>(n&&i>ordered[n-1]+1?'\n[... omitted unrelated paragraphs ...]\n':'')+paragraphs[i]).join('')};
  });
}

// The editor sends only changed text, but must supply translations for every
// changed/new English field. Stale translations never silently survive an edit.
export function assembleFinal(raw,{event,russian,translations,preparation,documents,locationLookup,validateEvent}){
  const parsed=finalEditorSchema.parse(raw),{final,...review}=parsed;
  checkReview(review,documents,{english:event,russian,translations,locationLookup});
  if(review.verdict!=='pass')return {review};
  if(!final)throw new Error('A passed review must include final; use final:{} when all supplied drafts are correct');
  const corrected=validateEvent(structuredClone(final.event??event));
  if(!isDeepStrictEqual(corrected.location,event.location))throw new Error('Use locationResolution for map changes; final.event.location must retain the supplied verified location');
  const oldEnglish=translationStrings(event),oldRussian=translationStrings(russian),english=translationStrings(corrected),ru={};
  for(const key of Object.keys(final.russian))if(!(key in english))throw new Error(`Unknown final Russian field: ${key}`);
  for(const [key,value] of Object.entries(english)){
    ru[key]=final.russian[key]??(oldEnglish[key]===value?oldRussian[key]:undefined);
    if(!ru[key])throw new Error(`Final Russian translation required for changed English field: ${key}`);
  }
  const correctedRussian=applyTranslation(corrected,{language:'ru',strings:ru});
  const texts=displayStrings({...correctedRussian,retainedMedia:preparation?.retainedMedia}),localized={};
  for(const language of ['en','hu']){
    for(const key of Object.keys(final.siteTranslations[language]))if(!texts.includes(key))throw new Error(`Unknown final ${language} display text: ${key}`);
    const strings=Object.fromEntries(texts.map(text=>[text,final.siteTranslations[language][text]??translations?.[language]?.[text]]));
    localized[language]=validateSiteTranslation({language,strings},language,Object.fromEntries(texts.map(t=>[t,t]))).strings;
  }
  return {review:{...review,finalized:true},event:corrected,russian:correctedRussian,translations:localized};
}
