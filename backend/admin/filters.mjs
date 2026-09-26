export const FILTER_KEY='crimap-editor-filters-v1';
export const defaults={search:'',sort:'occurred-desc',publication:'all',review:'all',section:'all',type:'all',homicide:'all',impact:'all',from:'',to:''};
const choices={sort:['occurred-desc','occurred-asc','received-desc','received-asc'],publication:['all','unpublished','published','live','new','updates'],review:['all','ready','pass','pending','failed','revise','reject'],section:['all','incidents','missing'],type:['all','traffic-accident','assault','fight','robbery','accident','fire','rescue','missing-person','transport-disruption','weather','other'],homicide:['all','only','exclude'],impact:['all','hide-minor','significant','fatal','injured','minor','unknown']};
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function normalizeFilters(value){const result={...defaults};if(!value||typeof value!=='object')return result;for(const [key,options] of Object.entries(choices))if(options.includes(value[key]))result[key]=value[key];if(typeof value.search==='string')result.search=value.search.slice(0,250);for(const key of ['from','to'])if(typeof value[key]==='string'&&validDate(value[key]))result[key]=value[key];return result;}
export function readFilters(storage){try{return normalizeFilters(JSON.parse(storage.getItem(FILTER_KEY)));}catch{return {...defaults};}}
export function saveFilters(storage,filters){try{storage.setItem(FILTER_KEY,JSON.stringify(normalizeFilters(filters)));return true;}catch{return false;}}
export const activeCount=f=>Object.keys(defaults).filter(k=>k!=='sort'&&f[k]!==defaults[k]).length;
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'});
export function localDay(value){if(!value||Number.isNaN(Date.parse(value)))return '';const parts=Object.fromEntries(dayFormat.formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`;}
export function filterEvents(events,input){
  const f=normalizeFilters(input),query=f.search.toLocaleLowerCase().trim();
  const result=events.filter(e=>{
    const current=e.published_revision===e.revision,live=!!e.public_id,flags=e.facets??{},day=localDay(e.occurred_at);
    if(query&&!`${e.title} ${e.searchText??''}`.toLocaleLowerCase().includes(query))return false;
    if(f.section!=='all'&&(e.eventType==='missing-person')!==(f.section==='missing'))return false;
    if(f.type!=='all'&&e.eventType!==f.type)return false;
    if(f.publication==='unpublished'&&current||f.publication==='published'&&!current||f.publication==='live'&&!live||f.publication==='new'&&(live||current)||f.publication==='updates'&&(!live||current))return false;
    if(f.review==='ready'&&!e.ready||f.review==='pending'&&e.verdict||f.review==='failed'&&!['revise','reject'].includes(e.verdict)||['pass','revise','reject'].includes(f.review)&&e.verdict!==f.review)return false;
    if(f.homicide==='only'&&!flags.homicide||f.homicide==='exclude'&&flags.homicide)return false;
    if(f.impact==='hide-minor'&&flags.impact==='minor'||['minor','significant','unknown'].includes(f.impact)&&flags.impact!==f.impact||f.impact==='fatal'&&!flags.fatal||f.impact==='injured'&&!flags.injured)return false;
    return !((f.from&&(!day||day<f.from))||(f.to&&(!day||day>f.to)));
  });
  const key=f.sort.startsWith('received')?'first_seen_at':'occurred_at',direction=f.sort.endsWith('asc')?1:-1;
  return result.sort((a,b)=>{const av=Date.parse(a[key]),bv=Date.parse(b[key]);if(!Number.isFinite(av)||!Number.isFinite(bv))return Number.isFinite(av)?-1:Number.isFinite(bv)?1:b.id-a.id;return direction*(av-bv)||b.id-a.id;});
}
