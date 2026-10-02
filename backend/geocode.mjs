import { requestPage } from './network.mjs';
import { hash } from './store.mjs';
import {surfaceCandidates} from './map-surfaces.mjs';
import {readFileSync} from 'node:fs';
const institutions=JSON.parse(readFileSync(new URL('./institution-addresses.json',import.meta.url),'utf8'));
export const normalizePlace=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
// A district boundary relation often has an arbitrary label coordinate (for
// example, on a rural road at the edge of a large district).  When the source
// tells us only that an unnamed apartment building is involved, a point in an
// urban residential part of that district is a more honest visual
// approximation. It is still deliberately kept at district precision.
export const isResidentialDistrictApproximation=location=>location?.precision==='district'&&/\b(apartment|apartments|residential|tarsashaz|lako(?:haz|epulet)|lakas|многоквартир|жил(?:ой|ая)?\s+дом|квартир)/i.test(normalizePlace(location.label));
const romans=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII'];
export function districtNumber(s){const m=String(s??'').match(/(?:^|\b)([IVX]+|\d{1,2})\.?\s*(?:ker|district|[·(—-]|$)/i);if(!m)return null;const n=/^\d+$/.test(m[1])?Number(m[1]):romans.indexOf(m[1].toUpperCase())+1;return n>=1&&n<=23?n:null;}
const bounds=(lat,lon)=>Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=47.34&&lat<=47.62&&lon>=18.92&&lon<=19.34;
const normalizedStreet=s=>normalizePlace(s).replace(/\bbudapest\b/g,'').replace(/\b\d+[a-z]?\b/g,'').replace(/\s+/g,' ').trim();
export function choosePlace(features,location,mode='address'){
  const district=districtNumber(location.district),label=normalizePlace(location.label),street=normalizedStreet(location.label);
  const candidates=[];
  for(const f of features??[]){
    const p=f.properties??{},[lon,lat]=f.geometry?.coordinates??[];
    if(!bounds(lat,lon)||String(p.countrycode).toUpperCase()!=='HU')continue;
    if(![p.city,p.state,p.name].some(n=>normalizePlace(n)==='budapest'))continue;
    const candidateDistrict=/^1\d{3}$/.test(p.postcode??'')?Number(p.postcode.slice(1,3)):districtNumber(p.district);
    if(district&&candidateDistrict&&candidateDistrict!==district)continue;
    let precision,score=0;
    const place=normalizePlace(p.name),road=normalizedStreet(p.street??(p.osm_key==='highway'?p.name:''));
    if(mode==='city'){
      if(place!=='budapest'||!['city','administrative'].includes(p.osm_value))continue;
      precision='city';score=1;
    }else if(mode==='district'){
      const expected=normalizePlace(location.district);
      if(!expected||p.housenumber||p.street||p.osm_key==='highway')continue;
      if(!(district&&districtNumber(p.name)===district)&&!(place.length>4&&expected.includes(place)))continue;
      precision='district';score=2;
    }else{
      // A same-named shop, subway station or information board is not a street.
      if(p.osm_key!=='highway'&&!p.housenumber)continue;
      const roadMatch=street&&road&&(street===road||street.endsWith(' '+road)||street.startsWith(road+' '));
      const placeMatch=place.length>4&&(label===place||label.startsWith(place+' '));
      if(!roadMatch&&!placeMatch)continue;
      // An intersection must match both street names. A result for one street is not the junction.
      if(/keresztez|intersection|\s[–&]\s/i.test(location.label))continue;
      const range=String(p.housenumber??'').match(/^(\d+)\s*[-–]\s*(\d+)$/),number=location.label.match(/\b(\d+)\s*$/)?.[1];
      const house=p.housenumber&&(new RegExp('(?:^| )'+normalizePlace(p.housenumber).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: |$)').test(label)||range&&number&&Number(range[2])-Number(range[1])<=10&&Number(number)>=Number(range[1])&&Number(number)<=Number(range[2]));
      precision=location.precision==='exact'&&house?'exact':'street';
      score=(house?20:10)+(district&&candidateDistrict===district?5:0);
    }
    candidates.push({latitude:lat,longitude:lon,precision,score,district:candidateDistrict,
      provider:'photon',label:p.name??p.street??location.label,
      sourceUrl:`https://www.openstreetmap.org/${({N:'node',W:'way',R:'relation'})[p.osm_type]??'node'}/${p.osm_id}`});
  }
  candidates.sort((a,b)=>b.score-a.score);
  if(!candidates.length)return null;
  const top=candidates.filter(c=>c.score===candidates[0].score);
  if(mode==='address'&&new Set(top.map(c=>c.district).filter(Boolean)).size>1)return null;
  if(mode==='address'&&top.length>1&&top.some(c=>Math.hypot(c.latitude-top[0].latitude,(c.longitude-top[0].longitude)*.68)>.025))return null;
  const {score,district:ignored,...result}=top[0];return result;
}
export class Geocoder{
  constructor(store,{request=requestPage,endpoint=process.env.GEOCODER_URL??'https://photon.komoot.io/api/',delayMs=16000}={}){this.store=store;this.request=request;this.endpoint=endpoint;this.delayMs=delayMs;}
  async query(q){
    const key=hash({endpoint:this.endpoint,q});const cached=this.store.db.prepare('SELECT payload FROM geocode_cache WHERE query_key=?').get(key);if(cached)return JSON.parse(cached.payload);
    const now=Date.now();const wait=this.store.transaction(()=>{
      const next=Math.max(now,this.store.db.prepare("SELECT next_at FROM service_limits WHERE service='geocoder'").get()?.next_at??0);
      this.store.db.prepare("INSERT OR REPLACE INTO service_limits VALUES('geocoder',?)").run(next+this.delayMs);
      this.store.log('geocode-request',key,{query:q});return next-now;
    });
    if(wait>0)await new Promise(r=>setTimeout(r,wait));
    const url=new URL(this.endpoint);for(const [k,v] of Object.entries({q,limit:'8',countrycode:'HU',bbox:'18.92,47.34,19.34,47.62'}))url.searchParams.set(k,v);
    const res=await this.request(url.href,{headers:{Accept:'application/json'},maxBytes:500000});
    if(res.status!==200)throw new Error('Geocoder HTTP '+res.status);
    const data=JSON.parse(res.body);if(!Array.isArray(data.features))throw new Error('Invalid geocoder response');
    this.store.db.prepare('INSERT OR REPLACE INTO geocode_cache VALUES(?,?,?)').run(key,JSON.stringify(data.features),new Date().toISOString());return data.features;
  }
  async landmarks(anchor, location) {
    const known=institutions.find(p=>normalizePlace(anchor.quote).includes(normalizePlace(p.name))&&new RegExp(p.rolePattern).test(normalizePlace(anchor.quote))&&normalizePlace(anchor.label).includes(normalizePlace(p.name)));
    if(known){
      // Addresses come from a curated official directory, not model memory.
      // Re-read the page before proposing this relation to the Pro reviewer.
      const page=await this.request(known.sourceUrl,{maxBytes:1500000});
      const plain=normalizePlace(String(page.body??'').replace(/<[^>]*>/g,' '));
      if(page.status===200&&plain.includes(normalizePlace(known.address))){
        const features=await this.query(`${known.address}, Budapest`);
        const named=features.filter(f=>normalizePlace(f.properties?.name).startsWith(normalizePlace(known.name)));
        const found=choosePlace(named.length?named:features,{label:known.address,district:known.district,precision:'exact'});
        if(found&&found.precision==='exact'){
          const candidate={...found,precision:'landmark',label:`${known.name}, ${known.address}`,officialReference:known};
          return [{...candidate,id:hash(candidate).slice(0,20)}];
        }
      }
    }
    const mapLabel=anchor.mapQuery??anchor.streets?.[0]??anchor.label;
    const features = await this.query(`${mapLabel}, ${location.district??''}, Budapest`);
    const mappedTramStop=anchor.kind==='stop'&&anchor.surface==='tram'&&features.some(f=>f.properties?.osm_value==='tram_stop');
    if(!mappedTramStop&&(anchor.kind==='intersection'||['road','tram','rail','waterfront'].includes(anchor.surface))){
      const seeds=anchor.surface==='rail'?[...features].sort((a,b)=>Number(['station','train_station','halt'].includes(b.properties?.osm_value))-Number(['station','train_station','halt'].includes(a.properties?.osm_value))):features;
      const seed=seeds.find(f=>{
        const p=f.properties??{},[lon,lat]=f.geometry?.coordinates??[];
        const names=[p.name,p.street].map(normalizePlace),label=normalizePlace(mapLabel);
        const district=districtNumber(location.district),candidateDistrict=/^1\d{3}$/.test(p.postcode??'')?Number(p.postcode.slice(1,3)):districtNumber(p.district);
        return bounds(lat,lon)&&String(p.countrycode).toUpperCase()==='HU'&&[p.city,p.state].some(v=>normalizePlace(v)==='budapest')&&(!district||!candidateDistrict||district===candidateDistrict)&&names.some(name=>name.length>4&&(label.includes(name)||name.startsWith(label)));
      });
      if(seed){
        const [longitude,latitude]=seed.geometry.coordinates;
        const places=surfaceCandidates(await this.mapAround({latitude,longitude}),anchor,{latitude,longitude});
        if(places.length)return places.map(c=>({...c,id:hash(c).slice(0,20)}));
      }
      // Do not fall back to a namesake of the wrong surface type.
      return [];
    }
    if (['street','address'].includes(anchor.kind)) {
      const found = choosePlace(features, {...location,label:mapLabel,precision:anchor.kind==='address'?'exact':'street'});
      return found ? [{...found,id:hash(found).slice(0,20)}] : [];
    }
    const label = normalizePlace(mapLabel), district = districtNumber(location.district);
    const candidates = [];
    for (const f of features) {
      const p=f.properties??{}, [longitude,latitude]=f.geometry?.coordinates??[];
      if (!bounds(latitude,longitude) || String(p.countrycode).toUpperCase()!=='HU') continue;
      if (![p.city,p.state].some(s=>normalizePlace(s)==='budapest')) continue;
      const name=normalizePlace(p.name), foundDistrict=/^1\d{3}$/.test(p.postcode??'')?Number(p.postcode.slice(1,3)):districtNumber(p.district);
      if (district && foundDistrict && district!==foundDistrict) continue;
      if (!(name===label || name.startsWith(label+' ') || label.startsWith(name+' ') && name.length>4)) continue;
      if(p.osm_key==='tourism'&&['information','board','map','guidepost'].includes(p.osm_value))continue;
      if(['board','map','guidepost'].includes(p.osm_value))continue;
      if (anchor.kind==='stop' && !['tram_stop','bus_stop','stop_position','platform','station','halt','stop_area'].includes(p.osm_value)) continue;
      if(anchor.surface==='tram'&&p.osm_value!=='tram_stop')continue;
      if (anchor.kind==='landmark' && ['highway','boundary'].includes(p.osm_key)) continue;
      if (!['N','W','R'].includes(p.osm_type) || !/^\d+$/.test(String(p.osm_id))) continue;
      const candidate={latitude,longitude,precision:'landmark',provider:'photon',label:p.name,district:foundDistrict,
        placeType:p.osm_value,street:p.street??null,postcode:p.postcode??null,
        sourceUrl:`https://www.openstreetmap.org/${{N:'node',W:'way',R:'relation'}[p.osm_type]}/${p.osm_id}`};
      candidates.push({...candidate,id:hash(candidate).slice(0,20)});
    }
    return candidates.slice(0,8);
  }
  async mapAround(center){
    const lat=Number(center.latitude.toFixed(3)),lon=Number(center.longitude.toFixed(3));
    const key=hash({service:'osm-surface-v1',lat,lon});
    const cached=this.store.db.prepare('SELECT payload FROM geocode_cache WHERE query_key=?').get(key);if(cached)return JSON.parse(cached.payload);
    const now=Date.now();
    const wait=this.store.transaction(()=>{
      const next=Math.max(now,this.store.db.prepare("SELECT next_at FROM service_limits WHERE service='geocoder'").get()?.next_at??0);
      this.store.db.prepare("INSERT OR REPLACE INTO service_limits VALUES('geocoder',?)").run(next+this.delayMs);this.store.log('geocode-request',key,{service:'osm-surfaces',center});return next-now;
    });
    if(wait>0)await new Promise(r=>setTimeout(r,wait));
    const bbox=[lon-.007,lat-.005,lon+.007,lat+.005].join(',');
    const response=await this.request(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,{headers:{Accept:'application/json'},maxBytes:12000000});
    if(response.status!==200)throw new Error('OSM geometry HTTP '+response.status);
    const data=JSON.parse(response.body);if(!Array.isArray(data.elements))throw new Error('Invalid OSM geometry response');
    this.store.db.prepare('INSERT OR REPLACE INTO geocode_cache VALUES(?,?,?)').run(key,JSON.stringify(data.elements),new Date().toISOString());return data.elements;
  }
  async residentialDistrict(location){
    if(!isResidentialDistrictApproximation(location))return null;
    const district=districtNumber(location.district);
    if(!district)return null;
    const features=await this.query(`${location.district} apartment building, Budapest`);
    const center={latitude:47.4979,longitude:19.0402};
    const candidates=[];
    for(const f of features){
      const p=f.properties??{},[longitude,latitude]=f.geometry?.coordinates??[];
      const candidateDistrict=/^1\d{3}$/.test(p.postcode??'')?Number(p.postcode.slice(1,3)):districtNumber(p.district);
      const residential=(p.osm_key==='building'&&/apartments?|residential/.test(p.osm_value??''))
        ||(p.osm_key==='tourism'&&p.osm_value==='apartment')
        ||(p.osm_key==='landuse'&&p.osm_value==='residential');
      if(!residential||candidateDistrict!==district||!bounds(latitude,longitude))continue;
      candidates.push({latitude,longitude,distance:Math.hypot(latitude-center.latitude,(longitude-center.longitude)*.68),sourceUrl:`https://www.openstreetmap.org/${({N:'node',W:'way',R:'relation'})[p.osm_type]??'node'}/${p.osm_id}`});
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    const point=candidates[0];
    return point&&{latitude:point.latitude,longitude:point.longitude,precision:'district',provider:'photon-residential-district',label:location.label,sourceUrl:point.sourceUrl,approximation:'Точный дом не раскрыт; показана жилая часть указанного района'};
  }
  async locate(location){
    if(['exact','street','landmark'].includes(location.precision)){
      const found=choosePlace(await this.query(`${location.label}, ${location.district??''}, Budapest`),location);
      if(found)return found;
    }
    if(location.district){
      const residential=await this.residentialDistrict(location);
      if(residential)return residential;
      const found=choosePlace(await this.query(`${location.district}, Budapest`),location,'district');
      if(found)return {...found,approximation:'Адрес не удалось однозначно сопоставить; показан район'};
    }
    const city=choosePlace(await this.query('Budapest'),location,'city');
    if(!city)throw new Error('Geocoder could not establish Budapest location');
    return {...city,approximation:'Точное место не установлено; показан город'};
  }
}
