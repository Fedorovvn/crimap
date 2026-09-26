import { readFileSync } from 'node:fs';
export const policy=JSON.parse(readFileSync(new URL('../contracts/v1/recheck-policy.json',import.meta.url),'utf8'));
export function anchor(event){return event.occurredAt??event.firstSeenAt;}
export function intervalFor(event,now=Date.now()){
  const start=Date.parse(anchor(event));if(!Number.isFinite(start)||start>now)throw new Error('Invalid or future event date');
  const age=(now-start)/1000;
  return policy.stages.find(s=>age>=s.minAgeSeconds&&age<s.maxAgeSecondsExclusive)?.intervalSeconds??null;
}
export function nextCheck(event,now=Date.now()){
  const interval=intervalFor(event,now);if(interval===null)return null;
  const next=now+interval*1000, stop=Date.parse(anchor(event))+policy.stopAtAgeSeconds*1000;
  return next<stop?new Date(next).toISOString():null;
}
export function retryDelay(attempt,retryAfter=0){return Math.max(Math.min(60*2**Math.min(attempt,10),21600),Math.min(retryAfter,86400))*1000;}
