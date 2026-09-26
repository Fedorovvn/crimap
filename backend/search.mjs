import { hash } from './store.mjs';
import { sourceFor } from './sources.mjs';
export class Search {
  constructor(store,{key=process.env.BRAVE_SEARCH_API_KEY,limit=Number(process.env.SEARCH_DAILY_LIMIT??50),fetcher=fetch}={}){this.store=store;this.key=key;this.limit=limit;this.fetcher=fetcher;}
  async query(query){
    if(!this.key)return {available:false,reason:'Search API key is not configured',results:[]};
    if(typeof query!=='string'||query.length>600||query.split(/\s+/).length>75)throw new Error('Search query too long');
    const key=hash(query),cached=this.store.db.prepare('SELECT result FROM search_cache WHERE cache_key=? AND expires_at>?').get(key,new Date().toISOString());
    if(cached)return JSON.parse(cached.result);
    this.store.transaction(()=>{
      const n=this.store.db.prepare("SELECT count(*) AS n FROM audit WHERE action='search-call' AND created_at>=?").get(new Date().toISOString().slice(0,10)).n;
      if(n>=this.limit)throw new Error('Daily search limit reached');this.store.log('search-call',key,{query});
    });
    const url=new URL('https://api.search.brave.com/res/v1/web/search');url.search=new URLSearchParams({q:query,count:'8',search_lang:'hu',country:'HU'}).toString();
    const r=await this.fetcher(url,{headers:{'X-Subscription-Token':this.key,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw new Error(`Search HTTP ${r.status}`);
    const data=await r.json(),result={available:true,results:(data.web?.results??[]).filter(x=>{try{return !!sourceFor(x.url);}catch{return false;}}).map(x=>({url:x.url,title:x.title,description:x.description})).slice(0,6)};
    this.store.db.prepare('INSERT OR REPLACE INTO search_cache VALUES(?,?,?)').run(key,JSON.stringify(result),new Date(Date.now()+5*60000).toISOString());return result;
  }
}
