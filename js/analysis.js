import {BARANGAYS,BRGY_COORDS,CRIME_TYPES} from './constants.js';
import {state,brgyData,visibleData} from './state.js';
import {esc,$} from './util.js';
import {LG} from './map.js';
import {onRefresh,refreshAll} from './refresh.js';
import {onTab} from './tabs.js';
import {prepare,fitClusters,evalKMeans,evalRisk,evalForest,hour12,MIN_KMEANS,MIN_RF} from './ml.js';

const ALGOS=['kmeans','lr','rf'];
const COLORS={kmeans:'#1A5CFF',lr:'#15803D',rf:'#D97706'};
const TYPE_NAMES=CRIME_TYPES.map(c=>c.name);
const DAY=86400000;
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let selected='kmeans';
let results=null;
let resultsKey=null;
let evalToken=0;
let evaluating=false;
const fitMemo=new Map();
let keyMemo={ref:null,len:-1,key:''};

function pct(v){return Math.round(v*100)+'%';}

function typeData(){
  return state.crimeData.filter(c=>state.activeTypes.has(c.type));
}

function activeTypeNames(){
  return TYPE_NAMES.filter(n=>state.activeTypes.has(n));
}

function filterKey(){
  return state.activeBrgy+'|'+activeTypeNames().join(',');
}

function scopeKey(){
  return dataKey(state.crimeData)+'#'+filterKey();
}

function scopeName(){
  return state.activeBrgy?'brgy':'types';
}

function dataKey(data){
  if(keyMemo.ref===data&&keyMemo.len===data.length)return keyMemo.key;
  let h=2166136261;
  const s=data.length+'|'+data.map(c=>[c.id,c.date,c.time,c.type,c.barangay,c.lat,c.lng].join(',')).join(';');
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  const key=String(h>>>0)+':'+data.length;
  keyMemo={ref:data,len:data.length,key};
  return key;
}

function riskOf(i,len){
  return i<Math.ceil(len*0.3)?'High':i<Math.ceil(len*0.6)?'Medium':'Low';
}

function badgeOf(r){
  return r==='High'?'badge-r':r==='Medium'?'badge-a':'badge-g';
}

