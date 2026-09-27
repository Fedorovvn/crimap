import {normalizeSignal as norm} from './triage-signals.mjs';

// These cues route ambiguous stories to Flash BEFORE generic green flags.
// A topic mention alone is never a reason to discard a human assault or crash.
const scopeHints=/(?:^|[^a-z])(?:kuty|macska|allat|madar|dog\b|cat\b|animal|собак|кошк|животн|птиц|klor|ammonia|vegyi|vegyipar|chemical|chlorine|toxic cloud|хлор|химическ|химзавод|sikloerny|ejtoerny|bazisugr|paraglid|skydiv|bungee|параплан|парашют|kabit|drog|diler|kristaly|marihuana|kokain|drug|dealer|наркот|наркодил|razzia|rajtaut|hazkutat|lefoglal|ellenorz|koz[b]?iztonsagi akcio|raid\b|seizure|рейд|обыск|изъят|kozbeszerz|korrup|sikkaszt|veszteget|csalas|hivatali visszaeles|corrupt|procurement|fraud|embezzl|коррупц|закуп|мошеннич|bor[t]?on|fegyhaz|prison|тюрьм)/;
const animalIncident=/(?:kutyatamadas|kutyaharapas|kutya\w* (?:tamad|mart|harap)|(?:tamad|mart|harap)\w*.{0,45}kutya|dog (?:attack|bite|bit\b)|animal attack|нападени[а-я]* собак|собак[а-я]*.{0,35}(?:напал|покус|загрыз)|(?:покус|загрыз)[а-я]*.{0,35}собак)/;
const industrialChemical=/(?:klor|ammonia|vegyi|chemical|chlorine|хлор|аммиак|химическ)/;
const facility=/(?:uzem|gyar|factory|plant\b|industrial|завод|предприяти|промышлен)/;
const release=/(?:szivarg|kiszabad|mergez|felho|leak|spill|release|toxic cloud|утеч|выброс|облак|отрав)/;
const independentViolence=/(?:kesel|megszur|leszur|lovoldoz|ralott|kirabol|emberoles|gyilk|stabb|shooting|homicide|robbery|нож|зареза|стрельб|застрел|убийств|ограб|поджог|arson|gyujtogat|chemical attack|vegyi tamadas|химическ[а-я]* атак)/;

export function scopeDecision(title,text=''){
  const head=norm(title),all=norm(title+'\n'+text);
  // Explicit headlines can be rejected for free, even if injuries are severe.
  // Mixed stories with human violence still need a contextual decision.
  if(!independentViolence.test(all)){
    if(animalIncident.test(head))return {decision:'drop',reason:'Происшествия с животными вне тематики',signals:[]};
    if(industrialChemical.test(head)&&facility.test(head)&&release.test(head))return {decision:'drop',reason:'Промышленные и химические аварии вне тематики, включая госпитализации',signals:[]};
  }
  if(scopeHints.test(all))return {decision:'ambiguous',reason:'Проверить редакционную тематику: важен сам инцидент с человеком, а не рейд, опасное слово или общий масштаб'};
  return null;
}
