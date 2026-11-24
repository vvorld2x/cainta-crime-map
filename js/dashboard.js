import {CRIME_TYPES,BARANGAYS,CLOSED_STATUSES,MONTHS} from './constants.js';
import {state} from './state.js';
import {esc,$} from './util.js';
import {hour12} from './ml.js';

const DASH_KEYS=['trend','type','brgy','time'];
const DAY=86400000;
const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TITLE_COLOR='#7A94A8';

const PERIODS=[
  {key:'dawn',label:'Dawn',range:'2 to 6 AM',color:'rgba(99,102,241,.75)'},
  {key:'morning',label:'Morning',range:'6 AM to 12 PM',color:'rgba(26,92,255,.75)'},
  {key:'afternoon',label:'Afternoon',range:'12 to 6 PM',color:'rgba(217,119,6,.75)'},
  {key:'evening',label:'Evening',range:'6 to 9 PM',color:'rgba(249,115,22,.8)'},
  {key:'night',label:'Night',range:'9 PM to 2 AM',color:'rgba(232,50,58,.8)'}
];

function periodOf(h){
  if(h>=21||h<2)return 'night';
  if(h>=18)return 'evening';
  if(h>=12)return 'afternoon';
  if(h>=6)return 'morning';
  return 'dawn';
}

function periodInfo(key){
  return PERIODS.find(p=>p.key===key);
}

function palette(){
  return state.darkOn
    ?{tick:'#C4D0DC',grid:'rgba(255,255,255,.06)',legend:'#C4D0DC',border:'#1E2732'}
    :{tick:'#7A94A8',grid:'rgba(0,0,0,.04)',legend:'#5A7A90',border:'#ffffff'};
}

function pct(v){return (Math.round(v*1000)/10)+'%';}

function toMs(dateStr){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if(!m)return NaN;
  return Date.UTC(+m[1],+m[2]-1,+m[3]);
}

function hourOf(c){
  const h=parseInt(String(c.time).split(':')[0],10);
  return h>=0&&h<24?h:NaN;
}

function zoomAvailable(){
  try{return !!Chart.registry.plugins.get('zoom');}catch(e){return false;}
}

export function destroyDashboardCharts(){
  DASH_KEYS.forEach(k=>{
    if(state.charts[k]){
      try{state.charts[k].destroy();}catch(e){}
      delete state.charts[k];
    }
  });
}

export function clearDashboard(){
  destroyDashboardCharts();
  $('brgy-tbl').replaceChildren();
  const heat=$('tm-heat');
  if(heat)heat.replaceChildren();
}

/* ============================ Monthly / weekly / daily trend ============================ */

const T={gran:'month',range:'all',type:'all',from:null,to:null,label:''};
let wired=false;
let buckets=[];
let justPanned=false;
let clickTimer=null;

function bucketStart(ms,gran){
  if(gran==='day')return ms;
  if(gran==='week'){
    const dow=(new Date(ms).getUTCDay()+6)%7;
    return ms-dow*DAY;
  }
  const d=new Date(ms);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
}

function bucketNext(ms,gran){
  if(gran==='day')return ms+DAY;
  if(gran==='week')return ms+7*DAY;
  const d=new Date(ms);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);
}

function bucketLabel(ms,gran,full){
  const d=new Date(ms);
  const mon=MONTHS[d.getUTCMonth()];
  if(gran==='month')return mon+' '+d.getUTCFullYear();
  if(gran==='week')return (full?'Week of ':'')+mon+' '+d.getUTCDate()+(full?', '+d.getUTCFullYear():'');
  return mon+' '+d.getUTCDate()+(full?', '+d.getUTCFullYear():'');
}

function unitName(gran){
  return gran==='month'?'month':gran==='week'?'week':'day';
}

function rangeBounds(latest){
  if(T.from!==null)return {from:T.from,to:T.to};
  const r=T.range;
  if(r==='all')return {from:-Infinity,to:Infinity};
  if(/^y\d{4}$/.test(r)){
    const y=+r.slice(1);
    return {from:Date.UTC(y,0,1),to:Date.UTC(y+1,0,1)-1};
  }
  const days={'12m':365,'6m':182,'3m':91,'30d':30}[r]||0;
  return {from:latest-days*DAY+DAY,to:Infinity};
}

