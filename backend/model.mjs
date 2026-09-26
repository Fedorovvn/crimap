import { readFileSync } from 'node:fs';
import { hash } from './store.mjs';
export function parseJsonResponse(content){
  try{return JSON.parse(content);}catch(original){
    // Some JSON-mode responses contain redundant closing braces after a complete
    // object. Recover only that narrow syntax error; never accept another object,
    // prose, executable code or a truncated structure.
    let depth=0,quoted=false,escaped=false,end=-1;
    if(!content.trimStart().startsWith('{'))throw original;
    for(let i=0;i<content.length;i++){const c=content[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0){end=i+1;break;}}}
    if(end<0||!/^\s*\}+\s*$/.test(content.slice(end)))throw original;
    return JSON.parse(content.slice(0,end));
  }
}
export class DeepSeek {
  constructor(store,{key=process.env.DEEPSEEK_API_KEY,model=process.env.DEEPSEEK_MODEL??'deepseek-flash',budget=Number(process.env.MODEL_DAILY_BUDGET_USD??'0.50'),fetcher=fetch}={}){
    if(!Number.isFinite(budget)||budget<=0)throw new Error('Invalid model budget');
    this.store=store;this.key=key;this.model=model;this.budget=budget;this.fetcher=fetcher;
  }
  async json(stage,payload,{maxTokens=8192,validate=x=>x}={}){
    if(this.model==='deepseek-v4-pro'&&stage!=='review')throw new Error('Pro is reserved for final publication review');
    if(!this.key)throw new Error('DEEPSEEK_API_KEY is not configured');
    const instruction=readFileSync(new URL(`./prompts/${stage}.md`,import.meta.url),'utf8');
    const prompt=/\bjson\b/i.test(instruction)?instruction:'Return valid JSON only.\n'+instruction;
    const content=JSON.stringify(payload);if(content.length>160000)throw new Error('Model input exceeds limit');
    const cacheKey=hash({stage,prompt,content,model:this.model});
    const cached=this.store.db.prepare('SELECT payload FROM model_cache WHERE cache_key=?').get(cacheKey);
    if(cached){try{return validate(JSON.parse(cached.payload));}catch{this.store.db.prepare('DELETE FROM model_cache WHERE cache_key=?').run(cacheKey);}}
    // Conservative peak tariff; cache discounts can only reduce this estimate.
    const prices=this.model==='deepseek-flash'?{input:.30,output:1.20}:this.model==='deepseek-v4-pro'?{input:1.32,output:3.96}:null;
    if(!prices)throw new Error('Model has no configured spending tariff');
    let feedback='';
    for(let attempt=0;attempt<2;attempt++){
    const reserve=(Buffer.byteLength(prompt+content+feedback)*prices.input+maxTokens*prices.output)/1e6;
    const id=this.store.reserveCost(stage,this.model,cacheKey,reserve,this.budget,new Date().toISOString(),this.campaignId??null);
    try{
      const r=await this.fetcher('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,thinking:{type:'disabled'},messages:[{role:'system',content:prompt+feedback},{role:'user',content}],response_format:{type:'json_object'},max_tokens:maxTokens,temperature:0}),signal:AbortSignal.timeout(90000)});
      if(!r.ok){let detail='';try{const body=await r.json();detail=String(body.error?.message??'').replaceAll(this.key,'[REDACTED]').slice(0,300);}catch{}const e=new Error(`DeepSeek HTTP ${r.status}${detail?': '+detail:''}`);e.retryAfter=Number(r.headers.get('retry-after'))||0;throw e;}
      const data=await r.json(),usage=data.usage;
      if(usage)this.store.usageDone(id,usage.prompt_tokens??0,usage.completion_tokens??0,((usage.prompt_tokens??0)*prices.input+(usage.completion_tokens??0)*prices.output)/1e6);
      if(data.choices?.[0]?.finish_reason!=='stop')throw new Error('Model response incomplete');
      let result;
      try{result=validate(parseJsonResponse(data.choices[0].message.content));}
      catch(e){this.store.log('model-validation-failure',cacheKey,{stage,error:e.message,response:data.choices[0].message.content.slice(0,30000)});if(attempt===1){e.validationFailure=true;throw e;}feedback='\nYour previous response failed server validation. Generate a fresh corrected JSON response. Validation error: '+e.message.slice(0,3000);continue;}
      this.store.db.prepare('INSERT OR REPLACE INTO model_cache VALUES(?,?,?)').run(cacheKey,JSON.stringify(result),new Date().toISOString());
      return result;
    }catch(e){this.store.usageFailed(id,e.message);throw e;}
    }
  }
}
