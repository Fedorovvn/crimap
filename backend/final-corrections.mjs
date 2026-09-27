import {z} from 'zod';
import {translationStrings,applyTranslation} from './contract.mjs';
import {displayStrings} from './site-localization.mjs';

const numbers=s=>(s.match(/\d+(?:[.,]\d+)?/g)??[]).map(n=>n.replace(',','.')).sort().join('|');
// Pro already edited the facts. Repair only the failing text fields, then run
// the complete evidence/identity/legal validator again before saving anything.
export async function correctFinalTranslations(raw,{event,russian,translations,preparation},model){
  if(raw.verdict!=='pass'||!raw.final)return raw;
  const out=structuredClone(raw),final=out.final,english=translationStrings(final.event??event);
  const before=translationStrings(event),oldRussian=translationStrings(russian);
  const ru=Object.fromEntries(Object.entries(english).map(([key,text])=>[key,final.russian?.[key]??(before[key]===text?oldRussian[key]:undefined)]));
  const repair=async(fields)=>{
    if(!fields.length)return {};
    const input=Object.fromEntries(fields.map((field,i)=>['s'+i,field]));
    return model.json('review',{mode:'correct-translation-fields',fields:input},{maxTokens:16000,validate:value=>{
      const {strings}=z.object({strings:z.record(z.string().trim().min(1).max(12000))}).strict().parse(value);
      if(JSON.stringify(Object.keys(strings).sort())!==JSON.stringify(Object.keys(input).sort()))throw new Error('Return exactly one corrected string for each supplied field id');
      for(const [key,text] of Object.entries(strings))if(numbers(text)!==numbers(input[key].source))throw new Error(`Correction ${key} still changes numeric tokens: expected [${numbers(input[key].source)}], received [${numbers(text)}]. Keep numeric notation from source exactly, including spaces, punctuation, Roman numerals and time format.`);
      return strings;
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
