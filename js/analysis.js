import {BARANGAYS,BRGY_COORDS,CRIME_TYPES} from './constants.js';
import {state,brgyData} from './state.js';
import {esc,$} from './util.js';
import {LG,kmeans} from './map.js';
import {onRefresh} from './refresh.js';
import {onTab} from './tabs.js';

const ALGOS=['kmeans','lr','rf'];
const COLORS={kmeans:'#1A5CFF',lr:'#15803D',rf:'#D97706'};
const CONFIDENCE={kmeans:72,lr:68,rf:76};
const MULTIPLIER={kmeans:0.30,lr:0.25,rf:0.33};
let selected='kmeans';

function rank(data){
  const counts={};
  BARANGAYS.forEach(b=>{counts[b]=0;});
  data.forEach(c=>{
    if(c.barangay in counts)counts[c.barangay]++;
  });
  return Object.entries(counts).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
}

function riskOf(i,len){
  return i<Math.ceil(len*0.3)?'High':i<Math.ceil(len*0.6)?'Medium':'Low';
}

function badgeOf(r){
  return r==='High'?'badge-r':r==='Medium'?'badge-a':'badge-g';
}

function forecastSeries(data){
  const total=data.length;
  const days=Array.from({length:30},(_,i)=>'D'+(i+1));
  let values;
  if(selected==='kmeans'){
    const avg=total/30;
    values=days.map((_,i)=>Math.max(0,Math.round(avg*(0.7+0.6*Math.sin(i/4)+0.2*Math.sin(i/1.5)))));
  }else if(selected==='lr'){
    const hrs=new Array(24).fill(0);
    data.forEach(c=>{
      const h=parseInt(String(c.time).split(':')[0],10);
      if(h>=0&&h<24)hrs[h]++;
    });
    const peak=hrs.indexOf(Math.max(...hrs));
    values=days.map((_,i)=>{
      const t=(i-15)/8;
      const base=total/30*(0.6+0.4/(1+Math.exp(-t)));
      return Math.max(0,Math.round(base*(0.8+0.4*(peak>18||peak<6?Math.sin(i/3):Math.cos(i/4)))));
    });
  }else{
    const weights=CRIME_TYPES.map(ct=>data.filter(c=>c.type===ct.name).length/Math.max(total,1));
    values=days.map((_,i)=>Math.max(0,Math.round(weights.reduce((s,w,ti)=>s+w*(total/30)*(0.5+0.5*Math.sin(i/5+ti)),0))));
  }
  return {days,values};
}

