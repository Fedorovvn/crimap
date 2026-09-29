import {parseFeed,feeds} from './sources.mjs';
import {cheapDecision} from './triage.mjs';
import {hash} from './store.mjs';

export function syncDiscoverySources(store,sourceIds){
  const active=feeds(sourceIds),urls=new Set(active.map(f=>f.url)),ids=new Set(sourceIds);
  store.transaction(()=>{
    for(const job of store.db.prepare("SELECT * FROM jobs WHERE kind IN ('feed','article') AND state IN ('queued','paused','failed')").all()){
      const payload=JSON.parse(job.payload);
      const unusedFeed=job.kind==='feed'&&!urls.has(job.job_key);
      const unusedArticle=job.kind==='article'&&payload.discoveredBy&&!ids.has(payload.discoveredBy)&&!payload.eventId&&!payload.campaignId
        &&!store.db.prepare('SELECT 1 FROM documents d JOIN observations o ON o.document_id=d.id WHERE d.url=?').get(payload.url??job.job_key);
      if(unusedFeed||unusedArticle){
        store.db.prepare("UPDATE jobs SET state='cancelled',rerun=0,last_error=NULL WHERE id=?").run(job.id);
        store.log('discovery-source-disabled',job.id,{kind:job.kind,sourceId:payload.sourceId??payload.discoveredBy,url:payload.url});
      }
    }
    for(const feed of active){
      const old=store.db.prepare("SELECT state FROM jobs WHERE kind='feed' AND job_key=?").get(feed.url);
      if(!old||old.state==='cancelled')store.enqueue('feed',feed.url,feed);
    }
  });
}

// Discovery owns new URLs only. Updates of known articles belong to the event
// recheck scheduler, never to a changed RSS headline/date/advertising excerpt.
export async function discoverFeed(store,reader,feed,{now=new Date()}={}){
  store.db.exec(`CREATE TABLE IF NOT EXISTS feed_entries(feed_url TEXT NOT NULL,article_url TEXT NOT NULL,fingerprint TEXT NOT NULL,seen_at TEXT NOT NULL,PRIMARY KEY(feed_url,article_url));
    CREATE TABLE IF NOT EXISTS source_polls(feed_url TEXT PRIMARY KEY,source_id TEXT NOT NULL,checked_at TEXT NOT NULL,item_count INTEGER NOT NULL,queued_count INTEGER NOT NULL,filtered_count INTEGER NOT NULL);`);
  if(!store.db.prepare('PRAGMA table_info(source_polls)').all().some(c=>c.name==='started_at'))store.db.exec('ALTER TABLE source_polls ADD COLUMN started_at TEXT');
  store.db.exec('CREATE INDEX IF NOT EXISTS feed_entries_article ON feed_entries(article_url)');
  const page=await reader.read(feed.url),items=parseFeed(page.body,page.url);
  let queued=0,filtered=0,unchanged=0;
  store.transaction(()=>{
    const previousPoll=store.db.prepare('SELECT * FROM source_polls WHERE feed_url=?').get(feed.url);
    const firstReceipt=store.db.prepare('SELECT min(seen_at) first_seen FROM feed_entries WHERE feed_url=?').get(feed.url).first_seen;
    const startedAt=previousPoll?.started_at??firstReceipt??previousPoll?.checked_at??now.toISOString();
    const baseline=!previousPoll&&!firstReceipt;
    for(const item of items){
      // Cross-feed receipts and archive jobs also count as already discovered.
      // Never overwrite campaign ownership, retry dates or a budget pause.
      const known=store.db.prepare('SELECT 1 FROM feed_entries WHERE article_url=? LIMIT 1').get(item.url)
        ||store.db.prepare('SELECT 1 FROM documents WHERE url=?').get(item.url)
        ||store.db.prepare("SELECT 1 FROM jobs WHERE kind='article' AND job_key=?").get(item.url);
      const fingerprint=hash(item);
      store.db.prepare('INSERT OR IGNORE INTO feed_entries VALUES(?,?,?,?)').run(feed.url,item.url,fingerprint,now.toISOString());
      if(known){unchanged++;continue;}
      // A newly connected feed is a baseline, not an implicit archive import.
      // Later arrivals may have an earlier publication timestamp (RSS delay).
      // Keep them if published during monitoring; don't import historical items.
      const old=item.publishedAt&&Date.parse(item.publishedAt)<Date.parse(startedAt);
      const decision=cheapDecision(item.title,item.excerpt??'');
      if(baseline||old||decision.decision==='drop'){
        filtered++;
        store.log('feed-article-filtered',feed.sourceId,{url:item.url,title:item.title,reason:baseline?'Начальный снимок ленты: старая статья':old?'Опубликовано до начала регулярного наблюдения':decision.reason,method:'rules'});
      }
      else {
        store.enqueue('article',item.url,{...item,discoveredBy:feed.sourceId,discoveredAt:now.toISOString()});queued++;
        store.log('feed-article-queued',feed.sourceId,{url:item.url,title:item.title,reason:'Новая ссылка передана на проверку содержания'});
      }
    }
    store.db.prepare('INSERT OR REPLACE INTO source_polls(feed_url,source_id,checked_at,item_count,queued_count,filtered_count,started_at) VALUES(?,?,?,?,?,?,?)').run(feed.url,feed.sourceId,now.toISOString(),items.length,queued,filtered,startedAt);
    store.log('feed-polled',feed.sourceId,{url:feed.url,items:items.length,queued,filtered,unchanged,baseline,startedAt});
  });
  return {items:items.length,queued,filtered,unchanged};
}