function dayLabel(day){
  const d=new Date(day*DAY);
  return MON[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear();
}

/* ------------------------- per-barangay facts (all measured) ------------------------- */

function barangayStats(P){
  const stats={};
  BARANGAYS.forEach(b=>{stats[b]={n:0,recent:0,types:{}};});
  if(!P.length)return stats;
  const dMax=P[P.length-1].day;
  const dMin=P[0].day;
  const span=Math.max(1,Math.min(180,dMax-dMin+1));
  P.forEach(p=>{
    const s=stats[p.barangay];
    if(!s)return;
    s.n++;
    if(p.day>dMax-span)s.recent++;
    s.types[p.type]=(s.types[p.type]||0)+1;
  });
  BARANGAYS.forEach(b=>{
    const s=stats[b];
    s.est=s.recent/span*30;
    const top=Object.entries(s.types).sort((a,c)=>c[1]-a[1])[0];
    s.top=top?top[0]:'None';
    s.topShare=top&&s.n?top[1]/s.n:0;
  });
  return stats;
}

/* ------------------------------ algorithm cards ------------------------------ */

function setCard(id,valueText,frac,meta,warn){
  const acc=$('acc-'+id),bar=$('bar-'+id),m=$('meta-'+id);
  if(acc)acc.textContent=valueText;
  if(bar)bar.style.width=Math.max(0,Math.min(1,frac||0))*100+'%';
  if(m){
    m.textContent=meta;
    m.classList.toggle('warn',!!warn);
  }
}

function renderCards(){
  if(!results){
    if(evaluating){
      ALGOS.forEach(a=>setCard(a,'...',0,'Testing on your records. This takes a few seconds.',false));
    }else{
      ALGOS.forEach(a=>setCard(a,'-',0,'Open this tab to run the evaluation.',false));
    }
    return;
  }
  const k=results.kmeans;
  if(!k.ok){
    setCard('kmeans','N/A',0,'Needs at least '+MIN_KMEANS+' records. You have '+k.have+'.',true);
  }else{
    const lift=k.lift?k.lift.toFixed(1)+'x better than random placement. ':'';
    setCard('kmeans',pct(k.value),k.value,
      pct(k.value)+' (\u00B1'+Math.round(k.ci*100)+') of the '+k.nTest+' newest incidents fell inside hotspots found from older records. Hotspots cover '+pct(k.area)+' of the area'+(k.lift?' ('+k.lift.toFixed(1)+'x better than random)':'')+'.',
      false);
  }
  const l=results.lr;
  if(!l.ok){
    setCard('lr','N/A',0,'Needs about '+l.needDays+' days of history. You have '+l.haveDays+'.',true);
  }else{
    const beats=l.value>l.baseline+0.005;
    setCard('lr',pct(l.value),l.value,
      'Right on '+pct(l.value)+' (\u00B1'+Math.round(l.ci*100)+') of '+l.nTest+' unseen cases. Always guessing the common answer: '+pct(l.baseline)+'; "busy last month" rule: '+pct(l.naive)+'.'
      +(beats?'':' Not clearly beating the baseline.'),
      !beats);
  }
  const r=results.rf;
  if(!r.ok&&r.single){
    setCard('rf','N/A',0,'Select at least 2 crime types to compare.',true);
  }else if(!r.ok){
    setCard('rf','N/A',0,'Needs at least '+MIN_RF+' records. You have '+r.have+'.',true);
  }else{
    const beats=r.value>r.baseline+0.005;
    setCard('rf',pct(r.value),r.value,
      'Exact type right for '+pct(r.value)+' (\u00B1'+Math.round(r.ci*100)+') of '+r.nTest+' unseen incidents; in top 3 picks: '+pct(r.top3)+'. Always guessing "'+r.majorityType+'": '+pct(r.baseline)+'.'
      +(beats?'':' Not clearly beating the baseline.'),
      !beats);
  }
}

/* ----------------------------------- evaluation ----------------------------------- */

const tick=()=>new Promise(r=>setTimeout(r,20));

async function ensureEvaluation(){
  const key=scopeKey();
  if(key===resultsKey&&(results||evaluating))return;
  resultsKey=key;
  results=null;
  evaluating=true;
  const token=++evalToken;
  renderCards();
  await tick();
  if(token!==evalToken)return;
  const Pall=prepare(typeData());
  const Pscope=prepare(visibleData());
  const names=activeTypeNames();
  const out={};
  out.kmeans=evalKMeans(Pscope);
  await tick();
  if(token!==evalToken)return;
  out.lr=evalRisk(Pall,BARANGAYS);
  await tick();
  if(token!==evalToken)return;
  out.rf=names.length<2?{ok:false,single:true}:evalForest(Pall,names);
  if(token!==evalToken)return;
  results=out;
  evaluating=false;
  renderCards();
  renderTable();
  renderZones();
  drawOverlay();
}

/* ------------------------------ ranking and table ------------------------------ */

function getFit(P,scope){
  const mk=scopeKey()+'|'+scope;
  if(fitMemo.has(mk))return fitMemo.get(mk);
  if(fitMemo.size>6)fitMemo.clear();
  const fit=fitClusters(P);
  fitMemo.set(mk,fit);
  return fit;
}

function rankRows(){
  const P=prepare(typeData());
  const stats=barangayStats(P);
  const rows=BARANGAYS.filter(b=>stats[b].n>0&&(!state.activeBrgy||b===state.activeBrgy)).map(b=>({b,s:stats[b]}));
  const hot={};
  if(selected==='kmeans'&&P.length){
    getFit(P,'types').clusters.forEach(c=>{
      if(!c.hotspot)return;
      c.members.forEach(m=>{hot[m.barangay]=(hot[m.barangay]||0)+1;});
    });
  }
  rows.forEach(r=>{
    if(selected==='kmeans'){
      r.inHot=hot[r.b]||0;
      r.score=r.s.n?r.inHot/r.s.n:0;
      r.key=r.inHot+r.s.est/1000;
    }else if(selected==='lr'){
      const p=results&&results.lr.ok?results.lr.probs[r.b]:null;
      r.score=p;
      r.key=(p===null?0:p)+r.s.est/1000;
    }else{
      const pb=results&&results.rf.ok?results.rf.perBrgy[r.b]:null;
      r.rfN=pb?pb.n:0;
      r.score=pb&&pb.n>=5?pb.correct/pb.n:null;
      r.key=r.s.est;
    }
  });
  rows.sort((a,c)=>c.key-a.key);
  return rows;
}

function scoreCell(r){
  if(selected==='kmeans')return pct(r.score)+' <span class="mono-sm">('+r.inHot+' of '+r.s.n+')</span>';
  if(selected==='lr')return r.score===null||r.score===undefined?'...':pct(r.score);
  if(r.score===null||r.score===undefined)return '<span class="mono-sm">too few tests ('+(r.rfN||0)+')</span>';
  return pct(r.score)+' <span class="mono-sm">(n='+r.rfN+')</span>';
}

const HEADERS={
  kmeans:'Share of Incidents in Hotspots',
  lr:'Chance of Above-Median Activity (next 30d)',
  rf:'Crime-Type Accuracy Here (held-out)'
};

function renderTable(){
  if(!$('panel-predict').classList.contains('on'))return;
  const tb=$('pred-tbl');
  tb.replaceChildren();
  $('pred-th-score').textContent=HEADERS[selected];
  const rows=rankRows();
  if(!rows.length){
    tb.innerHTML='<tr><td colspan="5" class="empty">No data to analyze.</td></tr>';
    return;
  }
  rows.forEach((r,i)=>{
    const risk=riskOf(i,rows.length);
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="strong">'+esc(r.b)+'</td><td class="mono">'+r.s.est.toFixed(1)+'</td><td>'+esc(r.s.top)+' <span class="mono-sm">('+pct(r.s.topShare)+')</span></td><td class="mono">'+scoreCell(r)+'</td><td><span class="badge '+badgeOf(risk)+'">'+risk+'</span></td></tr>'
    );
  });
}