function buildTrendBuckets(){
  const all=state.crimeData.map(c=>({ms:toMs(c.date),c})).filter(o=>Number.isFinite(o.ms));
  if(!all.length)return {buckets:[],total:0};
  const latest=Math.max(...all.map(o=>o.ms));
  const {from,to}=rangeBounds(latest);
  const rows=all.filter(o=>(T.type==='all'||o.c.type===T.type)&&o.ms>=from&&o.ms<=to);
  let lo,hi;
  if(T.from!==null){lo=T.from;hi=T.to;}
  else if(rows.length){
    lo=Math.min(...rows.map(o=>o.ms));
    hi=Math.max(...rows.map(o=>o.ms));
    if(T.range!=='all'&&!/^y\d{4}$/.test(T.range)){hi=latest;lo=Math.max(lo,from);lo=from===-Infinity?lo:from;}
    if(/^y\d{4}$/.test(T.range)){lo=from;hi=Math.min(to,latest);}
  }else{
    return {buckets:[],total:0};
  }
  const map=new Map();
  rows.forEach(o=>{
    const k=bucketStart(o.ms,T.gran);
    let b=map.get(k);
    if(!b){b={n:0,types:{}};map.set(k,b);}
    b.n++;
    b.types[o.c.type]=(b.types[o.c.type]||0)+1;
  });
  const out=[];
  let cur=bucketStart(lo,T.gran);
  const end=bucketStart(hi,T.gran);
  let guard=0;
  while(cur<=end&&guard<5000){
    const b=map.get(cur)||{n:0,types:{}};
    out.push({start:cur,n:b.n,types:b.types});
    cur=bucketNext(cur,T.gran);
    guard++;
  }
  return {buckets:out,total:rows.length};
}

function populateTrendControls(){
  const years=[...new Set(state.crimeData.map(c=>parseInt(String(c.date).slice(0,4),10)).filter(Number.isFinite))].sort((a,b)=>b-a);
  const rangeSel=$('tr-range');
  const opts=[['all','All data'],['12m','Last 12 months'],['6m','Last 6 months'],['3m','Last 3 months'],['30d','Last 30 days']]
    .concat(years.map(y=>['y'+y,'Year '+y]));
  rangeSel.replaceChildren();
  opts.forEach(([v,l])=>{
    const o=document.createElement('option');
    o.value=v;o.textContent=l;
    rangeSel.appendChild(o);
  });
  if(!opts.some(o=>o[0]===T.range))T.range='all';
  rangeSel.value=T.range;
  const typeSel=$('tr-type');
  if(!typeSel.options.length){
    const all=document.createElement('option');
    all.value='all';all.textContent='All crime types';
    typeSel.appendChild(all);
    CRIME_TYPES.forEach(ct=>{
      const o=document.createElement('option');
      o.value=ct.name;o.textContent=ct.name;
      typeSel.appendChild(o);
    });
  }
  typeSel.value=T.type;
  $('tr-gran').value=T.gran;
}

