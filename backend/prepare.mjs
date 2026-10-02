import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { checkedUrl } from './network.mjs';
import { normalizePlace, Geocoder,isResidentialDistrictApproximation } from './geocode.mjs';
import { eventSchema } from './contract.mjs';
import {decorativeMedia,reviewMedia} from './media-quality.mjs';
export class Preparation{
  constructor(store,{publicPath=process.env.DATABASE_PATH,geocoder=new Geocoder(store),checkUrl=checkedUrl,model}={}){this.store=store;this.publicPath=publicPath;this.geocoder=geocoder;this.checkUrl=checkUrl;this.model=model;}
  published(row){
    if(!this.publicPath||!existsSync(this.publicPath))return null;
    const db=new DatabaseSync(this.publicPath,{readOnly:true});
    try{const event=db.prepare('SELECT * FROM incidents WHERE slug=?').get(row.slug);return event?{...event,media:db.prepare('SELECT * FROM incident_media WHERE incident_id=?').all(event.id)}:null;}finally{db.close();}
  }
  async enrich(row,documents){
    const guard=()=>{if(this.store.event(row.id)?.editorial_mark==='uninteresting')throw Object.assign(new Error('Обработка события остановлена редактором'),{code:'EDITORIAL_STOP'});};
    guard();
    const event=structuredClone(row.canonical),existing=this.published(row),notes=[];
    let geocoding=null;
    if(event.location.latitude===undefined){
      const incoming=normalizePlace(event.location.label),old=normalizePlace(existing?.location_label);
      const samePlace=existing&&incoming.length>4&&(incoming===old||old.startsWith(incoming+' '));
      // Do not perpetuate a previously published arbitrary district-relation
      // point when the only context is an unnamed residential building.
      if(samePlace&&!isResidentialDistrictApproximation(event.location)&&Number.isFinite(existing.latitude)&&Number.isFinite(existing.longitude)){
        geocoding={latitude:existing.latitude,longitude:existing.longitude,precision:event.location.precision==='unknown'?'street':event.location.precision,provider:'published-card',label:existing.location_label};
      }else geocoding=await this.geocoder.locate(event.location);
      Object.assign(event.location,{latitude:geocoding.latitude,longitude:geocoding.longitude,precision:geocoding.precision});
    }else geocoding={provider:'source-or-editor',latitude:event.location.latitude,longitude:event.location.longitude,precision:event.location.precision};
    guard();
    // Text-only Flash repairs must not discard the evidence for an unchanged
    // Pro-resolved map point or reopen the same paid location search.
    const previous=this.store.db.prepare('SELECT payload FROM preparation WHERE event_id=? AND revision<=? ORDER BY revision DESC LIMIT 1').get(row.id,row.revision);
    const prior=previous?JSON.parse(previous.payload):null;
    const sameReviewedPlace=['photon-pro-reviewed','osm-geometry-pro-reviewed'].includes(prior?.geocoding?.provider)
      && prior.geocoding.latitude===event.location.latitude && prior.geocoding.longitude===event.location.longitude
      && prior.geocoding.precision===event.location.precision
      && normalizePlace(prior.geocoding.anchor.label)===normalizePlace(event.location.label);
    if(sameReviewedPlace)geocoding=prior.geocoding;
    const photoDocuments=documents.map(d=>({...d,imageUrls:d.imageUrls.filter(imageUrl=>!decorativeMedia({imageUrl}))}));
    if(!event.media.some(m=>!decorativeMedia(m))&&!existing?.media.some(m=>!decorativeMedia({imageUrl:m.image_url,caption:m.caption}))&&this.model&&photoDocuments.some(d=>d.imageUrls.length)){
      const media=await this.model.json('media',{title:event.title,summary:event.summary,documents:photoDocuments.map(d=>({id:d.id,url:d.url,title:d.title,text:d.text.slice(0,20000),imageUrls:d.imageUrls}))},{maxTokens:1600,validate:raw=>{
        const list=eventSchema.innerType().shape.media.parse(raw.media);
        if(list.length>3)throw new Error('Select at most three source photographs');
        for(const m of list){if(!documents.some(d=>d.url===m.sourceUrl&&d.imageUrls.includes(m.imageUrl)))throw new Error('Media URL was not observed');m.rights='unknown';}
        return list;
      }});
      event.media=media;
      event.evidence=event.evidence.filter(e=>!/^media\.\d+(\.|$)/.test(e.field));
      for(const [i,m] of media.entries()){const d=documents.find(d=>d.url===m.sourceUrl&&d.imageUrls.includes(m.imageUrl));event.evidence.push({field:`media.${i}.imageUrl`,documentId:d.id,quote:m.imageUrl});}
    }
    // Only source-observed images may enter new media; previously published images are preserved separately.
    const eligible=[],mediaIndexes=new Map();
    for(const [oldIndex,m] of event.media.entries()){
      guard();
      if(decorativeMedia(m)){notes.push('Фото исключено: логотип или декоративная иллюстрация');continue;}
      const observed=documents.some(d=>d.url===m.sourceUrl&&d.imageUrls.includes(m.imageUrl));
      if(!observed){notes.push('Фото исключено: ссылка не найдена в прочитанном источнике');continue;}
      try{await this.checkUrl(m.imageUrl);mediaIndexes.set(oldIndex,eligible.length);eligible.push(m);}catch{notes.push('Фото исключено: недоступный или непубличный адрес');}
    }
    event.media=eligible;
    event.evidence=event.evidence.flatMap(e=>{
      const match=e.field.match(/^media\.(\d+)(\..*)?$/);if(!match)return [e];
      const next=mediaIndexes.get(Number(match[1]));return next===undefined?[]:[{...e,field:`media.${next}${match[2]??''}`}];
    });
    let retainedMedia=existing?.media.filter(m=>!eligible.some(e=>e.imageUrl===m.image_url)).map(m=>({imageUrl:m.image_url,sourceUrl:m.source_url,outlet:m.outlet,credit:m.credit,caption:m.caption,isSensitive:Boolean(m.is_sensitive)})).filter(m=>!decorativeMedia(m))??[];
    for(const m of [...retainedMedia]){try{await this.checkUrl(m.imageUrl);}catch{retainedMedia=retainedMedia.filter(x=>x!==m);notes.push('Прежнее фото исключено: недоступный или непубличный адрес');}}
    let mediaReview=[];
    if(this.model&&(eligible.length||retainedMedia.length)){
      guard();const review=await reviewMedia(this.model,event,[...eligible,...retainedMedia],documents);guard();mediaReview=review.decisions;
      const approved=new Map(review.kept.map(m=>[m.imageUrl,m]));
      const indexMap=new Map();event.media=eligible.flatMap((m,i)=>{const value=approved.get(m.imageUrl);if(!value)return [];indexMap.set(i,indexMap.size);return [value];});
      event.evidence=event.evidence.flatMap(e=>{const match=e.field.match(/^media\.(\d+)(\..*)?$/);if(!match)return [e];const next=indexMap.get(Number(match[1]));return next===undefined?[]:[{...e,field:`media.${next}${match[2]??''}`}];});
      retainedMedia=retainedMedia.filter(m=>approved.has(m.imageUrl)).map(m=>approved.get(m.imageUrl));
      notes.push(...review.decisions.filter(r=>!r.keep).map(r=>'Фото исключено Flash: '+r.reason));
    }
    return {event,geocoding,retainedMedia,notes,mediaReview,mediaCount:event.media.length+retainedMedia.length,...(sameReviewedPlace?{locationReview:prior.locationReview}:{})};
  }
}
