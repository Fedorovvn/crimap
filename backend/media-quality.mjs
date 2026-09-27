import {z} from 'zod';
import {normalizeSignal as norm} from './triage-signals.mjs';

export function decorativeMedia(media){
  let path='';try{path=decodeURIComponent(new URL(media.imageUrl).pathname);}catch{return true;}
  const filename=norm(path.split('/').pop());
  return /(?:^|[-_. ])(?:logo|favicon|placeholder|no[-_]?image|default[-_]?image|banner|advert|illusztracio|stock)(?:[-_. \d]|$)/.test(filename)
    || /(?:police|rendorseg|brfk|orfk)[-_ ]?(?:logo|cimer)|(?:logo|cimer)[-_ ]?(?:police|rendorseg|brfk|orfk)/.test(filename)
    || /^(?:police logo|police emblem|police badge|logo of|illustration\b|stock (?:photo|image)|rendorseg log|rendorseg cimer|illusztracio\b|логотип|герб полиции|иллюстрация\b)/.test(norm(media.caption));
}
const categories=['scene','cctv','evidence','wanted','portrait','map','document','logo','stock','advert','unrelated','unclear'];
const rejected=new Set(['logo','stock','advert','unrelated','unclear']);
const schema=z.object({images:z.array(z.object({index:z.number().int().min(0),keep:z.boolean(),category:z.enum(categories),reason:z.string().min(1).max(500),sensitive:z.boolean()}).strict()).max(3)}).strict();

export async function reviewMedia(model,event,candidates,documents){
  const kept=[],decisions=[];
  for(let offset=0;offset<candidates.length;offset+=3){
    const batch=candidates.slice(offset,offset+3);
    const result=await model.json('media-review',{
      incident:{title:event.title,summary:event.summary,location:event.location.label},
      candidates:batch.map((m,index)=>{const d=documents.find(d=>d.url===m.sourceUrl);return {index,imageUrl:m.imageUrl,sourceUrl:m.sourceUrl,caption:m.caption,credit:m.credit,sourceTitle:d?.title,sourceText:d?.text.slice(0,2500),sourceHash:d?.contentHash};}),
    },{images:batch.map(m=>m.imageUrl),maxTokens:650,validate:raw=>{
      const r=schema.parse(raw);
      if(r.images.length!==batch.length||new Set(r.images.map(x=>x.index)).size!==batch.length||r.images.some(x=>x.index>=batch.length||x.keep&&rejected.has(x.category)))throw new Error('Every image needs one valid usefulness decision');
      return r.images;
    }});
    for(const r of result){const m=batch[r.index];decisions.push({imageUrl:m.imageUrl,...r});if(r.keep)kept.push({...m,isSensitive:m.isSensitive||r.sensitive});}
  }
  return {kept,decisions};
}
