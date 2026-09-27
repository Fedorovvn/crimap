import {z} from 'zod';
import {translationStrings,applyTranslation} from './contract.mjs';
import {displayStrings} from './site-localization.mjs';

const numbers=s=>(s.match(/\d+(?:[.,]\d+)?/g)??[]).map(n=>n.replace(',','.')).sort().join('|');
export function protectTranslationNumbers(source){
  const tokens=[];
  // Distinct, nonnumeric markers prevent natural translations such as
  // "24-hour" -> "round-the-clock" from silently dropping required digits.
  const masked=source.replace(/\d+(?:[.,]\d+)?/g,value=>{
    let n=tokens.length,letters='';do{letters=String.fromCharCode(65+n%26)+letters;n=Math.floor(n/26)-1;}while(n>=0);
    const marker=`⟦NUM_${letters}⟧`;tokens.push({marker,value});return marker;
  });
  return {source:masked,restore(text){
    for(const {marker,value} of tokens){
      if(text.split(marker).length!==2)throw new Error(`Preserve numeric tokens: copy ${marker} exactly once, never spell it out, omit it or duplicate it`);
      text=text.replace(marker,value);
    }
    if(/⟦NUM_[A-Z]+⟧/.test(text)||numbers(text)!==numbers(source))throw new Error('Correction still changes numeric tokens; preserve all supplied markers and do not introduce extra digits');
    return text;
  }};
}
// Pro already edited the facts. Repair only the failing text fields, then run
// the complete evidence/identity/legal validator again before saving anything.
export async function correctFinalTranslations(raw,{event,russian,translations,preparation},model){
  if(raw.verdict!=='pass'||!raw.final)return raw;
  const out=structuredClone(raw),final=out.final,english=translationStrings(final.event??event);
  const before=translationStrings(event),oldRussian=translationStrings(russian);
  const ru=Object.fromEntries(Object.entries(english).map(([key,text])=>[key,final.russian?.[key]??(before[key]===text?oldRussian[key]:undefined)]));
  const repair=async(fields)=>{
    if(!fields.length)return {};
    const protectedFields=fields.map(field=>protectTranslationNumbers(field.source));
    const input=Object.fromEntries(fields.map((field,i)=>['s'+i,{language:field.language,source:protectedFields[i].source,reason:'Translate faithfully; copy every ⟦NUM_…⟧ marker exactly once. The server restores the original numbers.'}]));
    return model.json('review',{mode:'correct-translation-fields',fields:input},{maxTokens:16000,validate:value=>{
      const {strings}=z.object({strings:z.record(z.string().trim().min(1).max(12000))}).strict().parse(value);
      if(JSON.stringify(Object.keys(strings).sort())!==JSON.stringify(Object.keys(input).sort()))throw new Error('Return exactly one corrected string for each supplied field id');
      return Object.fromEntries(fields.map((_,i)=>['s'+i,protectedFields[i].restore(strings['s'+i])]));
    }});
  };
  const ruKeys=Object.keys(english).filter(k=>!ru[k]?.trim()||numbers(ru[k])!==numbers(english[k]));
  const fixedRussian=await repair(ruKeys.map(k=>({language:'ru',source:english[k],current:ru[k]??null,reason:'Missing translation or numeric mismatch; preserve meaning and numeric notation.'})));
  ruKeys.forEach((key,i)=>{ru[key]=fixedRussian['s'+i];});
  final.russian=ru; // Unknown/stale text paths have no destination in the contract.
  const translated=applyTranslation(final.event??event,{language:'ru',strings:ru});
  const texts=displayStrings({...translated,retainedMedia:preparation?.retainedMedia});
  const result={en:{},hu:{}},missing=[];
  for(const language of ['en','hu'])for(const text of texts){
    const value=final.siteTranslations?.[language]?.[text]??translations?.[language]?.[text];
    if(!value?.trim()||numbers(value)!==numbers(text))missing.push({language,source:text,current:value??null,reason:'Missing translation or numeric mismatch; preserve meaning and numeric notation.'});
    else result[language][text]=value;
  }
  const fixed=await repair(missing);
  missing.forEach((field,i)=>{result[field.language][field.source]=fixed['s'+i];});
  final.siteTranslations=result;
  return out;
}
