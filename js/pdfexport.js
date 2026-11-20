import {BARANGAYS,BRGY_COORDS,CRIME_TYPES,CLOSED_STATUSES,STATUSES,MONTHS} from './constants.js';
import {state} from './state.js';
import {showToast} from './util.js';
import {hour12} from './ml.js';
import {CARTO_KEY} from './config.js';

const W=960;
const H=540;
const MX=40;
const HEAD=64;
const DAY=86400000;
const ROWS_PER_PAGE=15;
const LIST_CAP=500;

const INK='#0F1923';
const INK2='#1E2D3D';
const GHOST='#7A94A8';
const GHOST2='#5A7A90';
const WIRE='#C8D5E0';
const MIST='#F5F7FA';
const MIST2='#EBF0F5';
const ACCENT='#1A5CFF';
const RED='#E8323A';
const AMBER='#D97706';
const GREEN='#15803D';
const FONT={family:'DM Sans, sans-serif',size:11};

const DOW_SHORT=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DOW_FULL=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

const PERIODS=[
  {key:'dawn',label:'Dawn',range:'2 to 6 AM',color:'#6366F1'},
  {key:'morning',label:'Morning',range:'6 AM to 12 PM',color:'#1A5CFF'},
  {key:'afternoon',label:'Afternoon',range:'12 to 6 PM',color:'#D97706'},
  {key:'evening',label:'Evening',range:'6 to 9 PM',color:'#F97316'},
  {key:'night',label:'Night',range:'9 PM to 2 AM',color:'#E8323A'}
];

const STATUS_COLORS={
  'Under Investigation':'#D97706',
  'Ongoing Investigation':'#1A5CFF',
  'Solved':'#15803D',
  'Cleared':'#0E7490'
};

const SHORT_TYPE={
  'Physical Injury':'Phys. Injury',
  'Carnapping (MC)':'Carnap (MC)',
  'Carnapping (MV)':'Carnap (MV)'
};

const PRESETS=[
  ['all','All data'],
  ['30d','Last 30 days'],
  ['3m','Last 3 months'],
  ['6m','Last 6 months'],
  ['12m','Last 12 months']
];

const SECTIONS=[
  ['types','Crime type breakdown'],
  ['trend','Trend over time'],
  ['brgy','Barangay ranking'],
  ['time','Time of day and weekday'],
  ['status','Case status and clearance'],
  ['matrix','Crime type by barangay'],
  ['spatial','Incident location plot'],
  ['list','Incident list (appendix)']
];

const S={
  preset:'all',
  from:'',
  to:'',
  types:new Set(CRIME_TYPES.map(c=>c.name)),
  brgys:new Set(BARANGAYS),
  sections:new Set(['types','trend','brgy','time','status','matrix','spatial'])
};

let modal=null;
let busy=false;

function toMs(dateStr){
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if(!m)return NaN;
  return Date.UTC(+m[1],+m[2]-1,+m[3]);
}

