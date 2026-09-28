import {normalizeSignal as norm} from './triage-signals.mjs';

export const TRAFFIC_POLICY='fatal-road-accidents-only-v1';
export const TRAFFIC_HOLD_REASON='ДТП отложено: в источниках нет подтверждённой гибели человека. Ждём новых сведений; подготовка и Pro не запускаются.';

// These are routing hints, never proof of a death or of the event category.
const traffic= /baleset|karambol|utkoz|koccan|gazol|felborult.{0,25}(?:auto|busz)|(?:auto|busz).{0,25}felborult|crash|collision|run over|struck by (?:a |an )?(?:car|bus|tram|truck|vehicle)|дтп|столкнов|сбил[аи]?|наезд|опрокин/;
const violence=/kesel|megszur|leszur|gyilk|emberoles|kirabol|vereked|megtamad|stabb|assault|murder|robbery|fight|напад|зареза|нож|драк|убийств|ограб/;
export const isTrafficReport=(title,text='')=>traffic.test(norm(title+'\n'+text))&&!violence.test(norm(title+'\n'+text));

export function reportsDeath(text){
  return norm(text).split(/[.!?;\n]+/).some(sentence=>{
    if(/nem (?:halt|hunyt)|nem volt.{0,20}halalos|senki.{0,15}(?:halt|hunyt)|halalos aldozat nelkul|no (?:one|deaths|fatalit)|nobody died|non[- ]fatal|not (?:dead|fatal)|nearly (?:died|killed)|could (?:die|have died)|may (?:die|have died)|без погиб|не погиб|погибших нет|едва не|мог.{0,12}погиб|halalfelel|halalos fenyeget/.test(sentence))return false;
    return /meghalt|elhunyt|eletet veszt|belehalt|halalat|halalos (?:baleset|karambol|gazolas|aldozat)|\bdied\b|\bdead\b|\bkilled\b|\bfatal (?:crash|collision|accident|injur)|погиб|скончал|умер(?:ла|ли|\b)|смертельн/.test(sentence);
  });
}

export function needsFatalityConfirmation(event){
  if(event?.type!=='traffic-accident')return false;
  const deceased=(event.participants??[]).map((p,i)=>p.status==='deceased'?i:-1).filter(i=>i>=0);
  if(!event.signals?.includes('death')&&!deceased.length)return true;
  // A keyword elsewhere in a long article (related links, an older crash) must
  // not unlock Pro. Require a quotation attached to this event's outcome.
  return !(event.evidence??[]).some(e=>(/^signals(?:\.|$)/.test(e.field)||deceased.some(i=>e.field===`participants.${i}`||e.field===`participants.${i}.status`))&&reportsDeath(e.quote));
}
