import { JSDOM } from 'jsdom';
import { sourceFor } from './sources.mjs';
import { cheapDecision } from './triage.mjs';
import { canonicalUrl } from './network.mjs';
const plain=html=>JSDOM.fragment(html??'').textContent.trim();
export function budapestDate(raw){
  if(!raw)return null;
  const text=raw.trim().replace(' ','T');
  if(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)){const n=Date.parse(text);return Number.isFinite(n)?new Date(n).toISOString():null;}
  const utc=Date.parse(text+'Z');if(!Number.isFinite(utc))return null;
  const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const local=Date.parse(fmt.format(new Date(utc)).replace(' ','T')+'Z');return new Date(utc-(local-utc)).toISOString();
}
export function parsePoliceArchive(body,url){
  const dom=new JSDOM(body,{url});try{
    const d=dom.window.document,items=[...d.querySelectorAll('article')].map(a=>({url:a.querySelector('h1 a,h2 a')?.href,title:a.querySelector('h1,h2')?.textContent.trim()??'',excerpt:a.querySelector('.lead-text')?.textContent.trim()??'',publishedAt:budapestDate(a.querySelector('time')?.getAttribute('datetime'))})).filter(x=>x.url&&sourceFor(x.url)?.id==='police-brfk');
    const next=d.querySelector('a[rel="next"],.pager__item--next a,.pager-next a')?.href??[...d.querySelectorAll('a')].find(a=>/Következő oldal/.test(a.textContent))?.href;
    return {items,next:next&&sourceFor(next)?.id==='police-brfk'?next:null};
  }finally{dom.window.close();}
}
export class Archive{
  constructor(store,{reader}){this.store=store;this.reader=reader;}
  start({id,from,to,budget}){
    if(!/^[a-z0-9-]{1,100}$/.test(id)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>=to||!Number.isFinite(budget)||budget<=0)throw new Error('Invalid archive campaign');
    this.store.transaction(()=>{
      const existing=this.store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
      if(existing){if(existing.from_date!==from||existing.to_date!==to||existing.budget_usd!==budget)throw new Error('Campaign already exists with different settings');return;}
      this.store.db.prepare('INSERT INTO campaigns(id,from_date,to_date,budget_usd,created_at) VALUES(?,?,?,?,?)').run(id,from,to,budget,new Date().toISOString());
      for(const [sourceId,url] of [['police-brfk','https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink?field_feltolto_szerv_target_id=108'],['kekvillogo',this.wpURL(from,to,1)]])this.store.enqueue('archive',`${id}:${sourceId}:1`,{campaignId:id,sourceId,url,page:1});
    });return this.store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
  }
  wpURL(from,to,page){const u=new URL('https://kekvillogo.hu/wp-json/wp/v2/posts');for(const [k,v] of Object.entries({after:from,before:to,per_page:50,page,_fields:'link,date_gmt,title,excerpt',orderby:'date',order:'desc'}))u.searchParams.set(k,String(v));return u.href;}
  async scan(payload){
    const {campaignId,sourceId,url,page}=payload,campaign=this.store.db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaignId);
    if(campaign?.state!=='running'||campaign.discovery_stopped)return;
    if(page>100)throw new Error('Archive page safety limit reached');
    if(this.store.db.prepare('SELECT 1 FROM archive_pages WHERE campaign_id=? AND url=?').get(campaignId,url))return;
    const response=await this.reader.read(url,{json:sourceId==='kekvillogo'});
    let items,next;
    if(sourceId==='police-brfk')({items,next}=parsePoliceArchive(response.body,url));
    else if(sourceId==='kekvillogo'){
      const data=JSON.parse(response.body);if(!Array.isArray(data))throw new Error('Invalid WordPress archive response');
      items=data.map(p=>({url:p.link,title:plain(p.title?.rendered),excerpt:plain(p.excerpt?.rendered),publishedAt:p.date_gmt?new Date(p.date_gmt+'Z').toISOString():null}));
      if(data.length===50)next=this.wpURL(campaign.from_date,campaign.to_date,page+1);
    }else throw new Error('Unsupported archive source');
    const dates=items.map(i=>i.publishedAt).filter(Boolean).sort();let filtered=0,found=0;
    this.store.transaction(()=>{
      for(const item of items){
        if(!item.publishedAt||item.publishedAt<campaign.from_date||item.publishedAt>campaign.to_date)continue;
        if(sourceFor(item.url)?.id!==sourceId)continue;
        found++;const decision=cheapDecision(item.title,item.excerpt);
        if(decision.decision==='drop'){filtered++;this.store.log('archive-filtered',item.url,{campaignId,reason:decision.reason});continue;}
        const key=canonicalUrl(item.url);
        const old=this.store.db.prepare("SELECT * FROM jobs WHERE kind='article' AND job_key=?").get(key);
        if(old?.state==='running'||old?.state==='queued')continue;
        if(old?.state==='done'&&this.store.db.prepare("SELECT 1 FROM documents d JOIN audit a ON a.subject=(cast(d.id as text)||':'||d.latest_hash) AND a.action='document-processed' WHERE d.url=?").get(key))continue;
        this.store.enqueue('article',key,{...item,campaignId});
      }
      this.store.db.prepare('INSERT OR REPLACE INTO archive_pages VALUES(?,?,?,?,?,?,?,?)').run(campaignId,sourceId,url,dates[0]??null,dates.at(-1)??null,found,filtered,new Date().toISOString());
      if(next&&(!dates.length||dates[0]>=campaign.from_date))this.store.enqueue('archive',`${campaignId}:${sourceId}:${page+1}`,{...payload,url:next,page:page+1},campaign.created_at);
      this.store.log('archive-page',url,{campaignId,sourceId,found,filtered,next:next??null});
    });
  }
  settle(){
    for(const c of this.store.db.prepare("SELECT id FROM campaigns WHERE state='running'").all()){
      const pending=this.store.db.prepare("SELECT count(*) n FROM jobs WHERE json_extract(payload,'$.campaignId')=? AND state IN ('queued','running','paused')").get(c.id).n;
      if(!pending){
        const failed=this.store.db.prepare("SELECT count(*) n FROM jobs WHERE json_extract(payload,'$.campaignId')=? AND state='failed'").get(c.id).n;
        const unresolved=this.store.db.prepare(`SELECT count(*) n FROM events e LEFT JOIN quality_reviews q ON q.event_id=e.id AND q.revision=e.revision WHERE e.campaign_id=? AND e.merged_into IS NULL AND e.state!='excluded' AND e.editorial_mark!='uninteresting' AND coalesce(e.published_revision,0)!=e.revision AND (coalesce(json_extract(q.payload,'$.verdict'),'pending')!='pass' OR e.occurred_at IS NULL OR json_extract(e.canonical,'$.location.latitude') IS NULL OR NOT EXISTS(SELECT 1 FROM translations t WHERE t.event_id=e.id AND t.revision=e.revision AND t.language='ru') OR NOT EXISTS(SELECT 1 FROM site_translations t WHERE t.event_id=e.id AND t.revision=e.revision))`).get(c.id).n;
        this.store.db.prepare('UPDATE campaigns SET state=? WHERE id=?').run(failed||unresolved?'complete-with-errors':'complete',c.id);
      }
    }
  }
}
