import { z } from 'zod';
import { normalizeSignal as norm, positiveSignals } from './triage-signals.mjs';
const routine=/forgalomkorlatoz|menetrend|potlobusz|vaganyzar|utlezaras|parkolasi tilalom|sebessegellenorzes|rendeszeti ertekezlet|baleset.megeloz|toborzo|traffic restriction|timetable/;
const traffic=/baleset|karambol|utkoz|koccan|gazol|crash|collision|traffic accident/;
// Only explicit all-clear statements. "Property damage" or a lightly injured
// person alone does not establish that nobody else was seriously hurt.
const minor=/senki (?:nem|sem) serult meg|szemelyi serules (?:nem tortent|nelkul)|kizarolag anyagi kar|csak anyagi kar|csak konnyu serul|kizarolag konnyu serul|no one was injured|there were no injuries|only minor injuries/;
export function cheapDecision(title,text='',{complete=false}={}) {
  const t=norm(title+'\n'+text),head=norm(title);
  const missing=/eltunt|eltunes|eltunese|nyoma veszett|ismeretlen helyre tavoz|missing (?:person|girl|boy|woman|man|child)|пропал|пропавш/;
  const crime=/emberrab|elrabol|gyilk|emberoles|megol|holttest|kesel|megszur|assault|murder|kidnap/;
  if(missing.test(head)&&!crime.test(t))return {decision:'drop',reason:'Розыск пропавших людей временно вне тематики',signals:[]};
  // Vehicle fire alone is not a green flag. Leave uncertain cases to Flash.
  const vehicleFire=/(?:auto|gepkocsi|jarmu|kamion|truck|car|vehicle)/.test(head)&&/kigyull|kiegett|lang|tuz|fire|burn/.test(head);
  if(vehicleFire)return {decision:'ambiguous',reason:'Проверить последствия пожара автомобиля: одного возгорания недостаточно',signals:positiveSignals(t)};
  // Positive incident signals take precedence over generic road/transport words.
  const signals=positiveSignals(t);
  if(signals.some(s=>['violence','unusual','rescueAndDanger'].includes(s)))return {decision:'keep',reason:'Зелёные флаги: преступление, розыск, спасение или необычный инцидент',signals};
  if(signals.length)return {decision:'ambiguous',reason:'Зелёные флаги: возможные тяжёлые последствия или опасные обстоятельства; проверить контекст',signals};
  if(routine.test(head)&&!traffic.test(head))return {decision:'drop',reason:'Плановая транспортная или служебная информация'};
  if(complete&&traffic.test(t)&&minor.test(t))return {decision:'drop',reason:'В полном тексте явно указано отсутствие пострадавших или только лёгкие последствия; зелёных флагов нет'};
  return {decision:'ambiguous',reason:'Нужна короткая проверка содержания'};
}
const schema=z.object({keep:z.boolean(),reason:z.string().min(1).max(700),quote:z.string().max(1000).optional()}).strict();
export class Triage {
  constructor(model){this.model=model;}
  async check(doc){
    const local=/budapest|kerulet|budai|pesti|obuda|ujpest|erzsebetvaros|terezvaros|jozsefvaros|ferencvaros|kispest|csepel|zuglo|kobanya|angyalfold|ujbuda|budafok|rakos[a-z]*|pestszent[a-z]*|soroksar|hegyvidek|lipotvaros|bekasmegyer/;
    const localHint=local.test(norm(doc.title+'\n'+doc.text));
    const cheap=cheapDecision(doc.title,doc.text,{complete:true});
    if(cheap.decision==='drop'||(cheap.decision==='keep'&&localHint))return {keep:cheap.decision==='keep',reason:cheap.reason,method:'rules'};
    const text=doc.text.slice(0,16000);
    const result=await this.model.json('triage',{title:doc.title,text},{maxTokens:450,validate:raw=>{
      const r=schema.parse(raw);if(r.quote&&!text.includes(r.quote)&&!doc.title.includes(r.quote))throw new Error('Triage quote is not in the article');return r;
    }});
    return {...result,method:'flash-short'};
  }
}
