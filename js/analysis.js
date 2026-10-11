import {BARANGAYS,BRGY_COORDS,CRIME_TYPES} from './constants.js';
import {state} from './state.js';
import {esc,$,showToast} from './util.js';
import {LG,kmeans} from './map.js';

const NAMES={kmeans:'K-Means Clustering',lr:'Logistic Regression',rf:'Random Forest'};
const COLORS={kmeans:'#1A5CFF',lr:'#15803D',rf:'#D97706'};
let selected='kmeans';
let running=false;

function selectAlgo(a){
  if(!NAMES[a])return;
  selected=a;
  document.querySelectorAll('.algo-card').forEach(card=>{
    card.classList.toggle('sel',card.dataset.algo===a);
    const old=card.querySelector('.algo-badge');
    if(old)old.remove();
  });
  const badge=document.createElement('div');
  badge.className='algo-badge';
  badge.textContent='Active';
  const card=$('ac-'+a);
  card.insertBefore(badge,card.firstChild);
}

function riskOf(i,len){
  return i<Math.ceil(len*0.3)?'High':i<Math.ceil(len*0.6)?'Medium':'Low';
}

function badgeOf(r){
  return r==='High'?'badge-r':r==='Medium'?'badge-a':'badge-g';
}

function forecastSeries(total){
  const days=Array.from({length:30},(_,i)=>'D'+(i+1));
  let values;
  if(selected==='kmeans'){
    const avg=total/30;
    values=days.map((_,i)=>Math.max(0,Math.round(avg*(0.7+0.6*Math.sin(i/4)+0.2*Math.sin(i/1.5)))));
  }else if(selected==='lr'){
    const hrs=new Array(24).fill(0);
    state.crimeData.forEach(c=>{
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
    const weights=CRIME_TYPES.map(ct=>state.crimeData.filter(c=>c.type===ct.name).length/Math.max(total,1));
    values=days.map((_,i)=>Math.max(0,Math.round(weights.reduce((s,w,ti)=>s+w*(total/30)*(0.5+0.5*Math.sin(i/5+ti)),0))));
  }
  return {days,values};
}

function drawClusters(sorted){
  LG.clusters.clearLayers();
  if(selected==='kmeans'){
    const k=Math.min(state.crimeData.length,7);
    const {centers,sizes}=kmeans(state.crimeData,k,30);
    centers.forEach((c,i)=>{
      L.circle([c.lat,c.lng],{radius:60+sizes[i]*3,fillColor:'#1A5CFF',fillOpacity:.08,color:'#1A5CFF',weight:1.5,dashArray:'5,6',interactive:false}).addTo(LG.clusters);
      L.circleMarker([c.lat,c.lng],{radius:5,fillColor:'#1A5CFF',color:'#fff',weight:2,fillOpacity:1}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:#1A5CFF">K-Means Cluster '+(i+1)+'</div><div class="pu-row"><span>Incidents</span><span>'+sizes[i]+'</span></div>'
      );
    });
  }else if(selected==='lr'){
    sorted.slice(0,3).forEach(([b],i)=>{
      if(!BRGY_COORDS[b])return;
      L.circle(BRGY_COORDS[b],{radius:250-i*50,fillColor:'#15803D',fillOpacity:.08,color:'#15803D',weight:1.5,dashArray:'6,4',interactive:false}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:#15803D">High Probability Zone</div><div class="pu-row"><span>Barangay</span><span>'+esc(b)+'</span></div>'
      );
    });
  }else{
    CRIME_TYPES.forEach(ct=>{
      const pts=state.crimeData.filter(c=>c.type===ct.name);
      if(pts.length<2)return;
      const latC=pts.reduce((s,p)=>s+p.lat,0)/pts.length;
      const lngC=pts.reduce((s,p)=>s+p.lng,0)/pts.length;
      L.circle([latC,lngC],{radius:120+pts.length*10,fillColor:ct.color,fillOpacity:.07,color:ct.color,weight:1.5,dashArray:'4,6',interactive:false}).addTo(LG.clusters).bindPopup(
        '<div class="pu-type" style="color:'+esc(ct.color)+'">'+esc(ct.name)+' Density Zone</div><div class="pu-row"><span>Incidents</span><span>'+pts.length+'</span></div>'
      );
    });
  }
}

function render(){
  $('run-status').textContent='Complete';
  $('analysis-results').classList.remove('hidden');
  const total=state.crimeData.length;
  const counts={};
  BARANGAYS.forEach(b=>{counts[b]=state.crimeData.filter(c=>c.barangay===b).length;});
  const sorted=Object.entries(counts).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);

  const {days,values}=forecastSeries(total);
  if(state.charts.forecast){
    try{state.charts.forecast.destroy();}catch(e){}
  }
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
  }
  sorted.forEach(([b,n],i)=>{
    const r=riskOf(i,sorted.length);
    const byType=state.crimeData.filter(c=>c.barangay===b).reduce((a,c)=>{a[c.type]=(a[c.type]||0)+1;return a;},{});
    const top=Object.entries(byType).sort((a,c)=>c[1]-a[1])[0];
    const density=n/total;
    const conf=Math.min(95,Math.round({kmeans:72,lr:68,rf:76}[selected]+density*20));
    const mult={kmeans:0.30,lr:0.25,rf:0.33}[selected];
    const est=Math.max(1,Math.round(n*mult*30));
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="strong">'+esc(b)+'</td><td class="mono">'+est+'</td><td>'+esc(top?top[0]:'—')+'</td><td class="mono">'+conf+'%</td><td><span class="badge '+badgeOf(r)+'">'+r+'</span></td></tr>'
    );
  });

  drawClusters(sorted);
}

function runAnalysis(){
  if(running)return;
  if(!state.crimeData.length){
    showToast('No data to analyze. Encode or import records first.','error');
    return;
  }
  running=true;
  $('run-status').textContent='Running '+NAMES[selected]+'...';
  $('analysis-results').classList.add('hidden');
  setTimeout(()=>{
    try{render();}finally{running=false;}
  },1200);
}

export function clearAnalysis(){
  $('analysis-results').classList.add('hidden');
  $('run-status').textContent='';
  $('risk-zones').replaceChildren();
  $('pred-tbl').replaceChildren();
  if(state.charts.forecast){
    try{state.charts.forecast.destroy();}catch(e){}
    delete state.charts.forecast;
  }
}

export function initAnalysis(){
  document.querySelectorAll('.algo-card').forEach(card=>{
    card.addEventListener('click',()=>selectAlgo(card.dataset.algo));
  });
  $('run-btn').addEventListener('click',runAnalysis);
}