function renderCrumb(){
  const el=$('tr-crumb');
  if(T.from===null){
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.classList.remove('hidden');
  el.replaceChildren();
  const span=document.createElement('span');
  span.textContent='Drilled into '+T.label+' ('+unitName(T.gran)+' by '+unitName(T.gran)+')';
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='ctl-btn';
  btn.textContent='Back to full view';
  btn.addEventListener('click',()=>{
    T.from=null;T.to=null;T.label='';
    T.gran=T.prevGran||'month';
    populateTrendControls();
    renderTrend();
  });
  el.append(span,btn);
}

function drillInto(index){
  const b=buckets[index];
  if(!b||T.gran==='day')return;
  const label=bucketLabel(b.start,T.gran,true);
  T.prevGran=T.gran;
  T.from=b.start;
  T.to=bucketNext(b.start,T.gran)-1;
  T.label=label;
  T.gran='day';
  $('tr-gran').value='day';
  renderTrend();
}

function renderTrend(){
  if(state.charts.trend){
    try{state.charts.trend.destroy();}catch(e){}
    delete state.charts.trend;
  }
  renderCrumb();
  const pal=palette();
  const res=buildTrendBuckets();
  buckets=res.buckets;
  const insight=$('tr-insight');
  if(!buckets.length){
    insight.textContent='No incidents match these filters.';
    return;
  }
  const unit=unitName(T.gran);
  const counts=buckets.map(b=>b.n);
  const total=res.total;
  const maxN=Math.max(...counts);
  const peak=buckets[counts.indexOf(maxN)];
  const avg=total/buckets.length;
  const ma=counts.map((_,i)=>{
    const s=counts.slice(Math.max(0,i-2),i+1);
    return +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
  });
  const last=counts[counts.length-1];
  const prev=counts.length>1?counts[counts.length-2]:null;
  let change='';
  if(prev!==null){
    const diff=last-prev;
    change=' Latest '+unit+': '+last+' ('+(diff>=0?'+':'')+diff+' vs the '+unit+' before).';
  }
  insight.textContent=total+' incidents across '+buckets.length+' '+unit+(buckets.length===1?'':'s')+'. Busiest: '+bucketLabel(peak.start,T.gran,true)+' with '+maxN+'. Average: '+avg.toFixed(1)+' per '+unit+'.'+change;
  const gl={month:'Month',week:'Week starting (Monday)',day:'Day'};
  const zoomOn=zoomAvailable();
  const showMA=buckets.length>=4;
  const datasets=[{
    type:'bar',
    label:'Incidents per '+unit,
    data:counts,
    backgroundColor:counts.map(v=>v===maxN&&maxN>0?'rgba(232,50,58,.8)':'rgba(26,92,255,.7)'),
    borderRadius:3,
    borderSkipped:false,
    order:2
  }];
  if(showMA){
    datasets.push({
      type:'line',
      label:'3-'+unit+' moving average',
      data:ma,
      borderColor:'#D97706',
      backgroundColor:'transparent',
      borderWidth:2,
      pointRadius:0,
      pointHitRadius:6,
      tension:0,
      order:1
    });
  }
  const ctx=$('ch-trend');
  state.charts.trend=new Chart(ctx,{
    data:{labels:buckets.map(b=>bucketLabel(b.start,T.gran,false)),datasets},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      onClick:(evt,els,chart)=>{
        if(justPanned)return;
        const hit=chart.getElementsAtEventForMode(evt,'index',{intersect:false},true);
        if(!hit.length)return;
        const idx=hit[0].index;
        clearTimeout(clickTimer);
        clickTimer=setTimeout(()=>drillInto(idx),260);
      },
      onHover:(evt,els)=>{
        ctx.style.cursor=T.gran!=='day'&&els.length?'pointer':'default';
      },
      plugins:{
        legend:{display:showMA,labels:{color:pal.legend,font:{family:'DM Sans',size:10},boxWidth:12}},
        tooltip:{
          callbacks:{
            title:items=>{
              const b=buckets[items[0].dataIndex];
              return bucketLabel(b.start,T.gran,true);
            },
            label:item=>{
              if(item.dataset.type==='line')return item.dataset.label+': '+item.parsed.y;
              const n=item.parsed.y;
              return n+' incident'+(n===1?'':'s')+' ('+pct(total?n/total:0)+' of the '+total+' shown)';
            },
            afterBody:items=>{
              const i=items[0].dataIndex;
              const b=buckets[i];
              const lines=[];
              if(i>0){
                const d=b.n-buckets[i-1].n;
                lines.push((d>=0?'+':'')+d+' vs previous '+unit);
              }
              const top=Object.entries(b.types).sort((a,c)=>c[1]-a[1]).slice(0,3);
              if(top.length)lines.push('Top: '+top.map(t=>t[0]+' '+t[1]).join(', '));
              if(T.gran!=='day')lines.push('Click to see day by day');
              return lines;
            }
          }
        },
        zoom:zoomOn?{
          limits:{x:{min:'original',max:'original',minRange:3}},
          pan:{enabled:true,mode:'x',onPanStart:()=>{justPanned=true;},onPanComplete:()=>{setTimeout(()=>{justPanned=false;},250);}},
          zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'}
        }:{}
      },
      scales:{
        x:{title:{display:true,text:gl[T.gran],color:TITLE_COLOR,font:{size:10}},ticks:{color:pal.tick,font:{family:'DM Sans',size:10},maxRotation:50,autoSkip:true,maxTicksLimit:T.gran==='day'?16:14},grid:{display:false}},
        y:{beginAtZero:true,suggestedMax:Math.max(3,maxN),title:{display:true,text:'Number of incidents',color:TITLE_COLOR,font:{size:10}},ticks:{color:pal.tick,precision:0,font:{family:'DM Sans',size:11}},grid:{color:pal.grid}}
      }
    }
  });
  $('tr-hint').classList.toggle('hidden',!zoomOn);
}

