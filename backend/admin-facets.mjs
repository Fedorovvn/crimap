import {cheapDecision} from './triage.mjs';
export function eventFacets(event){
  const text=[event.title,event.summary,...(event.legal??[]).map(l=>l.offense)].join(' ').toLowerCase();
  const homicide=/\b(?:homicide|murder(?:ed)?|manslaughter)\b|убийств|убит[а-я]*|emberöl|meggyilkol/.test(text)
    && !/\b(?:not (?:a )?(?:murder|homicide)|murder (?:was|is) ruled out)\b|не (?:является )?убийств/.test(text);
  const fatal=event.signals?.includes('death')||(event.participants??[]).some(p=>p.status==='deceased');
  const injured=event.signals?.includes('injury')||(event.participants??[]).some(p=>p.status==='injured');
  const serious=homicide||fatal||injured||['assault','fight','robbery','fire','rescue','missing-person'].includes(event.type);
  const decision=cheapDecision(event.title,event.summary,{complete:true});
  const impact=serious||decision.decision==='keep'?'significant':decision.decision==='drop'?'minor':'unknown';
  return {homicide,fatal:!!fatal,injured:!!injured,impact};
}
