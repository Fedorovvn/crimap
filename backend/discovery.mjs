import {parseFeed} from './sources.mjs';
import {cheapDecision} from './triage.mjs';
import {hash} from './store.mjs';

// Feed discovery never calls a model. Durable receipts suppress unchanged entries,
// while a changed headline/date/excerpt can trigger re-reading an updated article.
export async function discoverFeed(store,reader,feed,{now=new Date(),lookbackHours=48}={}){
  store.db.exec(`CREATE TABLE IF NOT EXISTS feed_entries(feed_url TEXT NOT NULL,article_url TEXT NOT NULL,fingerprint TEXT NOT NULL,seen_at TEXT NOT NULL,PRIMARY KEY(feed_url,article_url));
    CREATE TABLE IF NOT EXISTS source_polls(feed_url TEXT PRIMARY KEY,source_id TEXT NOT NULL,checked_at TEXT NOT NULL,item_count INTEGER NOT NULL,queued_count INTEGER NOT NULL,filtered_count INTEGER NOT NULL);`);
  const page=await reader.read(feed.url),items=parseFeed(page.body,page.url);
  const cutoff=now.getTime()-lookbackHours*3600_000;let queued=0,filtered=0,unchanged=0;
  store.transaction(()=>{
    for(const item of items){
      const fingerprint=hash(item),previous=store.db.prepare('SELECT fingerprint FROM feed_entries WHERE feed_url=? AND article_url=?').get(feed.url,item.url);
      if(previous?.fingerprint===fingerprint){unchanged++;continue;}
      const old=item.publishedAt&&Date.parse(item.publishedAt)<cutoff;
      const decision=cheapDecision(item.title,item.excerpt??'');
      if(old||decision.decision==='drop'){filtered++;}
      else {
        const job=store.db.prepare("SELECT state FROM jobs WHERE kind='article' AND job_key=?").get(item.url);
        // Do not overwrite archive campaign/budget ownership or wake paused jobs.
        if(!job||job.state==='done'){store.enqueue('article',item.url,{...item,discoveredBy:feed.sourceId});queued++;}
      }
      store.db.prepare('INSERT OR REPLACE INTO feed_entries VALUES(?,?,?,?)').run(feed.url,item.url,fingerprint,now.toISOString());
    }
    store.db.prepare('INSERT OR REPLACE INTO source_polls VALUES(?,?,?,?,?,?)').run(feed.url,feed.sourceId,now.toISOString(),items.length,queued,filtered);
    store.log('feed-polled',feed.sourceId,{url:feed.url,items:items.length,queued,filtered,unchanged});
  });
  return {items:items.length,queued,filtered,unchanged};
}