/* ============================ Time of day ============================ */

const TM={view:'hour',type:'all'};

function timeRows(){
  return state.crimeData.filter(c=>TM.type==='all'||c.type===TM.type);
}

function populateTimeControls(){
  const typeSel=$('tm-type');
  if(!typeSel.options.length){
    const all=document.createElement('option');
    all.value='all';all.textContent='All crime types';
    typeSel.appendChild(all);
    CRIME_TYPES.forEach(ct=>{
      const o=document.createElement('option');
      o.value=ct.name;o.textContent=ct.name;
      typeSel.appendChild(o);
    });
  }
  typeSel.value=TM.type;
  $('tm-view').value=TM.view;
}

function renderTime(){
  if(state.charts.time){
    try{state.charts.time.destroy();}catch(e){}
    delete state.charts.time;
  }
  const pal=palette();
  const rows=timeRows();
  const heat=$('tm-heat');
  const box=$('tm-chart-box');
  const note=$('tm-note');
  heat.replaceChildren();
  const hours=new Array(24).fill(0);
  const grid=DOW.map(()=>new Array(24).fill(0));
  let used=0;
  rows.forEach(c=>{
    const h=hourOf(c);
    if(!Number.isFinite(h))return;
    hours[h]++;
    used++;
    const ms=toMs(c.date);
    if(Number.isFinite(ms)){
      const d=(new Date(ms).getUTCDay()+6)%7;
      grid[d][h]++;
    }
  });
  const periods={dawn:0,morning:0,afternoon:0,evening:0,night:0};
  hours.forEach((n,h)=>{periods[periodOf(h)]+=n;});

  if(!used){
    heat.classList.add('hidden');
    box.classList.remove('hidden');
    note.textContent='No incidents with a valid time for this selection.';
    return;
  }

  if(TM.view==='heat'){
    box.classList.add('hidden');
    heat.classList.remove('hidden');
    renderHeat(heat,grid,used);
    let best={n:-1,d:0,h:0};
    grid.forEach((row,d)=>row.forEach((n,h)=>{if(n>best.n)best={n,d,h};}));
    note.textContent='Busiest slot: '+DOW[best.d]+' around '+hour12(best.h)+' ('+best.n+' incident'+(best.n===1?'':'s')+').';
    return;
  }
  heat.classList.add('hidden');
  box.classList.remove('hidden');

  let labels,data,colors,xTitle,tipTitle,tipExtra;
  if(TM.view==='hour'){
    labels=Array.from({length:24},(_,h)=>hour12(h));
    data=hours;
    colors=hours.map((_,h)=>periodInfo(periodOf(h)).color);
    xTitle='Hour of day (e.g. 10 PM means 10:00 to 10:59 PM)';
    tipTitle=items=>{
      const h=items[0].dataIndex;
      return hour12(h)+' to '+hour12((h+1)%24)+' ('+periodInfo(periodOf(h)).label+')';
    };
    tipExtra=()=>[];
  }else{
    labels=PERIODS.map(p=>p.label+' ('+p.range+')');
    data=PERIODS.map(p=>periods[p.key]);
    colors=PERIODS.map(p=>p.color);
    xTitle='Time period';
    tipTitle=items=>labels[items[0].dataIndex];
    tipExtra=()=>[];
  }
  const maxN=Math.max(...data);
  state.charts.time=new Chart($('ch-time'),{
    type:'bar',
    data:{labels,datasets:[{label:'Incidents',data,backgroundColor:colors,borderRadius:3,borderSkipped:false}]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{
          title:tipTitle,
          label:item=>{
            const n=item.parsed.y;
            return n+' incident'+(n===1?'':'s')+' ('+pct(n/used)+' of '+used+')';
          },
          afterBody:tipExtra
        }}
      },
      scales:{
        x:{title:{display:true,text:xTitle,color:TITLE_COLOR,font:{size:10}},ticks:{color:pal.tick,font:{family:'DM Sans',size:TM.view==='hour'?9:10},maxRotation:TM.view==='hour'?60:0,autoSkip:false},grid:{display:false}},
        y:{beginAtZero:true,suggestedMax:Math.max(3,maxN),title:{display:true,text:'Number of incidents',color:TITLE_COLOR,font:{size:10}},ticks:{color:pal.tick,precision:0},grid:{color:pal.grid}}
      }
    }
  });
  const peakH=hours.indexOf(Math.max(...hours));
  const topP=PERIODS.slice().sort((a,b)=>periods[b.key]-periods[a.key])[0];
  note.textContent=TM.view==='hour'
    ?'Busiest hour: '+hour12(peakH)+' ('+hours[peakH]+' incidents, '+pct(hours[peakH]/used)+'). Busiest period: '+topP.label+' ('+pct(periods[topP.key]/used)+').'
    :'Busiest period: '+topP.label+' ('+topP.range+'), '+periods[topP.key]+' incidents, '+pct(periods[topP.key]/used)+'.';
}

