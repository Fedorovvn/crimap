import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,filterEvents,normalizeFilters,readFilters,saveFilters,localDay,activeCount} from '../admin/filters.mjs';
import {eventFacets} from '../admin-facets.mjs';
const row=(id,extra={})=>({id,revision:2,published_revision:null,public_id:null,title:'Event '+id,verdict:null,occurred_at:'2026-09-20T12:00:00Z',first_seen_at:'2026-09-22T12:00:00Z',eventType:'assault',facets:{homicide:false,fatal:false,impact:'unknown'},...extra});
const list=[row(1,{published_revision:2,public_id:10,verdict:'pass'}),row(2,{published_revision:1,public_id:11,verdict:'revise'}),row(3,{verdict:'pass',ready:true,facets:{homicide:true,fatal:true,impact:'significant'}}),row(4,{verdict:'reject',eventType:'traffic-accident',facets:{impact:'minor'}}),row(5,{eventType:'missing-person'})];
const ids=f=>filterEvents(list,{...defaults,...f}).map(e=>e.id).sort();
test('publication filters distinguish all live events from unpublished drafts and pending updates',()=>{
  assert.deepEqual(ids({publication:'published'}),[1,2]);assert.deepEqual(ids({publication:'live'}),[1,2]);assert.deepEqual(ids({publication:'unpublished'}),[3,4,5]);assert.deepEqual(ids({publication:'updates'}),[2]);assert.deepEqual(ids({publication:'new'}),[3,4,5]);
  assert.deepEqual(ids({publication:'unpublished',review:'pass'}),[3]);assert.deepEqual(ids({review:'failed'}),[2,4]);assert.deepEqual(ids({review:'pending'}),[5]);assert.deepEqual(ids({review:'ready'}),[3]);
});
test('type, homicide and impact filters compose without hiding unknown severity',()=>{
  assert.deepEqual(ids({homicide:'only'}),[3]);assert.deepEqual(ids({homicide:'exclude',impact:'hide-minor'}),[1,2,5]);assert.deepEqual(ids({section:'missing'}),[5]);assert.deepEqual(ids({type:'traffic-accident'}),[4]);assert.deepEqual(ids({section:'missing',type:'assault'}),[]);
  assert.deepEqual(ids({impact:'fatal'}),[3]);assert.deepEqual(ids({search:'event 2'}),[2]);
});
test('event ranges use Budapest calendar days and date sorts always place missing dates last',()=>{
  assert.equal(localDay('2026-09-20T22:30:00Z'),'2026-09-21');assert.equal(localDay('2026-12-20T23:30:00Z'),'2026-12-21');
  const events=[row(1,{occurred_at:null}),row(2,{occurred_at:'2026-09-20T22:30:00Z'}),row(3,{occurred_at:'2026-09-20T12:00:00Z',first_seen_at:'2026-09-25T00:00:00Z'})];
  assert.deepEqual(filterEvents(events,{from:'2026-09-21',to:'2026-09-21'}).map(e=>e.id),[2]);
  assert.deepEqual(filterEvents(events,{sort:'occurred-asc'}).map(e=>e.id),[3,2,1]);assert.deepEqual(filterEvents(events,{sort:'occurred-desc'}).map(e=>e.id),[2,3,1]);assert.equal(filterEvents(events,{sort:'received-desc'})[0].id,3);
  assert.deepEqual(filterEvents(events,{from:'2026-09-22',to:'2026-09-20'}),[]);
});
test('saved filters survive reload and reset; malformed or unavailable storage is harmless',()=>{
  let saved=null;const storage={getItem:()=>saved,setItem:(key,value)=>{saved=value;}};
  const state={...defaults,sort:'received-asc',review:'pass',impact:'hide-minor',from:'2026-09-01'};
  assert.equal(saveFilters(storage,state),true);assert.deepEqual(readFilters(storage),state);assert.equal(activeCount(state),3);
  saveFilters(storage,defaults);assert.deepEqual(readFilters(storage),defaults);
  saved='{broken';assert.deepEqual(readFilters(storage),defaults);assert.equal(saveFilters({setItem(){throw new Error();}},state),false);
  assert.deepEqual(normalizeFilters({review:'anything',sort:'anything',from:'2026-02-31'}),defaults);
});
test('homicide is separate from fatal accidents; free minor classification keeps danger and uncertainty',()=>{
  const event=(title,summary,type,signals=[])=>({title,summary,type,signals});
  assert.equal(eventFacets(event('Fatal collision','A pedestrian died.','traffic-accident',['death'])).homicide,false);
  assert.equal(eventFacets(event('Attempted murder','An attacker was detained.','assault')).homicide,true);
  assert.equal(eventFacets(event('Not a murder','An accident.','accident')).homicide,false);
  assert.equal(eventFacets(event('Crash in Budapest','No one was injured.','traffic-accident')).impact,'minor');
  assert.equal(eventFacets(event('Crash in Budapest','Two vehicles collided.','traffic-accident')).impact,'unknown');
  assert.equal(eventFacets(event('Traffic restriction after stabbing','No one was injured in the traffic jam.','transport-disruption',['injury'])).impact,'significant');
});

test('withdrawn publications stay out of published results even at the same revision',()=>{const rows=[row(1,{public_id:10,published_revision:2,withdrawn_at:'2026-09-27'}),row(2,{public_id:11,published_revision:1})];assert.deepEqual(filterEvents(rows,{publication:'published'}).map(e=>e.id),[2]);assert.deepEqual(filterEvents(rows,{publication:'unpublished'}).map(e=>e.id),[1]);assert.equal(normalizeFilters({publication:'live'}).publication,'published');});