function renderZones(){
  if(!$('panel-predict').classList.contains('on'))return;
  const rz=$('risk-zones');
  rz.replaceChildren();
  const rows=rankRows();
  if(!rows.length){
    rz.innerHTML='<p class="pane-note">No incidents recorded yet.</p>';
    return;
  }
  rows.slice(0,6).forEach((r,i)=>{
    const risk=riskOf(i,rows.length);
    rz.insertAdjacentHTML('beforeend','<div class="zone-row"><span class="zone-name">'+esc(r.b)+' <span>('+r.s.n+')</span></span><span class="badge '+badgeOf(risk)+'">'+risk+'</span></div>');
  });
}

/* ----------------------- weekly chart (actual + simple estimate) ----------------------- */

function destroyForecast(){
  if(state.charts.forecast){
    try{state.charts.forecast.destroy();}catch(e){}
    delete state.charts.forecast;
  }
}

function weeklySeries(P,Pall){
  if(selected==='kmeans'){
    const hot=new Set();
    getFit(P,scopeName()).clusters.forEach(c=>{if(c.hotspot)c.members.forEach(m=>hot.add(m.id));});
    return {title:'Weekly Incidents: Inside vs Outside Hotspots',series:[
      {name:'Inside hotspots',color:'#E8323A',test:p=>hot.has(p.id)},
      {name:'Outside hotspots',color:'#9AA8B8',test:p=>!hot.has(p.id)}
    ]};
  }
  if(selected==='lr'){
    const top=new Set(rankRows().slice(0,3).map(r=>r.b));
    return {title:'Weekly Incidents: Top 3 Risk Barangays vs Others',series:[
      {name:'Top 3 risk barangays',color:'#15803D',test:p=>top.has(p.barangay)},
      {name:'Other barangays',color:'#9AA8B8',test:p=>!top.has(p.barangay)}
    ]};
  }
  const counts={};
  P.forEach(p=>{counts[p.type]=(counts[p.type]||0)+1;});
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
  const series=top.map(t=>{
    const ct=CRIME_TYPES.find(c=>c.name===t);
    return {name:t,color:ct?ct.color:'#888888',test:p=>p.type===t};
  });
  series.push({name:'Other types',color:'#9AA8B8',test:p=>!top.includes(p.type)});
  return {title:'Weekly Incidents: Top Crime Types',series};
}

function renderForecast(){
  destroyForecast();
  const Pscope=prepare(visibleData());
  const Pall=prepare(typeData());
  const spec=weeklySeries(Pscope,Pall);
  const P=selected==='lr'?Pall:Pscope;
  const ttl=$('forecast-title');
  if(ttl)ttl.textContent=spec.title;
  if(P.length<8)return;
  const dMax=P[P.length-1].day;
  const WEEKS=12;
  const labels=[];
  for(let i=0;i<WEEKS;i++){
    const d=new Date((dMax-(WEEKS-1-i)*7)*DAY);
    labels.push(MON[d.getUTCMonth()]+' '+d.getUTCDate());
  }
  const datasets=spec.series.map(sr=>{
    const vals=new Array(WEEKS).fill(0);
    P.forEach(p=>{
      const w=Math.floor((dMax-p.day)/7);
      if(w>=0&&w<WEEKS&&sr.test(p))vals[WEEKS-1-w]++;
    });
    return {label:sr.name,data:vals,backgroundColor:sr.color,borderWidth:0};
  });
  const tickC=state.darkOn?'#C4D0DC':'#7A94A8';
  const grid=state.darkOn?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)';
  state.charts.forecast=new Chart($('ch-forecast'),{
    type:'bar',
    data:{labels,datasets},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:tickC,font:{family:'DM Sans',size:10},boxWidth:12}}},
      scales:{
        x:{stacked:true,title:{display:true,text:'Week ending',color:'#7A94A8',font:{size:10}},ticks:{color:tickC,font:{size:9}},grid:{display:false}},
        y:{stacked:true,beginAtZero:true,title:{display:true,text:'Incidents per week',color:'#7A94A8',font:{size:10}},ticks:{color:tickC,precision:0},grid:{color:grid}}
      }
    }
  });
}

