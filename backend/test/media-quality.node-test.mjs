import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {DeepSeek} from '../model.mjs';
import {Preparation} from '../prepare.mjs';
import {decorativeMedia,reviewMedia} from '../media-quality.mjs';
const photo=(name,caption='Scene photograph')=>({imageUrl:'https://www.police.hu/'+name,sourceUrl:'https://www.police.hu/news',caption,credit:'Police',outlet:'Police',isSensitive:false,rights:'unknown'});
const event={title:'Robbery in Budapest',summary:'A shop was robbed.',location:{label:'Budapest',precision:'city',latitude:47.5,longitude:19.05},media:[],evidence:[]};
test('obvious logos and placeholders are rejected free, real photos with a watermark are retained for vision',()=>{
 for(const m of [photo('police-logo.jpg'),photo('placeholder.png'),photo('123.jpg','Police logo'),photo('illusztracio-2.jpg')])assert.equal(decorativeMedia(m),true);
 assert.equal(decorativeMedia(photo('scene-123.jpg','Police car at the scene, with the publisher watermark')),false);
});
test('Flash receives actual low-detail image inputs; reserves image tokens, records usage and caches the result',async()=>{
 const s=new Store(':memory:');let calls=0;
 try{const model=new DeepSeek(s,{key:'fixture',budget:1,fetcher:async(_url,options)=>{
  calls++;const request=JSON.parse(options.body),blocks=request.messages[1].content;
  assert.equal(request.model,'deepseek-flash');assert.equal(blocks[0].type,'text');assert.equal(blocks[1].image_url.detail,'low');assert.equal(blocks[1].image_url.url,photo('123.jpg').imageUrl);
  assert.ok(s.db.prepare('SELECT reserved_usd FROM usage ORDER BY id DESC').get().reserved_usd>=1024*.3/1e6);
  return {ok:true,json:async()=>({usage:{prompt_tokens:1200,completion_tokens:60},choices:[{finish_reason:'stop',message:{content:JSON.stringify({images:[{index:0,keep:false,category:'logo',reason:'Герб полиции',sensitive:false}]})}}]})};
 }});
 const a=await reviewMedia(model,event,[photo('123.jpg')],[]);assert.equal(a.kept.length,0);
 await reviewMedia(model,event,[photo('123.jpg')],[]);assert.equal(calls,1);assert.equal(s.db.prepare('SELECT input_tokens FROM usage').get().input_tokens,1200);
 }finally{s.close();}
});
test('vision cannot bypass an exhausted archive allowance',async()=>{
 const s=new Store(':memory:');try{
  s.db.prepare("INSERT INTO campaigns(id,from_date,to_date,budget_usd,state,created_at) VALUES('archive','a','b',0.00001,'running','2026-09-27')").run();
  const model=new DeepSeek(s,{key:'fixture',fetcher:async()=>{throw new Error('No paid call expected');}});model.campaignId='archive';
  await assert.rejects(reviewMedia(model,event,[photo('123.jpg')],[]),/Campaign model budget reached/);
 }finally{s.close();}
});
test('preparation removes decorative and visually useless images, remaps evidence and preserves useful sensitivity',async()=>{
 const s=new Store(':memory:');try{
  const media=[photo('police-logo.jpg'),photo('generic.jpg'),photo('scene.jpg')];
  const e={...event,media,evidence:media.map((m,i)=>({field:`media.${i}.imageUrl`,documentId:'1',quote:m.imageUrl}))};
  const model={json:async(stage,payload,{images,validate})=>{
   assert.equal(stage,'media-review');assert.equal(images.length,2);assert.ok(!images.includes(media[0].imageUrl));
   return validate({images:[{index:0,keep:false,category:'stock',reason:'Общая иллюстрация',sensitive:false},{index:1,keep:true,category:'scene',reason:'Место происшествия',sensitive:true}]});
  }};
  const p=new Preparation(s,{model,checkUrl:async()=>{}});const result=await p.enrich({id:1,revision:1,canonical:e},[{id:'1',url:media[0].sourceUrl,text:'Photographs from the scene.',imageUrls:media.map(m=>m.imageUrl)}]);
  assert.deepEqual(result.event.media.map(m=>m.imageUrl),[media[2].imageUrl]);assert.equal(result.event.media[0].isSensitive,true);
  assert.deepEqual(result.event.evidence,[{field:'media.0.imageUrl',documentId:'1',quote:media[2].imageUrl}]);assert.equal(result.mediaCount,1);
 }finally{s.close();}
});
test('missing, duplicated or contradictory usefulness decisions are rejected',async()=>{
 for(const decision of [[],[{index:0,keep:true,category:'logo',reason:'No',sensitive:false}],Array(2).fill({index:0,keep:true,category:'scene',reason:'Yes',sensitive:false})]){
  await assert.rejects(reviewMedia({json:async(_s,_p,{validate})=>validate({images:decision})},event,[photo('1.jpg')],[]));
 }
});

