const $=s=>document.querySelector(s);
const format=value=>new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Budapest',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
const key='crimap-activity-range-v1';
let bounds=null,start=0,end=0,notify=()=>{},dragging=false;
export const rangeEditing=()=>dragging;
export function rangeParams(){return $('#activity-period').value==='custom'?{from:new Date(start).toISOString(),to:new Date(end).toISOString()}:{};}
function save(){try{localStorage.setItem(key,JSON.stringify({period:$('#activity-period').value,...rangeParams()}));}catch{}}
function paint(){
 if(!bounds)return;
 const low=$('#range-start'),high=$('#range-end');
 for(const input of [low,high]){input.min=bounds.from;input.max=bounds.to;input.step=60000;input.disabled=bounds.to-bounds.from<60000;}
 low.value=start;high.value=end;
 low.setAttribute('aria-valuetext',format(start));high.setAttribute('aria-valuetext',format(end));
 $('#range-from-label').textContent=format(start);$('#range-to-label').textContent=format(end);
 $('#range-history-start').textContent=format(bounds.from);$('#range-history-end').textContent=format(bounds.to);
 const span=Math.max(1,bounds.to-bounds.from),x=Math.max(0,(start-bounds.from)/span*1000),right=Math.min(1000,(end-bounds.from)/span*1000);
 $('#range-selection').setAttribute('x',x);$('#range-selection').setAttribute('width',Math.max(0,right-x));
 $('#range-duration').textContent=end-start<86400000?`${Math.max(1,Math.round((end-start)/3600000))} ч`:`${Math.ceil((end-start)/86400000)} дн`;
}
export function updateRange(data){
 if(dragging)return;
 bounds={from:Math.floor(Date.parse(data.bounds.from)/60000)*60000,to:Math.ceil(Date.parse(data.bounds.to)/60000)*60000};
 // Keep short presets usable even when this installation has only a few hours of history.
 bounds.from=Math.min(bounds.from,Date.parse(data.since));
 start=Date.parse(data.since);end=Date.parse(data.until);paint();
}
export function setupRange(onChange){
 notify=onChange;
 try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&['day','week','month','all','custom'].includes(saved.period)){
  if(saved.period!=='custom'||Number.isFinite(Date.parse(saved.from))&&Number.isFinite(Date.parse(saved.to))&&Date.parse(saved.from)<Date.parse(saved.to)&&Date.parse(saved.from)<Date.now()){
   $('#activity-period').value=saved.period;start=Date.parse(saved.from);end=Math.min(Date.now(),Date.parse(saved.to));
  }
 }}catch{}
 $('#activity-period').addEventListener('change',()=>{if($('#activity-period').value==='custom'&&!bounds){$('#activity-period').value='day';}save();notify();});
 for(const id of ['range-start','range-end']){
  const input=$('#'+id);
  input.addEventListener('pointerdown',()=>{dragging=true;});
  input.addEventListener('input',()=>{
   $('#activity-period').value='custom';
   if(id==='range-start')start=Math.min(Number(input.value),end-60000);else end=Math.max(Number(input.value),start+60000);
   paint();
  });
  input.addEventListener('change',()=>{dragging=false;save();notify();});
 }
 window.addEventListener('pointerup',()=>{dragging=false;});window.addEventListener('pointercancel',()=>{dragging=false;});
 $('#range-reset').addEventListener('click',()=>{$('#activity-period').value='day';save();notify();});
}
