import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { canonicalUrl } from './network.mjs';
export const catalog=JSON.parse(readFileSync(new URL('./source-catalog.json',import.meta.url),'utf8')).sources;
const owner=host=>host.replace(/^www\./,'');
export function sourceFor(url){
  const host=new URL(url).hostname;
  const source=catalog.find(s=>[s.url,...(s.feeds??[]).map(f=>f.url)].some(u=>owner(new URL(u).hostname)===owner(host)));
  return source?{...source,kind:source.group==='official'?'official':source.group==='media'?'media':'community',independenceGroup:owner(host)}:null;
}
export const LIVE_SOURCE_IDS=['police-brfk','police-national','okf-events','prosecution','kekvillogo','bpiautosok','mavinform','telex','index'];
export function feeds(ids=LIVE_SOURCE_IDS){
  return catalog.filter(s=>ids.includes(s.id)).flatMap(s=>(s.feeds??[]).map(f=>({url:f.url,sourceId:s.id,intervalSeconds:3600})));
}
export function parseFeed(body,base){
  if(/<!DOCTYPE/i.test(body))throw new Error('Feed DTD is not accepted');
  const dom=new JSDOM(body,{contentType:'text/xml'}), doc=dom.window.document;
  try{return [...doc.querySelectorAll('item,entry')].map(item=>{
    const link=item.querySelector('link[rel="alternate"]')??item.querySelector('link');
    const raw=link?.getAttribute('href')??link?.textContent;
    if(!raw)return null;const url=canonicalUrl(new URL(raw.trim(),base).href);
    const date=item.querySelector('pubDate,published,updated')?.textContent?.trim();
    const excerpt=JSDOM.fragment(item.querySelector('description,summary')?.textContent??'').textContent.trim().slice(0,4000);
    return {url,title:item.querySelector('title')?.textContent?.trim()??'',excerpt,publishedAt:date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null};
  }).filter(x=>x&&sourceFor(x.url));}finally{dom.window.close();}
}
export function parseArticle(page){
  const dom=new JSDOM(page.body,{url:page.url}),d=dom.window.document;
  try{
    const title=(d.querySelector('meta[property="og:title"]')?.getAttribute('content')??d.querySelector('h1')?.textContent??d.title).trim();
    const published=d.querySelector('meta[property="article:published_time"],meta[name="date"]')?.getAttribute('content')??d.querySelector('time[datetime]')?.getAttribute('datetime');
    const language=d.documentElement.lang?.split('-')[0]||'hu';
    d.querySelectorAll('script,style,nav,header,footer,aside,form,noscript,iframe,.related-posts,.jp-relatedposts,.sharedaddy').forEach(n=>n.remove());
    const article=d.querySelector('article .field-name-body,article .field--name-body,article .entry-content')??d.querySelector('article,.field-name-body,main')??d.body;
    const imageUrls=[...new Set([...d.querySelectorAll('meta[property="og:image"]')].map(n=>n.getAttribute('content')).concat([...article.querySelectorAll('img')].map(n=>n.getAttribute('src'))).filter(Boolean).map(u=>{try{return new URL(u,page.url).href;}catch{return null;}}).filter(u=>u&&/^https?:/.test(u)))].slice(0,20);
    article.querySelectorAll('p,div,br,li,h1,h2,h3').forEach(n=>{n.append('\n');});
    const imageDescriptions=[...article.querySelectorAll('img[alt]')].filter(n=>n.getAttribute('alt')?.trim()).slice(0,10).map(n=>`${n.getAttribute('src')??''}: ${n.getAttribute('alt')}`).join('\n');
    const text=(title+'\n'+article.textContent+(imageDescriptions?'\nImage descriptions from source HTML:\n'+imageDescriptions:'')).replace(/[\t ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
    if(text.length<80)throw new Error('Article text is empty or inaccessible');
    // Reject truncation instead of extracting facts from an incomplete article.
    if(text.length>65000)throw new Error('Article exceeds extraction limit; needs a specific adapter');
    return {text,title,imageUrls,language,publishedAt:published&&Number.isFinite(Date.parse(published))?new Date(published).toISOString():null};
  }finally{dom.window.close();}
}
