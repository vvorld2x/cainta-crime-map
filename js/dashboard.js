import {CRIME_TYPES,BARANGAYS,CLOSED_STATUSES,MONTHS} from './constants.js';
import {state} from './state.js';
import {esc,$} from './util.js';

const DASH_KEYS=['trend','type','brgy','time'];

function peakPeriod(h){
  if(h>=21||h<2)return 'Night (9PM to 2AM)';
  if(h>=18)return 'Evening (6 to 9PM)';
  if(h>=12)return 'Afternoon (12 to 6PM)';
  if(h>=6)return 'Morning (6AM to 12PM)';
  return 'Dawn (2 to 6AM)';
}

function palette(){
  return state.darkOn
    ?{tick:'#C4D0DC',grid:'rgba(255,255,255,.06)',legend:'#C4D0DC',border:'#1E2732'}
    :{tick:'#7A94A8',grid:'rgba(0,0,0,.04)',legend:'#5A7A90',border:'#ffffff'};
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
}

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

  const years=data.map(c=>parseInt(String(c.date).slice(0,4),10)).filter(Number.isFinite);
  const year=years.length?Math.max(...years):new Date().getFullYear();
  const monthly=new Array(12).fill(0);
  data.forEach(c=>{
    if(String(c.date).slice(0,4)!==String(year))return;
    const m=parseInt(String(c.date).slice(5,7),10)-1;
    if(m>=0&&m<12)monthly[m]++;
  });

  const baseScales={
    x:{ticks:{color:pal.tick,font:{family:'DM Sans',size:11}},grid:{color:pal.grid}},
    y:{ticks:{color:pal.tick,font:{family:'DM Sans',size:11}},grid:{color:pal.grid}}
  };
  const base={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:baseScales};

  state.charts.trend=new Chart($('ch-trend'),{
    type:'line',
    data:{labels:MONTHS,datasets:[{label:'Incidents '+year,data:monthly,borderColor:'#1A5CFF',backgroundColor:'rgba(26,92,255,.08)',tension:.4,fill:true,pointRadius:4,pointBackgroundColor:'#1A5CFF',pointBorderColor:'#fff',pointBorderWidth:2}]},
    options:base
  });

  state.charts.type=new Chart($('ch-type'),{
    type:'doughnut',
    data:{labels:CRIME_TYPES.map(c=>c.name),datasets:[{data:CRIME_TYPES.map(c=>typeCounts[c.name]),backgroundColor:CRIME_TYPES.map(c=>c.color),borderColor:pal.border,borderWidth:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right',labels:{color:pal.legend,font:{family:'DM Sans',size:10},padding:8,boxWidth:10}}}}
  });

  const brgyCounts={};
  BARANGAYS.forEach(b=>{brgyCounts[b]=data.filter(c=>c.barangay===b).length;});
  const sorted=Object.entries(brgyCounts).sort((a,b)=>b[1]-a[1]);

  state.charts.brgy=new Chart($('ch-brgy'),{
    type:'bar',
    data:{labels:sorted.map(s=>s[0]),datasets:[{data:sorted.map(s=>s[1]),backgroundColor:'rgba(26,92,255,.75)',borderRadius:4,borderSkipped:false}]},
    options:{...base,scales:{x:{ticks:{color:pal.tick,font:{family:'DM Sans',size:9},maxRotation:45},grid:{display:false}},y:{ticks:{color:pal.tick},grid:{color:pal.grid}}}}
  });

  const hours=new Array(24).fill(0);
  data.forEach(c=>{
    const h=parseInt(String(c.time).split(':')[0],10);
    if(h>=0&&h<24)hours[h]++;
  });

  state.charts.time=new Chart($('ch-time'),{
    type:'bar',
    data:{labels:Array.from({length:24},(_,i)=>i+'h'),datasets:[{data:hours,backgroundColor:hours.map(v=>v>12?'rgba(232,50,58,.7)':v>6?'rgba(217,119,6,.7)':'rgba(26,92,255,.6)'),borderRadius:3,borderSkipped:false}]},
    options:{...base,scales:{x:{ticks:{color:pal.tick,font:{size:8}},grid:{display:false}},y:{ticks:{color:pal.tick},grid:{color:pal.grid}}}}
  });

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
    const hrs=rows.map(c=>parseInt(String(c.time).split(':')[0],10)).filter(Number.isFinite);
    const peak=hrs.length?peakPeriod(Math.round(hrs.reduce((a,h)=>a+h,0)/hrs.length)):'N/A';
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="idx">'+(i+1)+'</td><td class="strong">'+esc(b)+'</td><td class="mono">'+n+'</td><td>'+esc(topType?topType[0]:'None')+'</td><td class="small">'+esc(peak)+'</td><td><span class="badge '+badge+'">'+risk+'</span></td></tr>'
    );
  });
}