function renderHeat(el,grid,used){
  const max=Math.max(1,...grid.map(r=>Math.max(...r)));
  const wrap=document.createElement('div');
  wrap.className='heat-grid';
  const corner=document.createElement('div');
  corner.className='heat-lbl';
  wrap.appendChild(corner);
  for(let h=0;h<24;h++){
    const c=document.createElement('div');
    c.className='heat-lbl heat-hr';
    c.textContent=h%3===0?hour12(h).replace(' ',''):'';
    wrap.appendChild(c);
  }
  grid.forEach((row,d)=>{
    const l=document.createElement('div');
    l.className='heat-lbl heat-day';
    l.textContent=DOW[d];
    wrap.appendChild(l);
    row.forEach((n,h)=>{
      const cell=document.createElement('div');
      cell.className='heat-cell';
      cell.style.background=n===0?'var(--mist2)':'rgba(232,50,58,'+(0.18+0.82*n/max).toFixed(2)+')';
      cell.title=DOW[d]+' '+hour12(h)+': '+n+' incident'+(n===1?'':'s')+' ('+pct(n/used)+')';
      wrap.appendChild(cell);
    });
  });
  const legend=document.createElement('div');
  legend.className='heat-legend';
  legend.textContent='0';
  const bar=document.createElement('span');
  bar.className='heat-bar';
  const maxLbl=document.createElement('span');
  maxLbl.textContent=String(max);
  legend.append(bar,maxLbl);
  el.append(wrap,legend);
}

/* ============================ wiring ============================ */

function wireControls(){
  if(wired)return;
  wired=true;
  $('tr-gran').addEventListener('change',e=>{
    T.gran=e.target.value;
    if(T.from!==null){T.from=null;T.to=null;T.label='';}
    renderTrend();
  });
  $('tr-range').addEventListener('change',e=>{
    T.range=e.target.value;
    T.from=null;T.to=null;T.label='';
    if(T.range==='30d'||T.range==='3m'){if(T.gran==='month'){T.gran='week';$('tr-gran').value='week';}}
    renderTrend();
  });
  $('tr-type').addEventListener('change',e=>{
    T.type=e.target.value;
    renderTrend();
  });
  $('ch-trend').addEventListener('dblclick',()=>{
    clearTimeout(clickTimer);
    const c=state.charts.trend;
    if(c&&c.resetZoom)c.resetZoom();
  });
  $('tm-view').addEventListener('change',e=>{TM.view=e.target.value;renderTime();});
  $('tm-type').addEventListener('change',e=>{TM.type=e.target.value;renderTime();});
}

