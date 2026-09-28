import { readFileSync } from 'node:fs';

export const policy=JSON.parse(readFileSync(new URL('../contracts/v2/recheck-policy.json',import.meta.url),'utf8'));
const BUDAPEST='Europe/Budapest';
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:BUDAPEST,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});

function localParts(at){
  return Object.fromEntries(clock.formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
function localDate(parts,days=0){
  const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day+days));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
// Convert a Budapest wall-clock time to an instant. The small fixed-point loop
// also makes the intended local times survive CET/CEST transitions.
function atBudapestHour(date,hour){
  const target=Date.UTC(date.year,date.month-1,date.day,hour,0,0);
  let guess=target;
  for(let attempt=0;attempt<4;attempt++){
    const actual=localParts(guess);
    const delta=target-Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,actual.second);
    if(delta===0)return guess;
    guess+=delta;
  }
  return guess;
}
function nextAtHours(now,hours){
  const parts=localParts(now);
  for(let offset=0;offset<4;offset++){
    const date=localDate(parts,offset);
    for(const hour of hours){
      const candidate=atBudapestHour(date,hour);
      if(candidate>now)return candidate;
    }
  }
  throw new Error('Could not schedule a Budapest calendar check');
}
function nextDaytimeInterval(now,stage){
  const candidate=now+stage.intervalSeconds*1000;
  const parts=localParts(candidate),window=stage.activeHours;
  if(parts.hour>=window.start&&parts.hour<window.endExclusive)return candidate;
  const date=localDate(parts,parts.hour<window.start?0:1);
  return atBudapestHour(date,window.start);
}
function nextByStage(now,stage){
  if(stage.schedule==='daily-times')return nextAtHours(now,stage.dailyHours);
  if(stage.schedule==='daytime-interval')return nextDaytimeInterval(now,stage);
  return now+stage.intervalSeconds*1000;
}
function ageAt(start,now){
  if(!Number.isFinite(start)||start>now)throw new Error('Invalid or future event date');
  return (now-start)/1000;
}
function stageFor(stages,age){return stages.find(stage=>age>=stage.minAgeSeconds&&age<stage.maxAgeSecondsExclusive)??null;}

export function anchor(event){return event.occurredAt??event.firstSeenAt;}
export function intervalFor(event,now=Date.now()){
  const start=Date.parse(anchor(event)),stage=stageFor(policy.stages,ageAt(start,now));
  return stage?.intervalSeconds??null;
}
export function nextCheck(event,now=Date.now()){
  const start=Date.parse(anchor(event)),stage=stageFor(policy.stages,ageAt(start,now));
  if(!stage)return null;
  const next=nextByStage(now,stage),stop=start+policy.stopAtAgeSeconds*1000;
  return next<stop?new Date(next).toISOString():null;
}
// A short evidence chase is for unpublished records that still lack either
// an occurrence date or a confirmed fatality. It is deliberately anchored at
// discovery and has fixed checkpoints, not an open-ended polling interval.
export function nextPendingFactCheck(event,now=Date.now()){
  const start=Date.parse(event.firstSeenAt);ageAt(start,now);
  const target=policy.pendingFactCheckAgesSeconds.find(age=>start+age*1000>now);
  return target===undefined?null:new Date(start+target*1000).toISOString();
}
export function retryDelay(attempt,retryAfter=0){return Math.max(Math.min(60*2**Math.min(attempt,10),21600),Math.min(retryAfter,86400))*1000;}