function fmtDate(ms){
  const d=new Date(ms);
  return MONTHS[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear();
}

function pct(v){
  return (Math.round(v*1000)/10)+'%';
}

function plural(n,word){
  return n+' '+word+(n===1?'':'s');
}

function safe(value){
  return String(value===null||value===undefined?'':value).replace(/[^\x20-\x7E\xA0-\xFF]/g,' ');
}

function hourOf(c){
  const h=parseInt(String(c.time).split(':')[0],10);
  return h>=0&&h<24?h:NaN;
}

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

function dataBounds(){
  let lo=Infinity;
  let hi=-Infinity;
  state.crimeData.forEach(c=>{
    const v=toMs(c.date);
    if(!Number.isFinite(v))return;
    if(v<lo)lo=v;
    if(v>hi)hi=v;
  });
  return {lo,hi};
}

function resolveRange(){
  const {lo,hi}=dataBounds();
  if(!Number.isFinite(hi))return {from:-Infinity,to:Infinity,start:NaN,end:NaN,bounded:false,valid:false};
  const p=S.preset;
  if(p==='all')return {from:-Infinity,to:Infinity,start:lo,end:hi,bounded:false,valid:true};
  if(p==='custom'){
    let f=S.from?toMs(S.from):NaN;
    let t=S.to?toMs(S.to):NaN;
    if(Number.isFinite(f)&&Number.isFinite(t)&&f>t){const x=f;f=t;t=x;}
    const from=Number.isFinite(f)?f:-Infinity;
    const to=Number.isFinite(t)?t:Infinity;
    return {from,to,start:Number.isFinite(f)?f:lo,end:Number.isFinite(t)?t:hi,bounded:Number.isFinite(f)&&Number.isFinite(t),valid:true};
  }
  if(/^y\d{4}$/.test(p)){
    const y=+p.slice(1);
    const from=Date.UTC(y,0,1);
    const to=Date.UTC(y,11,31);
    return {from,to,start:from,end:to,bounded:true,valid:true};
  }
  const days={'12m':365,'6m':182,'3m':91,'30d':30}[p]||30;
  const from=hi-(days-1)*DAY;
  return {from,to:hi,start:from,end:hi,bounded:true,valid:true};
}

function inRange(c,range){
  const ms=toMs(c.date);
  return Number.isFinite(ms)&&ms>=range.from&&ms<=range.to;
}

function selectRows(range,types,brgys){
  return state.crimeData.filter(c=>inRange(c,range)&&types.has(c.type)&&brgys.has(c.barangay));
}

function tally(rows,key){
  const out={};
  rows.forEach(c=>{out[c[key]]=(out[c[key]]||0)+1;});
  return out;
}

function timeStats(rows){
  const hours=new Array(24).fill(0);
  const dows=new Array(7).fill(0);
  const periods={dawn:0,morning:0,afternoon:0,evening:0,night:0};
  let used=0;
  rows.forEach(c=>{
    const h=hourOf(c);
    if(!Number.isFinite(h))return;
    hours[h]++;
    periods[periodOf(h)]++;
    used++;
  });
  rows.forEach(c=>{
    const ms=toMs(c.date);
    if(Number.isFinite(ms))dows[(new Date(ms).getUTCDay()+6)%7]++;
  });
  return {hours,dows,periods,used};
}

function bucketStart(ms,gran){
  if(gran==='day')return ms;
  if(gran==='week')return ms-((new Date(ms).getUTCDay()+6)%7)*DAY;
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

function buildBuckets(rows,start,end){
  const spanDays=Math.round((end-start)/DAY)+1;
  const gran=spanDays<=62?'day':spanDays<=210?'week':'month';
  const map=new Map();
  rows.forEach(c=>{
    const ms=toMs(c.date);
    if(!Number.isFinite(ms))return;
    const k=bucketStart(ms,gran);
    map.set(k,(map.get(k)||0)+1);
  });
  const out=[];
  let cur=bucketStart(start,gran);
  const last=bucketStart(end,gran);
  let guard=0;
  while(cur<=last&&guard<3000){
    out.push({start:cur,n:map.get(cur)||0});
    cur=bucketNext(cur,gran);
    guard++;
  }
  return {gran,buckets:out};
}

function mix(t){
  const r=Math.round(255+(26-255)*t);
  const g=Math.round(255+(92-255)*t);
  const b=255;
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function rect(doc,x,y,w,h,fill,radius){
  doc.setFillColor(fill);
  if(radius)doc.roundedRect(x,y,w,h,radius,radius,'F');
  else doc.rect(x,y,w,h,'F');
}

function text(doc,str,x,y,size,color,style,opts){
  doc.setFont('helvetica',style||'normal');
  doc.setFontSize(size);
  doc.setTextColor(color);
  doc.text(safe(str),x,y,opts||{});
}

function wrap(doc,str,width,size,style){
  doc.setFont('helvetica',style||'normal');
  doc.setFontSize(size);
  return doc.splitTextToSize(safe(str),width);
}

function fit(doc,str,maxW,size,style){
  doc.setFont('helvetica',style||'normal');
  doc.setFontSize(size);
  let s=safe(str);
  if(doc.getTextWidth(s)<=maxW)return s;
  while(s.length>1&&doc.getTextWidth(s+'...')>maxW)s=s.slice(0,-1);
  return s.trimEnd()+'...';
}

function header(doc,title,sub){
  rect(doc,0,0,W,HEAD,INK);
  rect(doc,0,HEAD,W,4,ACCENT);
  text(doc,title,MX,39,22,'#FFFFFF','bold');
  if(sub)text(doc,sub,W-MX,39,11,'#A8BBC8','normal',{align:'right'});
}

function statCards(doc,items,y,h,valueSize){
  const gap=14;
  const w=(W-2*MX-gap*(items.length-1))/items.length;
  items.forEach((it,i)=>{
    const x=MX+i*(w+gap);
    rect(doc,x,y,w,h,MIST,8);
    rect(doc,x,y+10,4,h-20,it.col||ACCENT);
    text(doc,fit(doc,it.l.toUpperCase(),w-34,9,'bold'),x+18,y+22,9,GHOST2,'bold');
    text(doc,fit(doc,it.v,w-34,valueSize,'bold'),x+18,y+24+valueSize,valueSize,it.vc||INK,'bold');
    if(it.s)text(doc,fit(doc,it.s,w-34,10,'normal'),x+18,y+24+valueSize+17,10,GHOST2,'normal');
  });
}

function table(doc,x,y,cols,rows,o){
  const rh=o.rh||28;
  const hh=o.hh||26;
  const size=o.size||11;
  const tw=cols.reduce((a,c)=>a+c.w,0);
  rect(doc,x,y,tw,hh,INK2);
  let cx=x;
  cols.forEach(col=>{
    const opts={baseline:'middle'};
    let tx=cx+10;
    if(col.align==='right'){tx=cx+col.w-10;opts.align='right';}
    if(col.align==='center'){tx=cx+col.w/2;opts.align='center';}
    text(doc,col.label.toUpperCase(),tx,y+hh/2,8,'#FFFFFF','bold',opts);
    cx+=col.w;
  });
  rows.forEach((r,i)=>{
    const ry=y+hh+i*rh;
    if(r.fill)rect(doc,x,ry,tw,rh,r.fill);
    else if(i%2===0)rect(doc,x,ry,tw,rh,MIST);
    let px=x;
    r.cells.forEach((cell,j)=>{
      const col=cols[j];
      const style=r.bold?'bold':'normal';
      const opts={baseline:'middle'};
      let tx=px+10;
      if(j===0&&r.dot){
        doc.setFillColor(r.dot);
        doc.circle(px+16,ry+rh/2,4,'F');
        tx=px+28;
      }
      if(col.align==='right'){tx=px+col.w-10;opts.align='right';}
      if(col.align==='center'){tx=px+col.w/2;opts.align='center';}
      if(cell&&typeof cell==='object'&&cell.badge){
        const bw=52;
        const bx=col.align==='center'?px+col.w/2-bw/2:px+10;
        rect(doc,bx,ry+rh/2-9,bw,18,cell.bg,9);
        text(doc,cell.badge,bx+bw/2,ry+rh/2,9,cell.color,'bold',{align:'center',baseline:'middle'});
      }else{
        const avail=col.w-(j===0&&r.dot?38:20);
        text(doc,fit(doc,cell,avail,size,style),tx,ry+rh/2,size,r.color||INK2,style,opts);
      }
      px+=col.w;
    });
  });
  return y+hh+rows.length*rh;
}

const whiteBg={
  id:'whiteBg',
  beforeDraw(chart){
    const c=chart.ctx;
    c.save();
    c.globalCompositeOperation='destination-over';
    c.fillStyle='#FFFFFF';
    c.fillRect(0,0,chart.width,chart.height);
    c.restore();
  }
};

function valueLabels(horizontal,limit){
  return {
    id:'valueLabels',
    afterDatasetsDraw(chart){
      const ds=chart.data.datasets[0];
      if(!ds||(limit&&ds.data.length>limit))return;
      const meta=chart.getDatasetMeta(0);
      const c=chart.ctx;
      c.save();
      c.fillStyle=INK2;
      c.font='600 11px DM Sans, sans-serif';
      meta.data.forEach((el,i)=>{
        const v=ds.data[i];
        if(!v)return;
        if(horizontal){
          c.textAlign='left';
          c.textBaseline='middle';
          c.fillText(String(v),el.x+6,el.y);
        }else{
          c.textAlign='center';
          c.textBaseline='bottom';
          c.fillText(String(v),el.x,el.y-3);
        }
      });
      c.restore();
    }
  };
}

function centerText(total){
  return {
    id:'centerText',
    afterDraw(chart){
      const a=chart.chartArea;
      const c=chart.ctx;
      const cx=(a.left+a.right)/2;
      const cy=(a.top+a.bottom)/2;
      c.save();
      c.textAlign='center';
      c.textBaseline='middle';
      c.fillStyle=INK;
      c.font='700 38px DM Sans, sans-serif';
      c.fillText(String(total),cx,cy-8);
      c.fillStyle=GHOST2;
      c.font='500 13px DM Sans, sans-serif';
      c.fillText('incidents',cx,cy+22);
      c.restore();
    }
  };
}

function renderChart(config,w,h){
  const host=document.createElement('div');
  host.style.cssText='position:fixed;left:-10000px;top:0;width:'+w+'px;height:'+h+'px;pointer-events:none';
  const canvas=document.createElement('canvas');
  canvas.width=w;
  canvas.height=h;
  host.appendChild(canvas);
  document.body.appendChild(host);
  config.options=Object.assign({responsive:false,animation:false,devicePixelRatio:2},config.options||{});
  config.plugins=(config.plugins||[]).concat([whiteBg]);
  let url='';
  try{
    const chart=new Chart(canvas,config);
    url=canvas.toDataURL('image/png');
    chart.destroy();
  }finally{
    host.remove();
  }
  return url;
}

function placeImage(doc,url,x,y,w,h){
  doc.addImage(url,'PNG',x,y,w,h,undefined,'FAST');
}

function xAxis(title,extra){
  return Object.assign({title:{display:!!title,text:title||'',color:GHOST,font:{family:FONT.family,size:11}},ticks:{color:GHOST2,font:FONT},grid:{display:false}},extra||{});
}

function yAxis(title,max,extra){
  return Object.assign({beginAtZero:true,suggestedMax:max,title:{display:!!title,text:title||'',color:GHOST,font:{family:FONT.family,size:11}},ticks:{color:GHOST2,precision:0,font:FONT},grid:{color:'rgba(0,0,0,.07)'}},extra||{});
}

function slideTypes(doc,c){
  doc.addPage();
  header(doc,'Crime Type Distribution',c.rangeShort);
  const list=c.typeList;
  const img=renderChart({
    type:'doughnut',
    data:{labels:list.map(t=>t.name),datasets:[{data:list.map(t=>t.n),backgroundColor:list.map(t=>t.color),borderColor:'#FFFFFF',borderWidth:3}]},
    options:{cutout:'60%',plugins:{legend:{display:false}}},
    plugins:[centerText(c.total)]
  },380,380);
  placeImage(doc,img,MX,96,380,380);
  const cols=[{label:'Crime type',w:210},{label:'Cases',w:80,align:'right'},{label:'Share',w:80,align:'right'},{label:'Cleared',w:100,align:'right'}];
  const rows=list.map(t=>({dot:t.color,cells:[t.name,String(t.n),pct(t.n/c.total),pct(t.closed/t.n)]}));
  rows.push({bold:true,fill:MIST2,cells:['Total',String(c.total),'100%',pct(c.closed/c.total)]});
  const rh=rows.length>9?26:30;
  table(doc,450,104,cols,rows,{rh,hh:28});
}

function slideTrend(doc,c){
  doc.addPage();
  header(doc,'Crime Trend Over Time',c.rangeShort);
  const {gran,buckets}=c.trend;
  const unit=gran==='month'?'month':gran==='week'?'week':'day';
  const counts=buckets.map(b=>b.n);
  const maxN=Math.max(...counts);
  const ma=counts.map((_,i)=>{
    const s=counts.slice(Math.max(0,i-2),i+1);
    return +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
  });
  const showMA=buckets.length>=4;
  const datasets=[{
    type:'bar',
    label:'Incidents per '+unit,
    data:counts,
    backgroundColor:counts.map(v=>v===maxN&&maxN>0?'rgba(232,50,58,.85)':'rgba(26,92,255,.75)'),
    borderRadius:3,
    borderSkipped:false,
    order:2
  }];
  if(showMA){
    datasets.push({type:'line',label:'3-'+unit+' moving average',data:ma,borderColor:AMBER,backgroundColor:'transparent',borderWidth:2.5,pointRadius:0,tension:0,order:1});
  }
  const img=renderChart({
    data:{labels:buckets.map(b=>bucketLabel(b.start,gran,false)),datasets},
    options:{
      plugins:{legend:{display:showMA,labels:{color:GHOST2,font:FONT,boxWidth:14}}},
      layout:{padding:{top:6,right:8}},
      scales:{
        x:xAxis('',{ticks:{color:GHOST2,font:FONT,maxRotation:50,autoSkip:true,maxTicksLimit:gran==='day'?20:16}}),
        y:yAxis('',Math.max(3,Math.ceil(maxN*1.18)))
      }
    },
    plugins:[valueLabels(false,18)]
  },880,300);
  placeImage(doc,img,MX,92,880,300);
  const peak=buckets[counts.indexOf(maxN)];
  const total=counts.reduce((a,b)=>a+b,0);
  const last=counts[counts.length-1];
  const prev=counts.length>1?counts[counts.length-2]:null;
  const cards=[
    {v:bucketLabel(peak.start,gran,true),l:'Busiest '+unit,s:plural(maxN,'incident'),col:RED},
    {v:(total/buckets.length).toFixed(1),l:'Average per '+unit,col:ACCENT}
  ];
  if(prev!==null){
    const diff=last-prev;
    cards.push({v:(diff>0?'+':'')+diff,l:'Latest '+unit+' vs previous',s:last+' now, '+prev+' before',col:diff>0?RED:diff<0?GREEN:GHOST2});
  }else{
    cards.push({v:String(last),l:'Latest '+unit,col:GHOST2});
  }
  statCards(doc,cards,404,84,22);
}

function slideBrgy(doc,c){
  doc.addPage();
  header(doc,'Incidents by Barangay',c.rangeShort);
  const list=c.brgyRank;
  const maxN=Math.max(...list.map(b=>b.n));
  const img=renderChart({
    type:'bar',
    data:{labels:list.map(b=>b.name),datasets:[{label:'Incidents',data:list.map(b=>b.n),backgroundColor:list.map((b,i)=>i===0?'rgba(232,50,58,.85)':'rgba(26,92,255,.75)'),borderRadius:4,borderSkipped:false}]},
    options:{
      indexAxis:'y',
      plugins:{legend:{display:false}},
      layout:{padding:{right:16}},
      scales:{
        x:yAxis('',Math.max(3,Math.ceil(maxN*1.2))),
        y:{ticks:{color:INK2,font:{family:FONT.family,size:11}},grid:{display:false}}
      }
    },
    plugins:[valueLabels(true,0)]
  },340,380);
  placeImage(doc,img,MX,96,340,380);
  const cols=[
    {label:'#',w:28},
    {label:'Barangay',w:146},
    {label:'Cases',w:50,align:'right'},
    {label:'Share',w:54,align:'right'},
    {label:'Top crime',w:120},
    {label:'Peak time',w:72},
    {label:'Risk',w:70,align:'center'}
  ];
  const badge={
    High:{bg:'#FBE0E1',color:RED},
    Medium:{bg:'#FBEBD3',color:AMBER},
    Low:{bg:'#D9EDE0',color:GREEN}
  };
  const rows=list.map((b,i)=>({cells:[String(i+1),b.name,String(b.n),pct(b.n/c.total),b.top,b.peak,Object.assign({badge:b.risk},badge[b.risk])]}));
  table(doc,400,104,cols,rows,{rh:36,hh:28,size:10});
  text(doc,'Risk level ranks barangays by incident count: top 30% High, next 30% Medium, remainder Low.',400,104+28+rows.length*36+22,9,GHOST2,'normal');
}

function slideTime(doc,c){
  doc.addPage();
  header(doc,'When Incidents Happen',c.rangeShort);
  const t=c.time;
  const maxH=Math.max(...t.hours);
  const hourImg=renderChart({
    type:'bar',
    data:{labels:t.hours.map((_,h)=>hour12(h).replace(' ','')),datasets:[{label:'Incidents',data:t.hours,backgroundColor:t.hours.map((_,h)=>periodInfo(periodOf(h)).color),borderRadius:3,borderSkipped:false}]},
    options:{
      plugins:{legend:{display:false},title:{display:true,text:'By hour of day',color:INK2,font:{family:FONT.family,size:13,weight:'bold'}}},
      layout:{padding:{top:4}},
      scales:{
        x:xAxis('',{ticks:{color:GHOST2,font:{family:FONT.family,size:9},maxRotation:60,autoSkip:false}}),
        y:yAxis('',Math.max(3,Math.ceil(maxH*1.2)))
      }
    },
    plugins:[valueLabels(false,0)]
  },520,280);
  placeImage(doc,hourImg,MX,92,520,280);
  const maxD=Math.max(...t.dows);
  const dowImg=renderChart({
    type:'bar',
    data:{labels:DOW_SHORT,datasets:[{label:'Incidents',data:t.dows,backgroundColor:t.dows.map(v=>v===maxD&&maxD>0?'rgba(232,50,58,.85)':'rgba(26,92,255,.75)'),borderRadius:3,borderSkipped:false}]},
    options:{
      plugins:{legend:{display:false},title:{display:true,text:'By day of week',color:INK2,font:{family:FONT.family,size:13,weight:'bold'}}},
      layout:{padding:{top:4}},
      scales:{
        x:xAxis(''),
        y:yAxis('',Math.max(3,Math.ceil(maxD*1.2)))
      }
    },
    plugins:[valueLabels(false,0)]
  },340,280);
  placeImage(doc,dowImg,580,92,340,280);
  const cards=PERIODS.map(p=>({
    v:String(t.periods[p.key]),
    l:p.label,
    s:p.range+(t.used?' ('+pct(t.periods[p.key]/t.used)+')':''),
    col:p.color
  }));
  statCards(doc,cards,388,92,24);
}

function slideStatus(doc,c){
  doc.addPage();
  header(doc,'Case Status and Clearance',c.rangeShort);
  const entries=STATUSES.map(s=>({name:s,n:c.statusCounts[s]||0})).filter(s=>s.n>0);
  const extra=Object.keys(c.statusCounts).filter(s=>!STATUSES.includes(s)).map(s=>({name:s,n:c.statusCounts[s]}));
  const all=entries.concat(extra);
  const donut=renderChart({
    type:'doughnut',
    data:{labels:all.map(s=>s.name),datasets:[{data:all.map(s=>s.n),backgroundColor:all.map(s=>STATUS_COLORS[s.name]||'#888888'),borderColor:'#FFFFFF',borderWidth:3}]},
    options:{cutout:'58%',plugins:{legend:{display:true,position:'bottom',labels:{color:INK2,font:FONT,boxWidth:12,padding:12}}}},
    plugins:[centerText(c.total)]
  },360,300);
  placeImage(doc,donut,MX,92,360,300);
  const list=c.typeList;
  const stacked=renderChart({
    type:'bar',
    data:{
      labels:list.map(t=>t.name),
      datasets:[
        {label:'Solved or cleared',data:list.map(t=>t.closed),backgroundColor:'rgba(21,128,61,.85)',borderSkipped:false},
        {label:'Open',data:list.map(t=>t.n-t.closed),backgroundColor:'rgba(217,119,6,.85)',borderSkipped:false}
      ]
    },
    options:{
      indexAxis:'y',
      plugins:{legend:{display:true,position:'top',labels:{color:INK2,font:FONT,boxWidth:12}},title:{display:true,text:'Cases by crime type',color:INK2,font:{family:FONT.family,size:13,weight:'bold'}}},
      scales:{
        x:yAxis('',3,{stacked:true}),
        y:{stacked:true,ticks:{color:INK2,font:FONT},grid:{display:false}}
      }
    }
  },500,300);
  placeImage(doc,stacked,420,92,500,300);
  const ranked=c.typeList.filter(t=>t.n>=3).sort((a,b)=>a.closed/a.n-b.closed/b.n);
  const low=ranked[0];
  statCards(doc,[
    {v:pct(c.total?c.closed/c.total:0),l:'Clearance rate',s:c.closed+' of '+c.total+' cases',col:GREEN},
    {v:String(c.open),l:'Still open',col:AMBER},
    {v:low?low.name:'N/A',l:'Lowest clearance (3+ cases)',s:low?pct(low.closed/low.n)+' cleared':'Not enough cases',col:RED}
  ],404,84,22);
}

function slideMatrix(doc,c){
  doc.addPage();
  header(doc,'Crime Type by Barangay',c.rangeShort);
  const types=c.typeList;
  const brgys=c.brgyList;
  const grid=brgys.map(b=>types.map(t=>b.rows.filter(r=>r.type===t.name).length));
  let max=1;
  grid.forEach(r=>r.forEach(n=>{if(n>max)max=n;}));
  const first=170;
  const totalW=70;
  const cw=(W-2*MX-first-totalW)/types.length;
  const hh=40;
  const rh=brgys.length>7?32:40;
  let y=100;
  rect(doc,MX,y,W-2*MX,hh,INK2);
  text(doc,'BARANGAY',MX+12,y+hh/2,8,'#FFFFFF','bold',{baseline:'middle'});
  types.forEach((t,j)=>{
    const lbl=SHORT_TYPE[t.name]||t.name;
    text(doc,fit(doc,lbl,cw-6,9,'bold'),MX+first+j*cw+cw/2,y+hh/2,9,'#FFFFFF','bold',{align:'center',baseline:'middle'});
  });
  text(doc,'TOTAL',MX+first+types.length*cw+totalW/2,y+hh/2,8,'#FFFFFF','bold',{align:'center',baseline:'middle'});
  y+=hh;
  brgys.forEach((b,i)=>{
    const ry=y+i*rh;
    rect(doc,MX,ry,first,rh,i%2===0?MIST:'#FFFFFF');
    text(doc,fit(doc,b.name,first-20,11,'bold'),MX+12,ry+rh/2,11,INK2,'bold',{baseline:'middle'});
    types.forEach((t,j)=>{
      const n=grid[i][j];
      const tt=n===0?0:0.15+0.85*n/max;
      const x=MX+first+j*cw;
      rect(doc,x+1,ry+1,cw-2,rh-2,n===0?MIST:mix(tt));
      text(doc,String(n),x+cw/2,ry+rh/2,12,n===0?WIRE:tt>0.55?'#FFFFFF':INK,'bold',{align:'center',baseline:'middle'});
    });
    rect(doc,MX+first+types.length*cw,ry,totalW,rh,MIST2);
    text(doc,String(b.n),MX+first+types.length*cw+totalW/2,ry+rh/2,12,INK,'bold',{align:'center',baseline:'middle'});
  });
  const ty=y+brgys.length*rh;
  rect(doc,MX,ty,first,rh,MIST2);
  text(doc,'Total',MX+12,ty+rh/2,11,INK,'bold',{baseline:'middle'});
  types.forEach((t,j)=>{
    const x=MX+first+j*cw;
    rect(doc,x+1,ty+1,cw-2,rh-2,MIST2);
    text(doc,String(t.n),x+cw/2,ty+rh/2,12,INK,'bold',{align:'center',baseline:'middle'});
  });
  rect(doc,MX+first+types.length*cw,ty,totalW,rh,WIRE);
  text(doc,String(c.total),MX+first+types.length*cw+totalW/2,ty+rh/2,12,INK,'bold',{align:'center',baseline:'middle'});
}

const TILE_BASE='https://basemaps.cartocdn.com/rastertiles/voyager/';

function mercX(lng){
  return (lng+180)/360;
}

function mercY(lat){
  const r=lat*Math.PI/180;
  return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2;
}

function loadTile(z,x,y){
  return new Promise(resolve=>{
    const img=new Image();
    img.crossOrigin='anonymous';
    const timer=setTimeout(()=>resolve(null),8000);
    img.onload=()=>{clearTimeout(timer);resolve(img);};
    img.onerror=()=>{clearTimeout(timer);resolve(null);};
    img.src=TILE_BASE+z+'/'+x+'/'+y+'.png'+(CARTO_KEY?'?key='+encodeURIComponent(CARTO_KEY):'');
  });
}

async function mapImage(pts,brgyPts,types,w,h){
  const coords=pts.map(p=>[+p.lat,+p.lng]).concat(brgyPts.map(b=>b.pos));
  const xs=coords.map(q=>mercX(q[1]));
  const ys=coords.map(q=>mercY(q[0]));
  const minX=Math.min(...xs);
  const maxX=Math.max(...xs);
  const minY=Math.min(...ys);
  const maxY=Math.max(...ys);
  const spanX=(maxX-minX)*1.28||0.0004;
  const spanY=(maxY-minY)*1.28||0.0004;
  const zf=Math.min(Math.log2(w/(spanX*256)),Math.log2(h/(spanY*256)),17);
  const scale=256*Math.pow(2,zf);
  const cx=(minX+maxX)/2;
  const cy=(minY+maxY)/2;
  const toPx=(lat,lng)=>[(mercX(lng)-cx)*scale+w/2,(mercY(lat)-cy)*scale+h/2];
  const tz=Math.max(0,Math.min(18,Math.round(zf)));
  const n=Math.pow(2,tz);
  const tx0=Math.floor((cx-w/2/scale)*n);
  const tx1=Math.floor((cx+w/2/scale)*n);
  const ty0=Math.floor((cy-h/2/scale)*n);
  const ty1=Math.floor((cy+h/2/scale)*n);
  const jobs=[];
  for(let ty=ty0;ty<=ty1;ty++){
    for(let tx=tx0;tx<=tx1;tx++){
      if(ty<0||ty>=n)continue;
      const wx=((tx%n)+n)%n;
      jobs.push(loadTile(tz,wx,ty).then(img=>({img,tx,ty})));
    }
  }
  const tiles=(await Promise.all(jobs)).filter(t=>t.img);

  const paint=withTiles=>{
    const canvas=document.createElement('canvas');
    canvas.width=w*2;
    canvas.height=h*2;
    const g=canvas.getContext('2d');
    g.scale(2,2);
    g.fillStyle='#EBF0F5';
    g.fillRect(0,0,w,h);
    if(withTiles){
      const size=scale/n;
      tiles.forEach(t=>{
        const px=(t.tx/n-cx)*scale+w/2;
        const py=(t.ty/n-cy)*scale+h/2;
        g.drawImage(t.img,px,py,size+0.5,size+0.5);
      });
    }else{
      g.strokeStyle='rgba(0,0,0,.08)';
      g.lineWidth=1;
      for(let i=1;i<6;i++){
        g.beginPath();g.moveTo(w*i/6,0);g.lineTo(w*i/6,h);g.stroke();
        g.beginPath();g.moveTo(0,h*i/6);g.lineTo(w,h*i/6);g.stroke();
      }
    }
    types.forEach(t=>{
      g.fillStyle=t.color+'E6';
      g.strokeStyle='#FFFFFF';
      g.lineWidth=1.2;
      pts.filter(p=>p.type===t.name).forEach(p=>{
        const q=toPx(+p.lat,+p.lng);
        g.beginPath();
        g.arc(q[0],q[1],4.5,0,Math.PI*2);
        g.fill();
        g.stroke();
      });
    });
    g.font='700 11px DM Sans, sans-serif';
    g.textBaseline='middle';
    g.lineJoin='round';
    const placed=[];
    const clash=r=>placed.some(q=>r.x<q.x+q.w&&r.x+r.w>q.x&&r.y<q.y+q.h&&r.y+r.h>q.y);
    brgyPts.forEach(b=>{
      const q=toPx(b.pos[0],b.pos[1]);
      const label=b.name.replace(/\s*\(.*\)\s*$/,'');
      const tw=g.measureText(label).width;
      const th=14;
      const opts=[
        {x:q[0]-tw/2,y:q[1]-th-7,align:'center',tx:q[0]},
        {x:q[0]-tw/2,y:q[1]+7,align:'center',tx:q[0]},
        {x:q[0]-tw-9,y:q[1]-th/2,align:'right',tx:q[0]-9},
        {x:q[0]+9,y:q[1]-th/2,align:'left',tx:q[0]+9}
      ];
      const pick=opts.find(o=>!clash({x:o.x,y:o.y,w:tw,h:th}))||opts[0];
      placed.push({x:pick.x,y:pick.y,w:tw,h:th});
      g.textAlign=pick.align;
      g.strokeStyle='#FFFFFF';
      g.lineWidth=4;
      g.strokeText(label,pick.tx,pick.y+th/2);
      g.fillStyle=INK;
      g.fillText(label,pick.tx,pick.y+th/2);
      g.beginPath();
      g.arc(q[0],q[1],3.5,0,Math.PI*2);
      g.fillStyle=INK;
      g.fill();
      g.strokeStyle='#FFFFFF';
      g.lineWidth=1.5;
      g.stroke();
    });
    if(withTiles){
      const credit='\u00A9 OpenStreetMap contributors \u00A9 CARTO';
      g.font='500 9px DM Sans, sans-serif';
      g.textAlign='right';
      g.textBaseline='bottom';
      const cw=g.measureText(credit).width;
      g.fillStyle='rgba(255,255,255,.8)';
      g.fillRect(w-cw-10,h-15,cw+10,15);
      g.fillStyle=GHOST2;
      g.fillText(credit,w-5,h-3);
    }
    return canvas.toDataURL('image/png');
  };

  if(tiles.length){
    try{
      return paint(true);
    }catch(e){
      return paint(false);
    }
  }
  return paint(false);
}

async function slideSpatial(doc,c){
  doc.addPage();
  header(doc,'Incident Location Plot',c.rangeShort);
  const pts=c.rows.filter(r=>r.lat!==null&&r.lng!==null&&Number.isFinite(+r.lat)&&Number.isFinite(+r.lng));
  const brgyPts=c.brgyList.map(b=>({name:b.name,pos:BRGY_COORDS[b.name]})).filter(b=>b.pos);
  const cw=600;
  const ch=390;
  const img=await mapImage(pts,brgyPts,c.typeList,cw,ch);
  placeImage(doc,img,MX,92,cw,ch);
  doc.setDrawColor(WIRE);
  doc.setLineWidth(1);
  doc.rect(MX,92,cw,ch,'S');
  text(doc,'Incident types',672,108,10,GHOST2,'bold');
  let y=130;
  c.typeList.forEach(t=>{
    doc.setFillColor(t.color);
    doc.circle(680,y-4,5,'F');
    text(doc,fit(doc,t.name,150,12,'normal'),694,y,12,INK2,'normal');
    text(doc,String(t.n),W-MX,y,12,INK,'bold',{align:'right'});
    y+=26;
  });
  const missing=c.total-pts.length;
  if(missing>0){
    wrap(doc,plural(missing,'incident')+' without valid coordinates not shown.',248,10,'normal').forEach((l,i)=>text(doc,l,672,y+14+i*14,10,GHOST2,'normal'));
  }
}

function slideList(doc,c){
  const sorted=c.rows.slice().sort((a,b)=>(b.date+' '+b.time).localeCompare(a.date+' '+a.time)||b.id-a.id);
  const shown=sorted.slice(0,LIST_CAP);
  const pages=Math.max(1,Math.ceil(shown.length/ROWS_PER_PAGE));
  const cols=[
    {label:'Date',w:82},
    {label:'Time',w:50},
    {label:'Crime type',w:112},
    {label:'Barangay',w:140},
    {label:'Location',w:190},
    {label:'Modus',w:166},
    {label:'Status',w:140}
  ];
  for(let p=0;p<pages;p++){
    doc.addPage();
    const slice=shown.slice(p*ROWS_PER_PAGE,(p+1)*ROWS_PER_PAGE);
    const from=p*ROWS_PER_PAGE+1;
    header(doc,'Incident Records',from+' to '+(from+slice.length-1)+' of '+shown.length+(sorted.length>shown.length?' (first '+LIST_CAP+' of '+sorted.length+')':''));
    const rows=slice.map(r=>({cells:[r.date,r.time,r.type,r.barangay,r.location||'',r.modus||'',r.status]}));
    table(doc,MX,92,cols,rows,{rh:25,hh:26,size:9});
  }
}

function slideTitle(doc,c){
  rect(doc,0,0,W,H,INK);
  rect(doc,0,0,16,H,ACCENT);
  text(doc,'CAINTA MUNICIPAL POLICE STATION',70,150,13,'#7FA8FF','bold',{charSpace:1.5});
  text(doc,'Crime Incident Report',70,214,48,'#FFFFFF','bold');
  text(doc,c.rangeLabel,70,252,20,'#C8D5E0','normal');
  rect(doc,70,276,90,4,ACCENT);
  let y=314;
  [
    c.typesAll?c.typesLabel:'Crime types: '+c.typesLabel,
    c.brgysAll?c.brgyLabel:'Barangays: '+c.brgyLabel,
    plural(c.total,'incident')
  ].forEach(line=>{
    wrap(doc,line,800,13,'normal').slice(0,2).forEach(l=>{
      text(doc,l,70,y,13,'#A8BBC8','normal');
      y+=19;
    });
    y+=5;
  });
  text(doc,'Prepared by '+c.preparedBy+' on '+c.generated,70,H-48,11,'#7A94A8','normal');
}

function slideOverview(doc,c){
  doc.addPage();
  header(doc,'Overview',c.rangeShort);
  statCards(doc,[
    {v:String(c.total),l:'Total incidents',col:ACCENT},
    {v:String(c.closed),l:'Solved or cleared',col:GREEN},
    {v:String(c.open),l:'Under investigation',col:AMBER},
    {v:pct(c.total?c.closed/c.total:0),l:'Clearance rate',col:INK}
  ],92,88,28);
  const topType=c.typeList[0];
  const topBrgy=c.brgyRank[0];
  const topPeriod=PERIODS.slice().sort((a,b)=>c.time.periods[b.key]-c.time.periods[a.key])[0];
  statCards(doc,[
    {v:topType?topType.name:'N/A',l:'Most reported crime',s:topType?plural(topType.n,'case')+' ('+pct(topType.n/c.total)+')':'',col:RED},
    {v:topBrgy?topBrgy.name:'N/A',l:'Highest incident barangay',s:topBrgy?plural(topBrgy.n,'case')+' ('+pct(topBrgy.n/c.total)+')':'',col:ACCENT},
    {v:c.time.used?topPeriod.label:'N/A',l:'Peak time of day',s:c.time.used?topPeriod.range+' ('+pct(c.time.periods[topPeriod.key]/c.time.used)+')':'',col:AMBER}
  ],196,86,20);
  let y=322;
  text(doc,'Key findings',MX,y,14,INK,'bold');
  y+=24;
  c.findings.forEach(line=>{
    const lines=wrap(doc,line,W-2*MX-24,12,'normal');
    rect(doc,MX,y-8,6,6,ACCENT,1);
    lines.forEach(l=>{
      text(doc,l,MX+20,y,12,INK2,'normal');
      y+=17;
    });
    y+=6;
  });
}

function buildContext(range,types,brgys,rows,opts){
  const total=rows.length;
  const typeCounts=tally(rows,'type');
  const typeList=CRIME_TYPES.filter(t=>types.has(t.name)&&typeCounts[t.name]>0).map(t=>({
    name:t.name,
    color:t.color,
    n:typeCounts[t.name],
    closed:rows.filter(r=>r.type===t.name&&CLOSED_STATUSES.includes(r.status)).length
  })).sort((a,b)=>b.n-a.n);
  const time=timeStats(rows);
  const brgyList=BARANGAYS.filter(b=>brgys.has(b)).map(b=>{
    const br=rows.filter(r=>r.barangay===b);
    const byType=tally(br,'type');
    const topEntry=Object.entries(byType).sort((x,y)=>y[1]-x[1])[0];
    const per={dawn:0,morning:0,afternoon:0,evening:0,night:0};
    let counted=0;
    br.forEach(r=>{
      const h=hourOf(r);
      if(Number.isFinite(h)){per[periodOf(h)]++;counted++;}
    });
    const peak=counted?PERIODS.slice().sort((x,y)=>per[y.key]-per[x.key])[0].label:'N/A';
    return {name:b,n:br.length,rows:br,top:topEntry?topEntry[0]:'None',peak};
  });
  const brgyRank=brgyList.slice().sort((a,b)=>b.n-a.n).filter(b=>b.n>0);
  brgyRank.forEach((b,i)=>{
    b.risk=i<brgyRank.length*0.3?'High':i<brgyRank.length*0.6?'Medium':'Low';
  });
  const closed=rows.filter(r=>CLOSED_STATUSES.includes(r.status)).length;
  const start=range.start;
  const end=range.end;
  const trend=buildBuckets(rows,start,end);
  const rangeLabel=fmtDate(start)+' to '+fmtDate(end);
  const allTypes=types.size===CRIME_TYPES.length;
  const allBrgys=brgys.size===BARANGAYS.length;
  const typesLabel=allTypes?'All crime types':CRIME_TYPES.filter(t=>types.has(t.name)).map(t=>t.name).join(', ');
  const brgyLabel=allBrgys?'All barangays ('+BARANGAYS.length+')':BARANGAYS.filter(b=>brgys.has(b)).join(', ');
  const findings=[];
  if(brgyRank.length>1){
    const rest=brgyRank.slice(1,3).map(b=>b.name+' with '+b.n).join(' and ');
    findings.push('Next highest barangays: '+rest+'.');
  }
  if(typeList.length>2){
    const share=typeList.slice(0,3).reduce((a,t)=>a+t.n,0)/total;
    findings.push('The top three crime types ('+typeList.slice(0,3).map(t=>t.name).join(', ')+') make up '+pct(share)+' of all incidents.');
  }
  if(time.used){
    const peakH=time.hours.indexOf(Math.max(...time.hours));
    const peakD=time.dows.indexOf(Math.max(...time.dows));
    findings.push('Incidents peak around '+hour12(peakH)+'. The busiest day of the week is '+DOW_FULL[peakD]+' ('+plural(time.dows[peakD],'case')+').');
  }
  const {lo}=dataBounds();
  if(range.bounded){
    const spanDays=Math.round((end-start)/DAY)+1;
    const prevTo=start-DAY;
    const prevFrom=start-spanDays*DAY;
    if(prevTo>=lo){
      const prevRows=selectRows({from:prevFrom,to:prevTo},types,brgys);
      const prevN=prevRows.length;
      if(prevN>0){
        const change=(total-prevN)/prevN;
        findings.push('Compared with the previous '+plural(spanDays,'day')+' ('+fmtDate(prevFrom)+' to '+fmtDate(prevTo)+'), incidents are '+(change>0?'up ':change<0?'down ':'unchanged at ')+(change===0?prevN:pct(Math.abs(change)))+' ('+total+' vs '+prevN+').');
      }else{
        findings.push('No matching incidents were recorded in the previous '+plural(spanDays,'day')+' for comparison.');
      }
    }
  }
  return {
    rows,total,range,time,typeList,brgyList,brgyRank,closed,open:total-closed,trend,
    statusCounts:tally(rows,'status'),
    rangeLabel,
    rangeShort:rangeLabel,
    typesLabel,brgyLabel,typesAll:allTypes,brgysAll:allBrgys,findings,
    preparedBy:(state.profile&&state.profile.display_name)||'Authorized user',
    generated:fmtDate(Date.now()),
    sections:opts.sections
  };
}

async function buildPdf(range,types,brgys,rows){
  const jsPDF=window.jspdf&&window.jspdf.jsPDF;
  if(!jsPDF)throw new Error('missing library');
  const doc=new jsPDF({orientation:'landscape',unit:'pt',format:[W,H],compress:true});
  const c=buildContext(range,types,brgys,rows,{sections:S.sections});
  doc.setProperties({title:'Cainta Crime Incident Report',subject:c.rangeLabel,author:c.preparedBy});
  slideTitle(doc,c);
  slideOverview(doc,c);
  const has=k=>S.sections.has(k);
  if(has('types'))slideTypes(doc,c);
  if(has('trend'))slideTrend(doc,c);
  if(has('brgy')&&c.brgyRank.length)slideBrgy(doc,c);
  if(has('time')&&c.time.used)slideTime(doc,c);
  if(has('status'))slideStatus(doc,c);
  if(has('matrix'))slideMatrix(doc,c);
  if(has('spatial'))await slideSpatial(doc,c);
  if(has('list'))slideList(doc,c);
  const n=doc.getNumberOfPages();
  for(let i=2;i<=n;i++){
    doc.setPage(i);
    doc.setDrawColor(WIRE);
    doc.setLineWidth(0.75);
    doc.line(MX,H-30,W-MX,H-30);
    text(doc,'Cainta Municipal Police Station  |  Crime Incident Report',MX,H-14,9,GHOST,'normal');
    text(doc,'Page '+i+' of '+n,W-MX,H-14,9,GHOST,'normal',{align:'right'});
  }
  const stamp=new Date().toISOString().slice(0,10);
  doc.save('Cainta_Crime_Report_'+stamp+'.pdf');
}

function el(tag,cls,txt){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(txt!==undefined)e.textContent=txt;
  return e;
}

function currentRows(){
  return selectRows(resolveRange(),S.types,S.brgys);
}

function renderCount(){
  const rows=currentRows();
  const range=resolveRange();
  const count=modal.querySelector('#pdf-count');
  const gen=modal.querySelector('#pdf-go');
  count.textContent=plural(rows.length,'incident');
  gen.disabled=busy||rows.length===0||!range.valid;
  const hint=modal.querySelector('#pdf-hint');
  if(!range.valid)hint.textContent='No incident data available yet.';
  else hint.textContent=fmtDate(range.start)+' to '+fmtDate(range.end);
}

function renderPresets(){
  const sel=modal.querySelector('#pdf-preset');
  const years=[...new Set(state.crimeData.map(c=>parseInt(String(c.date).slice(0,4),10)).filter(Number.isFinite))].sort((a,b)=>b-a);
  const opts=PRESETS.concat(years.map(y=>['y'+y,'Year '+y])).concat([['custom','Custom range']]);
  sel.replaceChildren();
  opts.forEach(([v,l])=>{
    const o=el('option',null,l);
    o.value=v;
    sel.appendChild(o);
  });
  if(!opts.some(o=>o[0]===S.preset))S.preset='all';
  sel.value=S.preset;
  modal.querySelector('#pdf-custom').classList.toggle('hidden',S.preset!=='custom');
}

function chipGroup(container,items,selected,onToggle){
  container.replaceChildren();
  items.forEach(it=>{
    const chip=el('div','pdf-chip'+(selected.has(it.key)?' on':''));
    chip.setAttribute('role','checkbox');
    chip.setAttribute('aria-checked',selected.has(it.key)?'true':'false');
    chip.tabIndex=0;
    const left=el('span','pdf-chip-left');
    left.appendChild(el('span',null,it.label));
    chip.appendChild(left);
    if(it.count!==undefined)chip.appendChild(el('span','cf-cnt',String(it.count)));
    const toggle=()=>onToggle(it.key);
    chip.addEventListener('click',toggle);
    chip.addEventListener('keydown',e=>{
      if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}
    });
    container.appendChild(chip);
  });
}

function renderChips(){
  const range=resolveRange();
  const inTime=state.crimeData.filter(c=>inRange(c,range));
  const typeCounts=tally(inTime,'type');
  const brgyCounts=tally(inTime,'barangay');
  chipGroup(modal.querySelector('#pdf-types'),CRIME_TYPES.map(t=>({key:t.name,label:t.name,count:typeCounts[t.name]||0})),S.types,key=>{
    if(S.types.has(key))S.types.delete(key);else S.types.add(key);
    renderAll();
  });
  chipGroup(modal.querySelector('#pdf-brgys'),BARANGAYS.map(b=>({key:b,label:b,count:brgyCounts[b]||0})),S.brgys,key=>{
    if(S.brgys.has(key))S.brgys.delete(key);else S.brgys.add(key);
    renderAll();
  });
  chipGroup(modal.querySelector('#pdf-sections'),SECTIONS.map(s=>({key:s[0],label:s[1]})),S.sections,key=>{
    if(S.sections.has(key))S.sections.delete(key);else S.sections.add(key);
    renderAll();
  });
}

function renderAll(){
  renderChips();
  renderCount();
}

function closeModal(){
  if(busy)return;
  modal.classList.remove('show');
  document.removeEventListener('keydown',onKey);
}

function onKey(e){
  if(e.key==='Escape')closeModal();
}

async function generate(){
  if(busy)return;
  const range=resolveRange();
  const rows=selectRows(range,S.types,S.brgys);
  if(!rows.length){
    showToast('No incidents match the selected filters','error');
    return;
  }
  busy=true;
  const btn=modal.querySelector('#pdf-go');
  const label=btn.querySelector('span');
  btn.disabled=true;
  label.textContent='Generating...';
  await new Promise(r=>setTimeout(r,40));
  try{
    await buildPdf(range,S.types,S.brgys,rows);
    busy=false;
    closeModal();
    showToast('PDF report downloaded','success');
  }catch(e){
    console.error('pdf export failed');
    showToast('Could not generate the PDF report','error');
  }finally{
    busy=false;
    label.textContent='Generate PDF';
    renderCount();
  }
}

function setAll(set,items,on){
  set.clear();
  if(on)items.forEach(i=>set.add(i));
}

function buildModal(){
  const overlay=el('div','pdf-overlay');
  overlay.id='pdf-overlay';
  const box=el('div','pdf-modal');
  box.setAttribute('role','dialog');
  box.setAttribute('aria-modal','true');
  box.setAttribute('aria-labelledby','pdf-title');

  const head=el('div','pdf-head');
  const headText=el('div');
  const h=el('h3');
  h.id='pdf-title';
  const icon=el('i','fa-solid fa-file-pdf');
  h.append(icon,el('span',null,'Export PDF Report'));
  headText.append(h);
  const close=el('button','pdf-close');
  close.type='button';
  close.setAttribute('aria-label','Close');
  close.appendChild(el('i','fa-solid fa-xmark'));
  close.addEventListener('click',closeModal);
  head.append(headText,close);

  const body=el('div','pdf-body');

  const secTime=el('div','pdf-sec');
  const tl=el('label',null,'Timeframe');
  tl.setAttribute('for','pdf-preset');
  const preset=el('select');
  preset.id='pdf-preset';
  const custom=el('div','pdf-dates hidden');
  custom.id='pdf-custom';
  const fromWrap=el('div');
  const fl=el('label',null,'From');
  fl.setAttribute('for','pdf-from');
  const from=el('input');
  from.type='date';
  from.id='pdf-from';
  fromWrap.append(fl,from);
  const toWrap=el('div');
  const tol=el('label',null,'To');
  tol.setAttribute('for','pdf-to');
  const to=el('input');
  to.type='date';
  to.id='pdf-to';
  toWrap.append(tol,to);
  custom.append(fromWrap,toWrap);
  const hint=el('div','pdf-hint');
  hint.id='pdf-hint';
  secTime.append(tl,preset,custom,hint);

  const mkGroup=(title,id,onAll,onNone)=>{
    const sec=el('div','pdf-sec');
    const top=el('div','pdf-sec-head');
    top.appendChild(el('div','pdf-lbl',title));
    const links=el('div','pdf-links');
    const a=el('button',null,'All');
    a.type='button';
    a.addEventListener('click',onAll);
    const n=el('button',null,'None');
    n.type='button';
    n.addEventListener('click',onNone);
    links.append(a,n);
    top.appendChild(links);
    const chips=el('div','pdf-chips');
    chips.id=id;
    sec.append(top,chips);
    return sec;
  };

  const secTypes=mkGroup('Crime types','pdf-types',
    ()=>{setAll(S.types,CRIME_TYPES.map(c=>c.name),true);renderAll();},
    ()=>{setAll(S.types,[],false);renderAll();});
  const secBrgys=mkGroup('Barangays','pdf-brgys',
    ()=>{setAll(S.brgys,BARANGAYS,true);renderAll();},
    ()=>{setAll(S.brgys,[],false);renderAll();});
  const secSections=mkGroup('Slides to include','pdf-sections',
    ()=>{setAll(S.sections,SECTIONS.map(s=>s[0]),true);renderAll();},
    ()=>{setAll(S.sections,[],false);renderAll();});

  body.append(secTime,secTypes,secBrgys,secSections);

  const foot=el('div','pdf-foot');
  const count=el('span','pdf-count');
  count.id='pdf-count';
  const cancel=el('button','btn btn-ghost','Cancel');
  cancel.type='button';
  cancel.addEventListener('click',closeModal);
  const go=el('button','btn btn-primary');
  go.type='button';
  go.id='pdf-go';
  go.append(el('i','fa-solid fa-file-arrow-down'),el('span',null,'Generate PDF'));
  go.addEventListener('click',generate);
  foot.append(count,cancel,go);

  box.append(head,body,foot);
  overlay.appendChild(box);
  overlay.addEventListener('mousedown',e=>{
    if(e.target===overlay)closeModal();
  });
  document.body.appendChild(overlay);

  preset.addEventListener('change',()=>{
    S.preset=preset.value;
    custom.classList.toggle('hidden',S.preset!=='custom');
    renderAll();
  });
  from.addEventListener('change',()=>{S.from=from.value;renderAll();});
  to.addEventListener('change',()=>{S.to=to.value;renderAll();});
  return overlay;
}

export function openPdfExport(){
  if(!window.jspdf||!window.jspdf.jsPDF){
    showToast('PDF library could not be loaded. Check your connection and reload.','error');
    return;
  }
  if(!state.crimeData.length){
    showToast('There are no incidents to export yet','error');
    return;
  }
  if(!modal)modal=buildModal();
  renderPresets();
  modal.querySelector('#pdf-from').value=S.from;
  modal.querySelector('#pdf-to').value=S.to;
  renderAll();
  modal.classList.add('show');
  document.addEventListener('keydown',onKey);
  modal.querySelector('#pdf-preset').focus();
}
