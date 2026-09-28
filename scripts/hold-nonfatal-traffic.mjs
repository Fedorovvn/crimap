import {Store} from '../backend/store.mjs';
import {needsFatalityConfirmation,TRAFFIC_POLICY} from '../backend/traffic-policy.mjs';

// Run after a SQLite backup. Dry-run by default; no network or model calls.
const path=process.env.COLLECTOR_DATABASE_PATH;
if(!path)throw new Error('COLLECTOR_DATABASE_PATH is required');
const store=new Store(path),apply=process.argv.includes('--apply');
try{
 const rows=store.db.prepare("SELECT id FROM events WHERE merged_into IS NULL AND state!='excluded' AND editorial_mark!='uninteresting' AND json_extract(canonical,'$.type')='traffic-accident'").all().map(r=>store.event(r.id));
 const deferred=rows.filter(r=>needsFatalityConfirmation(r.canonical));
 if(apply)store.transaction(()=>{for(const row of deferred)store.holdForFatality(row.id);});
 console.log(JSON.stringify({policy:TRAFFIC_POLICY,applied:apply,deferred:deferred.map(r=>({id:r.id,title:r.canonical.title,publicId:r.public_id,previousState:r.state})),eligible:rows.filter(r=>!needsFatalityConfirmation(r.canonical)).map(r=>({id:r.id,title:r.canonical.title}))},null,2));
}finally{store.close();}
