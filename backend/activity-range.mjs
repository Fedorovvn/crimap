// All interval endpoints are instants, inclusive; the queue remains live.
export function activityRange(db,{now=new Date(),period='day',from,to}={}){
 const end=now.getTime();
 const first=db.prepare("SELECT min(at) at FROM (SELECT min(created_at) at FROM usage UNION ALL SELECT min(created_at) FROM audit UNION ALL SELECT min(created_at) FROM triage_log)").get().at;
 const earliest=Math.min(end,Date.parse(first)||end-86400000);
 const bounds={from:new Date(earliest).toISOString(),to:now.toISOString()};
 if(period==='custom'){
  const valid=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
  if(!valid(from)||!valid(to)||Date.parse(from)>Date.parse(to)||Date.parse(from)>end){const e=new Error('Выберите корректные начало и конец периода.');e.status=400;throw e;}
  return {since:new Date(from).toISOString(),until:new Date(Math.min(end,Date.parse(to))).toISOString(),bounds};
 }
 return {since:period==='all'?bounds.from:new Date(end-(period==='month'?30:period==='week'?7:1)*86400000).toISOString(),until:now.toISOString(),bounds};
}