/* ------------------------------------ map overlay ------------------------------------ */

function modeHour(members){
  const h=new Array(24).fill(0);
  members.forEach(m=>{h[Math.floor(m.hour)%24]++;});
  return h.indexOf(Math.max(...h));
}

function modeType(members){
  const t={};
  members.forEach(m=>{t[m.type]=(t[m.type]||0)+1;});
  const e=Object.entries(t).sort((a,b)=>b[1]-a[1])[0];
  return e?e[0]:'None';
}

function drawOverlay(){
  LG.clusters.clearLayers();
  const pts=visibleData();
  if(!pts.length)return;
  const P=prepare(pts);
  if(!P.length)return;
  if(selected==='kmeans'){
    const fit=getFit(P,scopeName());
    fit.clusters.forEach((c,i)=>{
      if(!c.size)return;
      const col=c.hotspot?'#E8323A':'#D97706';
      L.circle([c.lat,c.lng],{radius:c.radius,fillColor:col,fillOpacity:c.hotspot?.10:.04,color:col,weight:c.hotspot?1.8:1,dashArray:'5,7',interactive:false}).addTo(LG.clusters);
      L.circleMarker([c.lat,c.lng],{radius:c.hotspot?5:3,fillColor:col,color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:'+col+'">'+(c.hotspot?'Hotspot':'Minor')+' Cluster '+(i+1)+'</div>'
        +'<div class="pu-row"><span>Incidents</span><span>'+c.size+' ('+pct(c.size/P.length)+' of shown)</span></div>'
        +'<div class="pu-row"><span>Most common</span><span>'+esc(modeType(c.members))+'</span></div>'
        +'<div class="pu-row"><span>Peak hour</span><span>'+hour12(modeHour(c.members))+'</span></div>'
        +'<div class="pu-row"><span>Radius</span><span>'+Math.round(c.radius)+' m</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>K-Means (k='+fit.k+')</span></div>'
      );
    });
  }else if(selected==='lr'){
    rankRows().slice(0,3).forEach((r,i)=>{
      if(!BRGY_COORDS[r.b])return;
      const prob=results&&results.lr.ok?results.lr.probs[r.b]:null;
      L.circle(BRGY_COORDS[r.b],{radius:250,fillColor:'#15803D',fillOpacity:.08,color:'#15803D',weight:1.5,dashArray:'6,4',interactive:false}).addTo(LG.clusters);
      L.circleMarker(BRGY_COORDS[r.b],{radius:4,fillColor:'#15803D',color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:#15803D">High-Risk Zone #'+(i+1)+'</div>'
        +'<div class="pu-row"><span>Barangay</span><span>'+esc(r.b)+'</span></div>'
        +'<div class="pu-row"><span>Chance above median (30d)</span><span>'+(prob===null?'calculating':pct(prob))+'</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>Logistic Regression</span></div>'
      );
    });
  }else{
    rankRows().forEach(r=>{
      if(!BRGY_COORDS[r.b])return;
      const ct=CRIME_TYPES.find(c=>c.name===r.s.top);
      const col=ct?ct.color:'#888888';
      const pb=results&&results.rf.ok?results.rf.perBrgy[r.b]:null;
      L.circle(BRGY_COORDS[r.b],{radius:120+Math.sqrt(r.s.n)*25,fillColor:col,fillOpacity:.08,color:col,weight:1.5,dashArray:'4,6',interactive:false}).addTo(LG.clusters);
      L.circleMarker(BRGY_COORDS[r.b],{radius:4,fillColor:col,color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:'+esc(col)+'">'+esc(r.s.top)+' zone</div>'
        +'<div class="pu-row"><span>Barangay</span><span>'+esc(r.b)+'</span></div>'
        +'<div class="pu-row"><span>Share of incidents here</span><span>'+pct(r.s.topShare)+'</span></div>'
        +'<div class="pu-row"><span>Forest accuracy here</span><span>'+(pb&&pb.n>=5?pct(pb.correct/pb.n)+' (n='+pb.n+')':'too few tests')+'</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>Random Forest</span></div>'
      );
    });
  }
}

/* --------------------------------------- wiring --------------------------------------- */

function renderPanel(){
  if(!$('panel-predict').classList.contains('on'))return;
  renderCards();
  renderForecast();
  renderTable();
  renderZones();
}

function renderFilters(){
  const sel=$('an-brgy');
  if(sel&&sel.value!==state.activeBrgy)sel.value=state.activeBrgy;
  const box=$('an-types');
  if(box){
    box.replaceChildren();
    const scope=brgyData();
    CRIME_TYPES.forEach(ct=>{
      const cnt=scope.filter(c=>c.type===ct.name).length;
      const on=state.activeTypes.has(ct.name);
      const chip=document.createElement('div');
      chip.className='an-chip'+(on?' on':'');
      chip.dataset.type=ct.name;
      chip.setAttribute('role','checkbox');
      chip.setAttribute('aria-checked',on?'true':'false');
      chip.tabIndex=0;
      chip.innerHTML='<span class="an-chip-left"><span class="cf-dot" style="background:'+esc(ct.color)+'"></span>'+esc(ct.name)+'</span><span class="cf-cnt">'+cnt+'</span>';
      box.appendChild(chip);
    });
  }
  const note=$('an-scope');
  if(note){
    const n=visibleData().length;
    const names=activeTypeNames();
    const typeText=names.length===TYPE_NAMES.length?'all crime types':names.length+' of '+TYPE_NAMES.length+' crime types';
    note.textContent='Analyzing '+n+' incident'+(n===1?'':'s')+' in '+(state.activeBrgy||'all barangays')+' for '+typeText+'.';
  }
}

function toggleType(name){
  if(state.activeTypes.has(name)){
    if(state.activeTypes.size>1)state.activeTypes.delete(name);
  }else{
    state.activeTypes.add(name);
  }
  refreshAll();
  const box=$('an-types');
  const again=box?Array.from(box.children).find(c=>c.dataset.type===name):null;
  if(again)again.focus();
}

function setBarangay(value){
  state.activeBrgy=BARANGAYS.includes(value)?value:'';
  const side=$('brgy-sel');
  if(side)side.value=state.activeBrgy;
  refreshAll();
}

function initFilters(){
  const sel=$('an-brgy');
  BARANGAYS.forEach(b=>sel.add(new Option(b,b)));
  sel.addEventListener('change',e=>setBarangay(e.target.value));
  const box=$('an-types');
  box.addEventListener('click',e=>{
    const chip=e.target.closest('.an-chip');
    if(chip)toggleType(chip.dataset.type);
  });
  box.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const chip=e.target.closest('.an-chip');
    if(!chip)return;
    e.preventDefault();
    toggleType(chip.dataset.type);
  });
  $('an-all-types').addEventListener('click',()=>{
    TYPE_NAMES.forEach(n=>state.activeTypes.add(n));
    refreshAll();
  });
  $('an-reset').addEventListener('click',()=>{
    TYPE_NAMES.forEach(n=>state.activeTypes.add(n));
    setBarangay('');
  });
}

export function updateAnalysis(){
  renderFilters();
  drawOverlay();
  renderPanel();
  const panelOn=$('panel-predict').classList.contains('on');
  if(panelOn||selected!=='kmeans')ensureEvaluation();
}

function markSelected(){
  document.querySelectorAll('.algo-card').forEach(card=>{
    const on=card.dataset.algo===selected;
    card.classList.toggle('sel',on);
    card.setAttribute('aria-checked',on?'true':'false');
    const old=card.querySelector('.algo-badge');
    if(old)old.remove();
    if(on){
      const badge=document.createElement('div');
      badge.className='algo-badge';
      badge.textContent='Active';
      card.insertBefore(badge,card.firstChild);
    }
  });
}

function selectAlgo(a){
  if(!ALGOS.includes(a)||a===selected)return;
  selected=a;
  markSelected();
  updateAnalysis();
}

export function clearAnalysis(){
  LG.clusters.clearLayers();
  $('risk-zones').replaceChildren();
  $('pred-tbl').replaceChildren();
  destroyForecast();
  results=null;
  resultsKey=null;
  evalToken++;
  evaluating=false;
  fitMemo.clear();
}

export function initAnalysis(){
  initFilters();
  document.querySelectorAll('.algo-card').forEach(card=>{
    card.addEventListener('click',()=>selectAlgo(card.dataset.algo));
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        selectAlgo(card.dataset.algo);
      }
    });
  });
  markSelected();
  onRefresh(updateAnalysis);
  onTab('predict',updateAnalysis);
}
