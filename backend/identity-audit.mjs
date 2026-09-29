// Explicit offline audit, or a bounded Flash-only shadow run. Never queues,
// edits or publishes an event. Paid shadow calls use the normal global ledger.
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {Store} from './store.mjs';
import {DeepSeek} from './model.mjs';
import {identify,compareBrief,comparisonCard,compactComparisonCard} from './dedup.mjs';
import {indexedCandidates} from './event-index.mjs';

export async function auditIdentity(path,{live=false,cap=.15}={}){
 const db=new DatabaseSync(path,{readOnly:!live});
 // Reuse ledger methods without running Store startup mutations/migrations.
 const store=Object.assign(Object.create(Store.prototype),{db,path});
 const usageIds=[];
 try{
  const rows=db.prepare("SELECT * FROM events WHERE merged_into IS NULL AND state!='excluded'").all().map(r=>({...r,canonical:JSON.parse(r.canonical)}));
  const report={mode:live?'flash-shadow':'offline',events:rows.length,published:rows.filter(r=>r.public_id&&!r.withdrawn_at).length,payloads:{pairs:0,fullCharacters:0,compactCharacters:0,eligiblePairs:0},retrieval:{checked:0,found:0,misses:[]},checks:[]};
  for(const row of rows){
   for(const candidate of indexedCandidates(store,row.canonical,{excludeId:row.id})){
    const full=JSON.stringify({incoming:comparisonCard(row.canonical),candidates:[{id:candidate.id,event:comparisonCard(candidate.canonical)}]}).length;
    const compact=JSON.stringify({incoming:compactComparisonCard(row.canonical),candidates:[{id:candidate.id,event:compactComparisonCard(candidate.canonical)}]}).length;
    report.payloads.pairs++;report.payloads.fullCharacters+=full;report.payloads.compactCharacters+=compact;
    if(full>6000&&compact<full*.65)report.payloads.eligiblePairs++;
   }
  }
  // Known observation/event links exercise retrieval without paid inference.
  for(const row of rows){
   for(const saved of db.prepare('SELECT extracted,document_id FROM observations WHERE event_id=?').all(row.id)){
    const incoming=JSON.parse(saved.extracted);
    if(!incoming.title||!incoming.location)continue;
    const found=indexedCandidates(store,incoming,{documentId:saved.document_id}).some(c=>c.id===row.id);
    report.retrieval.checked++;if(found)report.retrieval.found++;else report.retrieval.misses.push({eventId:row.id,title:incoming.title});
   }
  }
  if(live){
   const reserve=store.reserveCost.bind(store);
   const spent=()=>usageIds.reduce((sum,id)=>{const row=db.prepare('SELECT cost_usd,reserved_usd FROM usage WHERE id=?').get(id);return sum+(row.cost_usd??row.reserved_usd);},0);
   store.reserveCost=(...args)=>{
    if(spent()+args[3]>cap)throw new Error('Identity shadow budget reached');
    const id=reserve(...args);usageIds.push(id);return id;
   };
   const model=new DeepSeek(store);
   const chosen=[];
   for(const type of ['assault','traffic-accident','fight','accident']){
    const row=rows.find(r=>r.public_id&&!r.withdrawn_at&&r.canonical.type===type);
    if(row)chosen.push(row);
   }
   for(const row of chosen){
    const saved=db.prepare('SELECT d.*,v.title,v.text FROM observations o JOIN documents d ON d.id=o.document_id JOIN document_versions v ON v.document_id=d.id AND v.content_hash=o.content_hash WHERE o.event_id=? ORDER BY length(v.text) DESC LIMIT 1').get(row.id);
    if(!saved)continue;
    const doc={id:saved.id,title:saved.title,text:saved.text,publishedAt:saved.published_at};
    const briefs=await identify(model,doc);
    let matched=false;
    for(const brief of briefs){
     const result=await compareBrief(model,brief,[row],{document:doc});
     if(result.decision!=='new'&&result.eventId===row.id)matched=true;
    }
    report.checks.push({kind:'known-source-match',eventId:row.id,title:row.canonical.title,incidents:briefs.length,passed:matched});
    // Self-identity of a full card should remain a repeat even with rich fields.
    const self=await compareBrief(model,row.canonical,[row]);
    report.checks.push({kind:'same-card-repeat',eventId:row.id,passed:self.decision==='repeat'&&self.eventId===row.id,decision:self.decision});
   }
   if(chosen.length>=2){
    const result=await compareBrief(model,chosen[0].canonical,[chosen[1]]);
    report.checks.push({kind:'different-known-events',eventIds:chosen.slice(0,2).map(r=>r.id),passed:result.decision==='new',decision:result.decision});
   }
   report.usage={calls:usageIds.length,costUsd:spent(),capUsd:cap};
  }
  return report;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const report=await auditIdentity(process.argv[2],{live:process.argv.includes('--live')});
 console.log(JSON.stringify(report,null,2));
 if(report.checks.some(r=>!r.passed))process.exitCode=1;
}
