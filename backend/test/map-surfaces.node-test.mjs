import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceCandidates,retainLocationCoordinates} from '../map-surfaces.mjs';
import {choosePlace,Geocoder} from '../geocode.mjs';
import {Store} from '../store.mjs';
const center={latitude:47.5,longitude:19.07};
const nodes=[{type:'node',id:1,lat:47.499,lon:19.071},{type:'node',id:2,lat:47.501,lon:19.071},{type:'node',id:3,lat:47.501,lon:19.072}];
test('text repair cannot keep stale coordinates after changing the address or invent a new point',()=>{
 const old={city:'Budapest',label:'Soroksári út 117',precision:'exact',latitude:47.44,longitude:19.09};
 assert.equal(retainLocationCoordinates(old,{...old,label:'Soroksári út 160'}).latitude,undefined);
 assert.equal(retainLocationCoordinates(old,{...old,latitude:0,longitude:0}).latitude,old.latitude);
});
test('surface candidates lie on the requested named road, never an unrelated nearest road',()=>{
 const ways=[{type:'way',id:1,nodes:[1,2],tags:{highway:'primary',name:'Soroksári út'}},{type:'way',id:2,nodes:[2,3],tags:{highway:'residential',name:'Other utca'}}];
 const found=surfaceCandidates([...nodes,...ways],{surface:'road',label:'Soroksári út 160'},center);
 assert.equal(found.length,1);assert.ok(Math.abs(found[0].latitude-47.5)<1e-9);assert.ok(Math.abs(found[0].longitude-19.071)<1e-9);assert.equal(found[0].precision,'landmark');
 assert.equal(surfaceCandidates([...nodes,...ways],{surface:'road',label:'Unknown street'},center).length,0);
});
test('tram candidates exclude metro and depot siding; report the mapped route for Pro',()=>{
 const ways=['tram','subway','rail'].map((railway,i)=>({type:'way',id:10+i,nodes:[1,2],tags:{railway,ref:'4;6'}}));
 ways.push({type:'way',id:20,nodes:[2,3],tags:{railway:'tram',service:'siding'}});
 const found=surfaceCandidates([...nodes,...ways],{surface:'tram',label:'Named square'},center);
 assert.equal(found.length,1);assert.equal(found[0].placeType,'tram');assert.deepEqual(found[0].routeRefs,['4','6']);
});
test('intersection requires a shared mapped road node, not crossing projected lines',()=>{
 const ways=[{type:'way',id:1,nodes:[1,2],tags:{highway:'residential',name:'Rozsnyay utca'}},{type:'way',id:2,nodes:[2,3],tags:{highway:'tertiary',name:'Röppentyű utca'}}];
 const found=surfaceCandidates([...nodes,...ways],{kind:'intersection',streets:['Rozsnyay utca','Röppentyű utca'],label:'Rozsnyai'},center);
 assert.equal(found.length,1);assert.equal(found[0].sourceUrl,'https://www.openstreetmap.org/node/2');
 assert.equal(found[0].latitude,47.501);
});
test('same-named metro and information board cannot silently become street/landmark locations',async()=>{
 const f={properties:{name:'Batthyány tér',osm_type:'N',osm_id:1,osm_key:'railway',osm_value:'station',city:'Budapest',countrycode:'HU'},geometry:{coordinates:[19.037782,47.5068724]}};
 assert.equal(choosePlace([f],{label:'Batthyány tér',precision:'street'}),null);
 const s=new Store(':memory:');
 try{const g=new Geocoder(s,{delayMs:0,request:async()=>({status:200,body:JSON.stringify({features:[{...f,properties:{...f.properties,name:'Kopaszi gát',osm_key:'tourism',osm_value:'information'}}]})})});
 assert.equal((await g.landmarks({kind:'landmark',label:'Kopaszi gát',quote:'Kopaszi gát'},{})).length,0);
 }finally{s.close();}
});
