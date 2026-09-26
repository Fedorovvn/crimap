// OSM geometry provides candidate positions; Pro still checks the source,
// route, river bank and incident context before choosing any approximation.
const norm=s=>String(s??'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const matches=(name,query)=>{const n=norm(name),q=norm(query);return n.length>4&&(q===n||q.includes(n)||n.startsWith(q+' '));};
export function retainLocationCoordinates(previous,incoming){
  const same=['city','district','label','precision'].every(k=>norm(previous[k])===norm(incoming[k]));
  delete incoming.latitude;delete incoming.longitude;
  if(same&&Number.isFinite(previous.latitude)&&Number.isFinite(previous.longitude))Object.assign(incoming,{latitude:previous.latitude,longitude:previous.longitude});
  return incoming;
}
export function nearestOnLine(points,center){
  let best=null;
  const scale=Math.cos(center.latitude*Math.PI/180),x=center.longitude*scale,y=center.latitude;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],ax=a.lon*scale,ay=a.lat,dx=b.lon*scale-ax,dy=b.lat-ay;
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
    const latitude=ay+t*dy,longitude=(ax+t*dx)/scale,distance=Math.hypot((longitude-center.longitude)*scale,latitude-center.latitude)*111320;
    if(!best||distance<best.distance)best={latitude,longitude,distance};
  }
  return best;
}
export function surfaceCandidates(elements,anchor,center){
  const nodes=new Map(elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  const routes=new Map();
  for(const r of elements.filter(e=>e.type==='relation'&&e.tags?.type==='route'))for(const m of r.members??[])if(m.type==='way'&&r.tags?.ref)routes.set(m.ref,[...(routes.get(m.ref)??[]),r.tags.ref]);
  const results=[],query=anchor.mapQuery??anchor.label,surface=anchor.surface;
  if(anchor.kind==='intersection'&&anchor.streets?.length===2){
    const streets=anchor.streets.map(name=>elements.filter(e=>e.type==='way'&&e.tags?.highway&&norm(e.tags.name)===norm(name)));
    const left=new Set(streets[0].flatMap(e=>e.nodes??[])),right=new Set(streets[1].flatMap(e=>e.nodes??[]));
    return [...left].filter(id=>right.has(id)&&nodes.has(id)).map(id=>({latitude:nodes.get(id).lat,longitude:nodes.get(id).lon,
      precision:'landmark',provider:'osm-geometry',label:anchor.streets.join(' / '),placeType:'road-intersection',
      sourceUrl:`https://www.openstreetmap.org/node/${id}`,approximation:'Mapped intersection; exact collision point within it is unknown'}));
  }
  for(const way of elements.filter(e=>e.type==='way')){
    const t=way.tags??{},geometry=(way.nodes??[]).map(id=>nodes.get(id)).filter(Boolean);
    if(geometry.length!==(way.nodes??[]).length||geometry.length<2)continue;
    const road=surface==='road'&&t.highway&&!['footway','path','steps','cycleway','construction','proposed'].includes(t.highway)&&matches(t.name,query);
    const rail=(surface==='tram'&&t.railway==='tram'||surface==='rail'&&t.railway==='rail')&&!['yard','siding','spur'].includes(t.service);
    const waterfront=surface==='waterfront'&&['footway','pedestrian','path'].includes(t.highway)&&matches(t.name,query);
    if(!road&&!rail&&!waterfront)continue;
    const point=nearestOnLine(geometry,center);if(!point||point.distance>450)continue;
    results.push({...point,precision:'landmark',provider:'osm-geometry',label:t.name??query,placeType:rail?t.railway:waterfront?'waterfront-path':'road',
      routeRefs:[...new Set([...(routes.get(way.id)??[]),...(t.ref??'').split(';').filter(Boolean)])],
      sourceUrl:`https://www.openstreetmap.org/way/${way.id}`,approximation:'Representative point on the mapped feature; exact scene not established'});
  }
  return results.sort((a,b)=>a.distance-b.distance).slice(0,8);
}