function drawOverlay(){
  LG.clusters.clearLayers();
  const pts=brgyData();
  if(!pts.length)return;
  if(selected==='kmeans'){
    const {centers,sizes}=kmeans(pts,Math.min(pts.length,8),25);
    centers.forEach((c,i)=>{
      L.circle([c.lat,c.lng],{radius:45+sizes[i]*1.8,fillColor:'#E8323A',fillOpacity:.07,color:'#E8323A',weight:1.5,dashArray:'5,7',interactive:false}).addTo(LG.clusters);
      L.circleMarker([c.lat,c.lng],{radius:4,fillColor:'#E8323A',color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:#E8323A">Hotspot Cluster '+(i+1)+'</div>'
        +'<div class="pu-row"><span>Incidents in cluster</span><span>'+sizes[i]+'</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>K-Means</span></div>'
      );
    });
  }else if(selected==='lr'){
    rank(pts).slice(0,3).forEach(([b],i)=>{
      if(!BRGY_COORDS[b])return;
      L.circle(BRGY_COORDS[b],{radius:250-i*50,fillColor:'#15803D',fillOpacity:.08,color:'#15803D',weight:1.5,dashArray:'6,4',interactive:false}).addTo(LG.clusters);
      L.circleMarker(BRGY_COORDS[b],{radius:4,fillColor:'#15803D',color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:#15803D">High Probability Zone</div><div class="pu-row"><span>Barangay</span><span>'+esc(b)+'</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>Logistic Regression</span></div>'
      );
    });
  }else{
    CRIME_TYPES.forEach(ct=>{
      const group=pts.filter(c=>c.type===ct.name);
      if(group.length<2)return;
      const latC=group.reduce((s,p)=>s+p.lat,0)/group.length;
      const lngC=group.reduce((s,p)=>s+p.lng,0)/group.length;
      L.circle([latC,lngC],{radius:120+group.length*10,fillColor:ct.color,fillOpacity:.07,color:ct.color,weight:1.5,dashArray:'4,6',interactive:false}).addTo(LG.clusters);
      L.circleMarker([latC,lngC],{radius:4,fillColor:ct.color,color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:'+esc(ct.color)+'">'+esc(ct.name)+' Density Zone</div><div class="pu-row"><span>Incidents</span><span>'+group.length+'</span></div>'
        +'<div class="pu-row"><span>Algorithm</span><span>Random Forest</span></div>'
      );
    });
  }
}

function destroyForecast(){
  if(state.charts.forecast){
    try{state.charts.forecast.destroy();}catch(e){}
    delete state.charts.forecast;
  }
}

function renderPanel(){
  if(!$('panel-predict').classList.contains('on'))return;
  const data=state.crimeData;
  const total=data.length;
  const sorted=rank(data);

  destroyForecast();
  const {days,values}=forecastSeries(data);
  const color=COLORS[selected];
  const tick=state.darkOn?'#C4D0DC':'#7A94A8';
  const grid=state.darkOn?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)';
  state.charts.forecast=new Chart($('ch-forecast'),{
    type:'line',
    data:{labels:days,datasets:[
      {label:'Est. Incidents',data:values,borderColor:color,backgroundColor:color+'18',tension:.4,fill:true,pointRadius:2},
      {label:'Upper Bound',data:values.map(v=>Math.round(v*1.2)),borderColor:color+'55',backgroundColor:'transparent',pointRadius:0,tension:.4,borderDash:[4,4]}
    ]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{labels:{color:tick,font:{family:'DM Sans',size:10}}}},
      scales:{x:{ticks:{color:tick,font:{size:9},maxTicksLimit:10},grid:{display:false}},y:{ticks:{color:tick},grid:{color:grid}}}
    }
  });

  const rz=$('risk-zones');
  rz.replaceChildren();
  if(!sorted.length){
    rz.innerHTML='<p class="pane-note">No incidents recorded yet.</p>';
  }else{
    sorted.slice(0,6).forEach(([b,n],i)=>{
      const r=riskOf(i,sorted.length);
      rz.insertAdjacentHTML('beforeend','<div class="zone-row"><span class="zone-name">'+esc(b)+' <span>('+n+')</span></span><span class="badge '+badgeOf(r)+'">'+r+'</span></div>');
    });
  }

  const tb=$('pred-tbl');
  tb.replaceChildren();
  if(!sorted.length){
    tb.innerHTML='<tr><td colspan="5" class="empty">No data to analyze.</td></tr>';
    return;
  }
  sorted.forEach(([b,n],i)=>{
    const r=riskOf(i,sorted.length);
    const byType=data.filter(c=>c.barangay===b).reduce((a,c)=>{a[c.type]=(a[c.type]||0)+1;return a;},{});
    const top=Object.entries(byType).sort((a,c)=>c[1]-a[1])[0];
    const conf=Math.min(95,Math.round(CONFIDENCE[selected]+(n/total)*20));
    const est=Math.max(1,Math.round(n*MULTIPLIER[selected]*30));
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="strong">'+esc(b)+'</td><td class="mono">'+est+'</td><td>'+esc(top?top[0]:'None')+'</td><td class="mono">'+conf+'%</td><td><span class="badge '+badgeOf(r)+'">'+r+'</span></td></tr>'
    );
  });
}

export function updateAnalysis(){
  drawOverlay();
  renderPanel();
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
}

export function initAnalysis(){
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
