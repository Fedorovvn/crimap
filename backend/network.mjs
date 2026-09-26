import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import { isIP } from 'node:net';

export function publicAddress(ip){
  if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0);}
  // Require globally routed IPv6 unicast; mapped IPv4 and local ranges fail closed.
  return isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip)&&!/^2002:|^2001:(0*db8|0{1,4}|0*10|0*20):/i.test(ip);
}
export async function checkedUrl(value,lookup=dns.lookup){
  const u=new URL(value);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))throw new Error('Unsafe URL');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw new Error('Private or reserved address refused');
  return {url:u,address:addresses[0]};
}
export async function requestPage(value,{headers={},maxBytes=3_000_000,redirects=4,timeout=20000,beforeRedirect}={}){
  const {url,address}=await checkedUrl(value);
  const response=await new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).request(url,{method:'GET',headers:{'User-Agent':'CrimapCollector/1.0 (+https://crimap.online/)','Accept':'text/html,application/rss+xml,application/atom+xml,application/xml,text/plain','Accept-Encoding':'identity',...headers},lookup:(_host,opts,cb)=>opts?.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{
      const chunks=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){res.destroy(new Error('Source response exceeds limit'));return;}chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8'),url:url.href}));res.on('error',reject);
    });
    req.setTimeout(timeout,()=>req.destroy(new Error('Source request timed out')));req.on('error',reject);req.end();
  });
  if([301,302,303,307,308].includes(response.status)){
    if(!redirects||!response.headers.location)throw new Error('Redirect limit reached');
    // Re-check DNS and destination for every redirect; do not forward credentials.
    const destination=new URL(response.headers.location,url).href;
    if(beforeRedirect)await beforeRedirect(destination);
    return requestPage(destination,{maxBytes,redirects:redirects-1,timeout,beforeRedirect});
  }
  return response;
}
export function canonicalUrl(value){const u=new URL(value);u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;}

export function robotsAllowed(body,path,userAgent='crimapcollector'){
  const groups=[];let current=null,hasRules=false;
  for(const raw of body.split(/\r?\n/)){const line=raw.replace(/#.*$/,'').trim();const sep=line.indexOf(':');if(sep<0)continue;const key=line.slice(0,sep).toLowerCase(),value=line.slice(sep+1).trim();
    if(key==='user-agent'){if(!current||hasRules){current={agents:[],rules:[]};groups.push(current);hasRules=false;}current.agents.push(value.toLowerCase());}
    else if(current&&['allow','disallow'].includes(key)){hasRules=true;if(value)current.rules.push({allow:key==='allow',path:value});}
  }
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&userAgent.includes(a))),chosen=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  const matches=chosen.flatMap(g=>g.rules).filter(r=>new RegExp('^'+r.path.split('*').map(p=>p.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$')).test(path));
  matches.sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
export class Reader {
  constructor(store,{request=requestPage,minDelayMs=1200}={}){this.store=store;this.request=request;this.minDelayMs=minDelayMs;this.robots=new Map();this.last=new Map();}
  async allowed(url){
    url=canonicalUrl(url);const u=new URL(url);let robots=this.robots.get(u.origin);
    if(!robots||robots.expires<Date.now()){
      const r=await this.request(u.origin+'/robots.txt',{maxBytes:256000});
      if(r.status!==404&&r.status!==410&&r.status!==200)throw new Error(`robots.txt unavailable (${r.status})`);
      robots={body:r.status===200?r.body:'',expires:Date.now()+3600_000};this.robots.set(u.origin,robots);
    }
    if(!robotsAllowed(robots.body,u.pathname+u.search))throw new Error('Disallowed by robots.txt');
    const wait=(this.last.get(u.origin)??0)+this.minDelayMs-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));this.last.set(u.origin,Date.now());
  }
  async read(url,{json=false}={}){
    url=canonicalUrl(url);await this.allowed(url);
    const cached=this.store.db.prepare('SELECT * FROM http_cache WHERE url=?').get(url);const headers={};
    if(cached?.etag)headers['If-None-Match']=cached.etag;if(cached?.last_modified)headers['If-Modified-Since']=cached.last_modified;
    const r=await this.request(url,{headers,beforeRedirect:destination=>this.allowed(destination)});
    if(r.status===304&&cached)return {url,body:cached.body,contentType:cached.content_type,unchanged:true};
    if(r.status!==200){const e=new Error(`Source HTTP ${r.status}`);e.retryAfter=Number(r.headers['retry-after'])||0;throw e;}
    const type=String(r.headers['content-type']??'');if(!/html|xml|text\/plain/i.test(type)&&!(json&&/application\/json/i.test(type)))throw new Error('Unsupported source content type');
    this.store.db.prepare(`INSERT INTO http_cache(url,etag,last_modified,body,content_type,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,last_modified=excluded.last_modified,body=excluded.body,content_type=excluded.content_type,fetched_at=excluded.fetched_at`).run(url,r.headers.etag??null,r.headers['last-modified']??null,r.body,type,new Date().toISOString());
    return {url:r.url,body:r.body,contentType:type,unchanged:cached?.body===r.body};
  }
}
