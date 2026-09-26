import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Store } from './store.mjs';
import { Reader } from './network.mjs';
import { DeepSeek } from './model.mjs';
import { Search } from './search.mjs';
import { Pipeline } from './pipeline.mjs';
import { eventSchema, applyTranslation, translationStrings } from './contract.mjs';
import { migratePublic, publish } from './publish.mjs';
import { exportRequests } from './review.mjs';
import { Triage } from './triage.mjs';
import { Preparation } from './prepare.mjs';
import { Archive } from './archive.mjs';
import { localizePublished } from './site-localization.mjs';
const {values,positionals}=parseArgs({allowPositionals:true,options:{db:{type:'string'},'public-db':{type:'string'},file:{type:'string'},reviewer:{type:'string'},context:{type:'boolean'},legal:{type:'boolean'},limit:{type:'string'},from:{type:'string'},to:{type:'string'},budget:{type:'string'}}});
const [command='status',arg]=positionals,path=values.db??process.env.COLLECTOR_DATABASE_PATH??'data/collector.sqlite';
const store=new Store(path),reader=new Reader(store),model=new DeepSeek(store),archive=new Archive(store,{reader});
const pipeline=new Pipeline(store,{reader,model,reviewer:new DeepSeek(store,{model:process.env.DEEPSEEK_REVIEW_MODEL??'deepseek-v4-pro'}),search:new Search(store),triage:new Triage(model),preparation:new Preparation(store,{model}),archive});
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
try{
  let result;
  if(command==='worker'){pipeline.seed();while(!stopping){const worked=await pipeline.runOne();if(!worked)await new Promise(r=>setTimeout(r,2000));}}
  else if(command==='run'){pipeline.seed();for(let i=0;i<Number(values.limit??10);i++)if(!await pipeline.runOne())break;result={processed:true};}
  else if(command==='ingest'){if(!arg)throw new Error('Supply a registered article URL');result=await pipeline.ingest(arg);}
  else if(command==='recheck')result=await pipeline.recheck(Number(arg));
  else if(command==='translate')result=await pipeline.translate(Number(arg));
  else if(command==='review')result=await pipeline.review(Number(arg));
  else if(command==='prepare')result=await pipeline.prepare(Number(arg));
  else if(command==='localize-public')result=await localizePublished(store,model,values['public-db']??process.env.DATABASE_PATH);
  else if(command==='backfill')result=archive.start({id:arg,from:values.from,to:values.to,budget:Number(values.budget)});
  else if(command==='requests')result={file:exportRequests(store),requests:store.db.prepare('SELECT * FROM field_requests ORDER BY created_at DESC').all().map(r=>({...r,payload:JSON.parse(r.payload)}))};
  else if(command==='show'){result=store.event(Number(arg));if(values.file){writeFileSync(values.file,JSON.stringify(result?.canonical,null,2)+'\n');result={saved:values.file};}}
  else if(command==='revise'){
    if(!values.reviewer||!values.file)throw new Error('revise requires --file and --reviewer');
    const previous=store.event(Number(arg));if(!previous)throw new Error('Unknown event');
    const event=eventSchema.parse(JSON.parse(readFileSync(values.file,'utf8')));
    store.transaction(()=>{
      const revision=previous.revision+1;store.db.prepare("UPDATE events SET canonical=?,occurred_at=?,revision=?,state='draft',review_reason='Editorial revision' WHERE id=?").run(JSON.stringify(event),event.occurredAt,revision,previous.id);
      store.db.prepare('INSERT INTO event_revisions(event_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?)').run(previous.id,revision,JSON.stringify(event),'editorial: '+values.reviewer,new Date().toISOString());store.enqueue('prepare',previous.id,{eventId:previous.id,campaignId:previous.campaign_id});store.log('editorial-revision',previous.id,{reviewer:values.reviewer,revision});
      // Metadata-only corrections can reuse the translation without another paid request.
      const old=store.db.prepare("SELECT payload FROM translations WHERE event_id=? AND revision=? AND language='ru'").get(previous.id,previous.revision);
      if(old&&JSON.stringify(translationStrings(event))===JSON.stringify(translationStrings(previous.canonical))){const translated=applyTranslation(event,{language:'ru',strings:translationStrings(JSON.parse(old.payload))});store.db.prepare('INSERT INTO translations VALUES(?,?,?,?,?,?)').run(previous.id,revision,'ru',JSON.stringify(translated),'editorial-reuse',new Date().toISOString());}
    });result={revised:previous.id};
  }
  else if(command==='migrate-public'){const db=values['public-db']??process.env.DATABASE_PATH;if(!db)throw new Error('Supply --public-db');migratePublic(db);result={migrated:true};}
  else if(command==='publish'){const db=values['public-db']??process.env.DATABASE_PATH;if(!db)throw new Error('Supply --public-db');result={publicId:publish(store,Number(arg),db,{reviewer:values.reviewer,includeContext:values.context,includeLegal:values.legal})};}
  else if(command==='status')result={searchConfigured:!!process.env.BRAVE_SEARCH_API_KEY,modelConfigured:!!process.env.DEEPSEEK_API_KEY,events:store.db.prepare('SELECT id,slug,state,revision,published_revision,next_check_at,review_reason FROM events ORDER BY id DESC LIMIT 50').all(),jobs:store.db.prepare('SELECT kind,state,count(*) AS count FROM jobs GROUP BY kind,state').all(),recentErrors:store.db.prepare('SELECT kind,last_error,due_at FROM jobs WHERE last_error IS NOT NULL ORDER BY due_at DESC LIMIT 10').all(),today:store.db.prepare('SELECT count(*) AS calls,coalesce(sum(coalesce(cost_usd,reserved_usd)),0) AS estimatedUsd FROM usage WHERE created_at>=?').get(new Date().toISOString().slice(0,10))};
  else throw new Error('Commands: status, worker, run, ingest URL, show ID, revise ID, prepare ID, translate ID, review ID, requests, recheck ID, backfill ID --from ISO --to ISO --budget USD, migrate-public, publish ID');
  if(result!==undefined)process.stdout.write(JSON.stringify(result,null,2)+'\n');
}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}finally{store.close();}