/* ============================ main build ============================ */

export function buildDashboard(){
  const data=state.crimeData;
  const total=data.length;
  const solved=data.filter(c=>CLOSED_STATUSES.includes(c.status)).length;
  const active=total-solved;
  const typeCounts={};
  CRIME_TYPES.forEach(ct=>{typeCounts[ct.name]=data.filter(c=>c.type===ct.name).length;});
  const top=Object.entries(typeCounts).sort((a,b)=>b[1]-a[1])[0]||['None',0];
  $('d-total').textContent=String(total);
  $('d-trend').textContent=total+' total records';
  $('d-solved').textContent=String(solved);
  $('d-active').textContent=String(active);
  $('d-topn').textContent=String(top[1]);
  $('d-topt').textContent=top[0];

  destroyDashboardCharts();
  const pal=palette();

  wireControls();
  populateTrendControls();
  populateTimeControls();
  renderTrend();

  state.charts.type=new Chart($('ch-type'),{
    type:'doughnut',
    data:{labels:CRIME_TYPES.map(c=>c.name),datasets:[{data:CRIME_TYPES.map(c=>typeCounts[c.name]),backgroundColor:CRIME_TYPES.map(c=>c.color),borderColor:pal.border,borderWidth:3}]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{position:'right',labels:{color:pal.legend,font:{family:'DM Sans',size:10},padding:8,boxWidth:10}},
        tooltip:{callbacks:{label:item=>{
          const n=item.parsed;
          return item.label+': '+n+' ('+pct(total?n/total:0)+')';
        }}}
      }
    }
  });

  const brgyCounts={};
  BARANGAYS.forEach(b=>{brgyCounts[b]=data.filter(c=>c.barangay===b).length;});
  const sorted=Object.entries(brgyCounts).sort((a,b)=>b[1]-a[1]);

  state.charts.brgy=new Chart($('ch-brgy'),{
    type:'bar',
    data:{labels:sorted.map(s=>s[0]),datasets:[{label:'Incidents',data:sorted.map(s=>s[1]),backgroundColor:'rgba(26,92,255,.75)',borderRadius:4,borderSkipped:false}]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:pal.tick,font:{family:'DM Sans',size:9},maxRotation:45},grid:{display:false}},
        y:{beginAtZero:true,title:{display:true,text:'Number of incidents',color:TITLE_COLOR,font:{size:10}},ticks:{color:pal.tick,precision:0},grid:{color:pal.grid}}
      }
    }
  });

  renderTime();

  const tb=$('brgy-tbl');
  tb.replaceChildren();
  if(!data.length){
    tb.innerHTML='<tr><td colspan="6" class="empty">No data encoded yet.</td></tr>';
    return;
  }
  const ranked=sorted.filter(([,n])=>n>0);
  ranked.forEach(([b,n],i)=>{
    const risk=i<ranked.length*0.3?'High':i<ranked.length*0.6?'Medium':'Low';
    const badge=risk==='High'?'badge-r':risk==='Medium'?'badge-a':'badge-g';
    const rows=data.filter(c=>c.barangay===b);
    const byType=rows.reduce((acc,c)=>{acc[c.type]=(acc[c.type]||0)+1;return acc;},{});
    const topType=Object.entries(byType).sort((a,c)=>c[1]-a[1])[0];
    const per={dawn:0,morning:0,afternoon:0,evening:0,night:0};
    let counted=0;
    rows.forEach(c=>{
      const h=hourOf(c);
      if(Number.isFinite(h)){per[periodOf(h)]++;counted++;}
    });
    let peak='N/A';
    if(counted){
      const best=PERIODS.slice().sort((a,c)=>per[c.key]-per[a.key])[0];
      peak=best.label+' ('+best.range+')';
    }
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="idx">'+(i+1)+'</td><td class="strong">'+esc(b)+'</td><td class="mono">'+n+'</td><td>'+esc(topType?topType[0]:'None')+'</td><td class="small">'+esc(peak)+'</td><td><span class="badge '+badge+'">'+risk+'</span></td></tr>'
    );
  });
}
