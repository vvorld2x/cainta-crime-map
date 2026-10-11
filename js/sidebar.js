import {BARANGAYS,CRIME_TYPES,STATUSES} from './constants.js';
import {state,brgyData} from './state.js';
import {esc,$} from './util.js';
import {MAP,focusBarangay} from './map.js';
import {setTab} from './tabs.js';
import {refreshAll} from './refresh.js';

export function buildSelects(){
  const filter=$('brgy-sel');
  const brgy=$('f-brgy');
  const type=$('f-type');
  const status=$('f-status');
  BARANGAYS.forEach(b=>{
    filter.add(new Option(b,b));
    brgy.add(new Option(b,b));
  });
  CRIME_TYPES.forEach(c=>type.add(new Option(c.name,c.name)));
  STATUSES.forEach(s=>status.add(new Option(s,s)));
  $('s-brgy-count').textContent=String(BARANGAYS.length);
}

export function buildLegend(){
  const el=$('legend-items');
  el.replaceChildren();
  CRIME_TYPES.forEach(ct=>{
    const row=document.createElement('div');
    row.className='leg-row';
    const dot=document.createElement('div');
    dot.className='leg-dot';
    dot.style.background=ct.color;
    row.append(dot,document.createTextNode(ct.name));
    el.appendChild(row);
  });
}

export function buildCrimeFilter(){
  const el=$('cf-list');
  el.replaceChildren();
  CRIME_TYPES.forEach(ct=>{
    const cnt=state.crimeData.filter(c=>c.type===ct.name).length;
    const div=document.createElement('div');
    div.className='cf'+(state.activeTypes.has(ct.name)?' on':'');
    div.dataset.type=ct.name;
    div.innerHTML='<div class="cf-left"><div class="cf-dot" style="background:'+esc(ct.color)+'"></div>'+esc(ct.name)+'</div><span class="cf-cnt">'+cnt+'</span>';
    el.appendChild(div);
  });
}

export function buildRecentList(){
  const el=$('rec-list');
  el.replaceChildren();
  const filtered=brgyData();
  if(!filtered.length){
    const note=document.createElement('div');
    note.className='empty-note';
    note.textContent=state.activeBrgy?'No incidents for selected barangay.':'No incidents recorded yet.';
    el.appendChild(note);
    return;
  }
  filtered.slice(-20).reverse().forEach(c=>{
    const d=document.createElement('div');
    d.className='rec';
    d.dataset.id=String(c.id);
    d.innerHTML='<div class="rec-dot" style="background:'+esc(c.color)+'"></div><div class="rec-body"><div class="rec-type">'+esc(c.type)+'</div><div class="rec-loc">'+esc(c.barangay)+': '+esc(c.location)+'</div></div><div class="rec-time">'+esc(c.time)+'</div>';
    el.appendChild(d);
  });
}

export function updateStats(){
  const n=brgyData().length;
  $('s-total').textContent=String(n);
  $('s-hotspots').textContent=n>0?String(Math.min(8,Math.ceil(n/5))):'0';
}

export function initSidebar(){
  $('brgy-sel').addEventListener('change',e=>{
    state.activeBrgy=BARANGAYS.includes(e.target.value)?e.target.value:'';
    refreshAll();
    focusBarangay(state.activeBrgy);
  });
  $('cf-list').addEventListener('click',e=>{
    const row=e.target.closest('.cf');
    if(!row)return;
    const name=row.dataset.type;
    if(state.activeTypes.has(name)){
      if(state.activeTypes.size>1)state.activeTypes.delete(name);
    }else{
      state.activeTypes.add(name);
    }
    refreshAll();
  });
  $('rec-list').addEventListener('click',e=>{
    const row=e.target.closest('.rec');
    if(!row)return;
    const rec=state.crimeData.find(c=>String(c.id)===row.dataset.id);
    if(!rec)return;
    setTab('map');
    MAP.setView([rec.lat,rec.lng],17);
  });
}
