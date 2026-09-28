import {normalizeSignal as norm} from './triage-signals.mjs';

// These cues route ambiguous stories to Flash BEFORE generic green flags.
// A topic mention alone is never a reason to discard a human assault or crash.
const scopeHints=/(?:^|[^a-z])(?:kuty|macska|allat|madar|dog\b|cat\b|animal|собак|кошк|животн|птиц|klor|ammonia|vegyi|vegyipar|chemical|chlorine|toxic cloud|хлор|химическ|химзавод|sikloerny|ejtoerny|bazisugr|paraglid|skydiv|bungee|параплан|парашют|kabit|drog|diler|kristaly|marihuana|kokain|drug|dealer|наркот|наркодил|razzia|rajtaut|hazkutat|lefoglal|ellenorz|koz[b]?iztonsagi akcio|raid\b|seizure|рейд|обыск|изъят|kozbeszerz|korrup|sikkaszt|veszteget|csalas|hivatali visszaeles|corrupt|procurement|fraud|embezzl|коррупц|закуп|мошеннич|bor[t]?on|fegyhaz|prison|тюрьм)/;
const animalIncident=/(?:kutyatamadas|kutyaharapas|kutya\w* (?:tamad|mart|harap)|(?:tamad|mart|harap)\w*.{0,45}kutya|dog (?:attack|bite|bit\b)|animal attack|нападени[а-я]* собак|собак[а-я]*.{0,35}(?:напал|покус|загрыз)|(?:покус|загрыз)[а-я]*.{0,35}собак)/;
const industrialChemical=/(?:klor|ammonia|vegyi|chemical|chlorine|хлор|аммиак|химическ)/;
const facility=/(?:uzem|gyar|factory|plant\b|industrial|завод|предприяти|промышлен)/;
const release=/(?:szivarg|kiszabad|mergez|felho|leak|spill|release|toxic cloud|утеч|выброс|облак|отрав)/;
const independentViolence=/(?:kesel|megszur|leszur|lovoldoz|ralott|kirabol|emberoles|gyilk|stabb|shooting|homicide|robbery|нож|зареза|стрельб|застрел|убийств|ограб|поджог|arson|gyujtogat|chemical attack|vegyi tamadas|химическ[а-я]* атак)/;
// These describe a police outcome to an earlier non-violent property offence,
// rather than a new threat faced by an ordinary person. Keep a concrete home
// intrusion if the source reports force, a threatened resident or an injury.
const nonviolentPropertyCrime=/(?:lakasbetor|lakasbetores|betores|betoro|besurrano|tolvaj|lopas|burglar(?:y)?|house break(?:-in)?|theft|квартирн|краж|вор)/;
const policeOutcome=/(?:orizetbe|letartoztat|elfogtak|elfogas|bilincs|rendorsegi (?:intezkedes|akcio)|arrested|detained|charged|sentenced|court|biro|полици[яи].*(?:задерж|арест)|задержал|задержан|арестован|суд)/;
// A report focused on a person climbing or walking on infrastructure is not a
// public-safety incident by itself. Blood, an attack or a danger to someone
// else continues through the ordinary relevance checks below.
const selfRiskInfrastructure=/(?:zajvedo|zajgatlo|shumozashit|шумозащит|hanggatlo|(?:^|[^a-z])korlat(?:$|[^a-z])|barrier|ограждени)/;
const selfRiskAction=/(?:masz|felmasz|setal|jar|tetejen|tetejere|walk(?:ing)?|climb(?:ing)?|ид[её]т|ходит|лез)/;
const concreteHarmOrThreat=/(?:kesel|megszur|leszur|tamadas|megtamad|bantalmaz|rabl|gyilk|emberoles|halal|meghalt|halott|sulyos|eletveszely|veres|verzo|bloody|bloodied|injured|killed|died|нож|нападен|ранен|погиб|смерт|тяж[её]л|кров)/;

export function scopeDecision(title,text=''){
  const head=norm(title),all=norm(title+'\n'+text);
  if(nonviolentPropertyCrime.test(all)&&policeOutcome.test(all)&&!independentViolence.test(all)&&!concreteHarmOrThreat.test(all)){
    return {decision:'drop',reason:'Полицейское задержание по имущественному преступлению без подтверждённой угрозы или вреда людям',signals:[]};
  }
  if(selfRiskInfrastructure.test(all)&&selfRiskAction.test(all)&&!concreteHarmOrThreat.test(all)){
    return {decision:'drop',reason:'Рискованное действие самого участника без подтверждённого вреда или угрозы другим людям',signals:[]};
  }
  // Explicit headlines can be rejected for free, even if injuries are severe.
  // Mixed stories with human violence still need a contextual decision.
  if(!independentViolence.test(all)){
    if(animalIncident.test(head))return {decision:'drop',reason:'Происшествия с животными вне тематики',signals:[]};
    if(industrialChemical.test(head)&&facility.test(head)&&release.test(head))return {decision:'drop',reason:'Промышленные и химические аварии вне тематики, включая госпитализации',signals:[]};
  }
  if(scopeHints.test(all))return {decision:'ambiguous',reason:'Проверить редакционную тематику: важен сам инцидент с человеком, а не рейд, опасное слово или общий масштаб'};
  return null;
}
