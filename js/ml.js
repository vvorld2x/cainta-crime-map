/* Small, dependency-free machine learning helpers.
   Everything here is evaluated on data the model did not see while fitting:
   records are split by time (older = training, newer = test). */

export const MIN_KMEANS=30;
export const MIN_RF=40;
export const MIN_DAYS=270;

const DAY=86400000;
const LAT0=14.5785,LNG0=121.1194;
const MY=110574;
const MX=111320*Math.cos(LAT0*Math.PI/180);

export function rng(seed){
  let a=(seed>>>0)||1;
  return function(){
    a|=0;a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^(a>>>15),1|a);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return((t^(t>>>14))>>>0)/4294967296;
  };
}

export function hour12(h){
  h=((Math.floor(h)%24)+24)%24;
  const ap=h<12?'AM':'PM';
  const x=h%12===0?12:h%12;
  return x+' '+ap;
}

function toXY(lat,lng){return {x:(lng-LNG0)*MX,y:(lat-LAT0)*MY};}
function toLatLng(x,y){return {lat:LAT0+y/MY,lng:LNG0+x/MX};}

/* Wilson score half-width for a proportion p seen over n trials (95%). */
function wilson(p,n){
  if(n<=0)return 0;
  const z=1.96;
  return z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n);
}

/* ------------------------------ data preparation ------------------------------ */

export function prepare(data){
  const out=[];
  (data||[]).forEach(c=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(c.date));
    if(!m)return;
    const lat=Number(c.lat),lng=Number(c.lng);
    if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const ms=Date.UTC(+m[1],+m[2]-1,+m[3]);
    const tm=/^(\d{1,2}):(\d{2})/.exec(String(c.time));
    const hh=tm?+tm[1]:NaN;
    const hour=hh>=0&&hh<24?hh+(+tm[2])/60:12;
    const xy=toXY(lat,lng);
    out.push({
      id:c.id,type:c.type,barangay:c.barangay,
      day:Math.floor(ms/DAY),dow:(new Date(ms).getUTCDay()+6)%7,
      hour,lat,lng,x:xy.x,y:xy.y
    });
  });
  out.sort((a,b)=>a.day-b.day||a.hour-b.hour);
  return out;
}

/* ----------------------------------- k-means ----------------------------------- */

function d2(a,b){const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;}

function runKMeans(P,k,rand,iters){
  const n=P.length;
  const first=P[Math.floor(rand()*n)];
  const centers=[{x:first.x,y:first.y}];
  const dist=new Array(n).fill(Infinity);
  while(centers.length<k){
    const last=centers[centers.length-1];
    let sum=0;
    for(let i=0;i<n;i++){
      const d=d2(P[i],last);
      if(d<dist[i])dist[i]=d;
      sum+=dist[i];
    }
    let r=rand()*sum,pick=n-1;
    if(sum<=0)pick=Math.floor(rand()*n);
    else for(let i=0;i<n;i++){r-=dist[i];if(r<=0){pick=i;break;}}
    centers.push({x:P[pick].x,y:P[pick].y});
  }
  const assign=new Array(n).fill(0);
  for(let it=0;it<iters;it++){
    let changed=false;
    for(let i=0;i<n;i++){
      let best=0,bd=Infinity;
      for(let j=0;j<k;j++){
        const d=d2(P[i],centers[j]);
        if(d<bd){bd=d;best=j;}
      }
      if(assign[i]!==best){assign[i]=best;changed=true;}
    }
    const sx=new Array(k).fill(0),sy=new Array(k).fill(0),sn=new Array(k).fill(0);
    for(let i=0;i<n;i++){sx[assign[i]]+=P[i].x;sy[assign[i]]+=P[i].y;sn[assign[i]]++;}
    for(let j=0;j<k;j++)if(sn[j]){centers[j]={x:sx[j]/sn[j],y:sy[j]/sn[j]};}
    if(!changed&&it>0)break;
  }
  let inertia=0;
  for(let i=0;i<n;i++)inertia+=d2(P[i],centers[assign[i]]);
  return {centers,assign,inertia};
}

function silhouette(P,assign,k){
  const n=P.length;
  if(k<2||n<3)return 0;
  const sizes=new Array(k).fill(0);
  assign.forEach(a=>{sizes[a]++;});
  let total=0,cnt=0;
  for(let i=0;i<n;i++){
    if(sizes[assign[i]]<2)continue;
    const sum=new Array(k).fill(0);
    for(let j=0;j<n;j++){
      if(j===i)continue;
      sum[assign[j]]+=Math.sqrt(d2(P[i],P[j]));
    }
    const a=sum[assign[i]]/(sizes[assign[i]]-1);
    let b=Infinity;
    for(let c=0;c<k;c++){
      if(c===assign[i]||!sizes[c])continue;
      b=Math.min(b,sum[c]/sizes[c]);
    }
    if(!Number.isFinite(b))continue;
    const s=(b-a)/Math.max(a,b,1e-9);
    total+=s;cnt++;
  }
  return cnt?total/cnt:0;
}

function bestRun(P,k,rand,tries){
  let best=null;
  for(let t=0;t<tries;t++){
    const r=runKMeans(P,k,rand,40);
    if(!best||r.inertia<best.inertia)best=r;
  }
  return best;
}

/* Pick k (2..8) by silhouette on a sample, then cluster everything with it. */
export function fitClusters(P){
  const n=P.length;
  if(!n)return {k:0,silhouette:0,clusters:[]};
  const rand=rng(7);
  const kMax=Math.min(8,Math.floor(n/4));
  let k=1,sil=0;
  if(kMax>=2){
    const stride=Math.max(1,Math.ceil(n/500));
    const S=P.filter((_,i)=>i%stride===0);
    let bestS=-Infinity;
    for(let kk=2;kk<=Math.min(kMax,S.length-1);kk++){
      const r=bestRun(S,kk,rand,2);
      const s=silhouette(S,r.assign,kk);
      if(s>bestS){bestS=s;k=kk;}
    }
    sil=bestS===-Infinity?0:bestS;
  }
  const run=k>=2?bestRun(P,k,rand,3):{centers:[{x:P.reduce((s,p)=>s+p.x,0)/n,y:P.reduce((s,p)=>s+p.y,0)/n}],assign:new Array(n).fill(0)};
  const clusters=run.centers.map(()=>({members:[]}));
  P.forEach((p,i)=>{clusters[run.assign[i]].members.push(p);});
  clusters.forEach((c,j)=>{
    c.size=c.members.length;
    c.x=run.centers[j].x;c.y=run.centers[j].y;
    const ll=toLatLng(c.x,c.y);
    c.lat=ll.lat;c.lng=ll.lng;
    const ds=c.members.map(m=>Math.sqrt((m.x-c.x)**2+(m.y-c.y)**2)).sort((a,b)=>a-b);
    c.radius=Math.max(60,ds.length?ds[Math.min(ds.length-1,Math.floor(ds.length*0.85))]:60);
  });
  /* hotspots = the largest clusters that together hold at least half of all incidents */
  let acc=0;
  clusters.slice().sort((a,b)=>b.size-a.size).forEach(c=>{
    c.hotspot=false;
    if(c.size>0&&acc<n*0.5){c.hotspot=true;acc+=c.size;}
  });
  return {k:clusters.length,silhouette:sil,clusters};
}

/* How many of the newest incidents fall in hotspots found from older ones,
   compared with how much of the map those hotspots cover. */
export function evalKMeans(P){
  const n=P.length;
  if(n<MIN_KMEANS)return {ok:false,need:MIN_KMEANS,have:n};
  const cut=Math.floor(n*0.7);
  const train=P.slice(0,cut),test=P.slice(cut);
  const fit=fitClusters(train);
  const hot=fit.clusters.filter(c=>c.hotspot&&c.size);
  const inside=(p)=>hot.some(c=>Math.sqrt((p.x-c.x)**2+(p.y-c.y)**2)<=c.radius);
  const hits=test.filter(inside).length;
  const value=hits/test.length;
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  P.forEach(p=>{x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);});
  const pad=300;x0-=pad;x1+=pad;y0-=pad;y1+=pad;
  const rand=rng(11);
  let cov=0;const S=4000;
  for(let i=0;i<S;i++){
    const pt={x:x0+rand()*(x1-x0),y:y0+rand()*(y1-y0)};
    if(inside(pt))cov++;
  }
  const area=cov/S;
  return {
    ok:true,value,ci:wilson(value,test.length),area,
    lift:area>0?value/area:null,
    silhouette:fit.silhouette,k:fit.k,
    nTrain:train.length,nTest:test.length,hotspots:hot.length
  };
}

/* ------------------------- logistic regression (barangay risk) ------------------------- */

function sigmoid(z){return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));}

function fitLogistic(X,y){
  const m=X.length,f=X[0].length;
  const mean=new Array(f).fill(0),sd=new Array(f).fill(0);
  X.forEach(r=>r.forEach((v,j)=>{mean[j]+=v/m;}));
  X.forEach(r=>r.forEach((v,j)=>{sd[j]+=(v-mean[j])**2/m;}));
  for(let j=0;j<f;j++)sd[j]=Math.sqrt(sd[j])||1;
  const Z=X.map(r=>r.map((v,j)=>(v-mean[j])/sd[j]));
  const w=new Array(f).fill(0);
  let b=0;
  const lr=0.3,l2=0.01;
  for(let it=0;it<400;it++){
    const gw=new Array(f).fill(0);
    let gb=0;
    for(let i=0;i<m;i++){
      let z=b;
      for(let j=0;j<f;j++)z+=w[j]*Z[i][j];
      const e=sigmoid(z)-y[i];
      gb+=e;
      for(let j=0;j<f;j++)gw[j]+=e*Z[i][j];
    }
    b-=lr*gb/m;
    for(let j=0;j<f;j++)w[j]-=lr*(gw[j]/m+l2*w[j]);
  }
  return {predict:(r)=>{
    let z=b;
    for(let j=0;j<f;j++)z+=w[j]*((r[j]-mean[j])/sd[j]);
    return sigmoid(z);
  }};
}

function median(a){
  const s=a.slice().sort((x,y)=>x-y);
  const h=s.length>>1;
  return s.length%2?s[h]:(s[h-1]+s[h])/2;
}

/* A lone old record (a typo, or one stray case) would stretch the timeline and leave
   most training windows empty. Ignore anything before a gap longer than maxGap days. */
function trimLeadingGap(P,maxGap){
  let start=0;
  for(let i=1;i<P.length;i++)if(P[i].day-P[i-1].day>maxGap)start=i;
  return start?P.slice(start):P;
}

export function evalRisk(P0,barangays){
  const P=trimLeadingGap(P0,365);
  const n=P.length;
  const haveDays=n?P[n-1].day-P[0].day+1:0;
  const fail={ok:false,needDays:MIN_DAYS,haveDays};
  if(haveDays<MIN_DAYS||!barangays.length)return fail;
  const dMin=P[0].day,dMax=P[n-1].day;
  const by={};
  barangays.forEach(b=>{by[b]=[];});
  P.forEach(p=>{if(by[p.barangay])by[p.barangay].push(p);});
  const count=(b,from,to)=>{
    let c=0;
    for(const p of by[b])if(p.day>=from&&p.day<=to)c++;
    return c;
  };
  const night=(h)=>h>=21||h<2;
  function feats(b,t,c30all,c90all){
    const c30=count(b,t-29,t),c60=count(b,t-59,t-30),c90=count(b,t-89,t);
    let nt=0;
    for(const p of by[b])if(p.day>=t-89&&p.day<=t&&night(p.hour))nt++;
    return [c30,c60,c90/3,c90?nt/c90:0,c90all?c90/c90all:0];
  }
  const STEP=5;
  const samples=[];
  for(let t=dMin+89;t<=dMax-30;t+=STEP){
    const c30s=barangays.map(b=>count(b,t-29,t));
    const fut=barangays.map(b=>count(b,t+1,t+30));
    const medF=median(fut),medN=median(c30s);
    const c90all=barangays.reduce((s,b)=>s+count(b,t-89,t),0);
    barangays.forEach((b,i)=>{
      samples.push({t,x:feats(b,t,null,c90all),y:fut[i]>medF?1:0,naive:c30s[i]>medN?1:0});
    });
  }
  if(!samples.length)return fail;
  const t0=samples[0].t,t1=samples[samples.length-1].t;
  const trainEnd=t0+(t1-t0)*0.6;
  const testStart=trainEnd+30; /* 30-day gap: training labels must not peek into test */
  const train=samples.filter(s=>s.t<=trainEnd);
  const test=samples.filter(s=>s.t>=testStart);
  if(train.length<40||test.length<20)return fail;
  const model=fitLogistic(train.map(s=>s.x),train.map(s=>s.y));
  let hit=0,naive=0;
  test.forEach(s=>{
    if((model.predict(s.x)>=0.5?1:0)===s.y)hit++;
    if(s.naive===s.y)naive++;
  });
  const ones=train.filter(s=>s.y===1).length;
  const maj=ones*2>=train.length?1:0;
  const baseHit=test.filter(s=>s.y===maj).length;
  const value=hit/test.length;
  /* windows overlap, so the effective number of independent cases is smaller */
  const nEff=Math.max(1,test.length/Math.ceil(30/STEP));
  const all=samples;
  const full=fitLogistic(all.map(s=>s.x),all.map(s=>s.y));
  const c90all=barangays.reduce((s,b)=>s+count(b,dMax-89,dMax),0);
  const probs={};
  barangays.forEach(b=>{probs[b]=full.predict(feats(b,dMax,null,c90all));});
  return {
    ok:true,value,ci:wilson(value,nEff),
    baseline:baseHit/test.length,naive:naive/test.length,
    nTrain:train.length,nTest:test.length,asOfDay:dMax,probs
  };
}

/* ------------------------------- random forest (crime type) ------------------------------- */

function gini(counts,total){
  if(!total)return 0;
  let s=0;
  for(const c of counts){const p=c/total;s+=p*p;}
  return 1-s;
}

function buildTree(X,y,idx,C,depth,maxDepth,minLeaf,mtry,rand){
  const counts=new Array(C).fill(0);
  idx.forEach(i=>{counts[y[i]]++;});
  const total=idx.length;
  let major=0;
  for(let c=1;c<C;c++)if(counts[c]>counts[major])major=c;
  const leaf={leaf:true,dist:counts.map(c=>c/total)};
  if(depth>=maxDepth||total<minLeaf*2||counts[major]===total)return leaf;
  const F=X[0].length;
  const feats=[];
  const pool=Array.from({length:F},(_,j)=>j);
  for(let k=0;k<mtry&&pool.length;k++){
    feats.push(pool.splice(Math.floor(rand()*pool.length),1)[0]);
  }
  const parent=gini(counts,total);
  let best=null;
  for(const f of feats){
    const order=idx.slice().sort((a,b)=>X[a][f]-X[b][f]);
    const left=new Array(C).fill(0);
    const right=counts.slice();
    for(let k=0;k<total-1;k++){
      const i=order[k];
      left[y[i]]++;right[y[i]]--;
      const nl=k+1,nr=total-nl;
      if(X[order[k]][f]===X[order[k+1]][f])continue;
      if(nl<minLeaf||nr<minLeaf)continue;
      const g=(nl*gini(left,nl)+nr*gini(right,nr))/total;
      if(!best||g<best.g)best={g,f,thr:(X[order[k]][f]+X[order[k+1]][f])/2};
    }
  }
  if(!best||best.g>=parent-1e-9)return leaf;
  const L=[],R=[];
  idx.forEach(i=>{(X[i][best.f]<=best.thr?L:R).push(i);});
  return {
    leaf:false,f:best.f,thr:best.thr,
    l:buildTree(X,y,L,C,depth+1,maxDepth,minLeaf,mtry,rand),
    r:buildTree(X,y,R,C,depth+1,maxDepth,minLeaf,mtry,rand)
  };
}

function treeDist(node,x){
  while(!node.leaf)node=x[node.f]<=node.thr?node.l:node.r;
  return node.dist;
}

export function evalForest(P,typeNames){
  const rows=P.filter(p=>typeNames.includes(p.type));
  const n=rows.length;
  if(n<MIN_RF)return {ok:false,need:MIN_RF,have:n};
  const brgys=[...new Set(rows.map(p=>p.barangay))].sort();
  const C=typeNames.length;
  const toX=p=>[p.hour,p.dow,p.x,p.y].concat(brgys.map(b=>p.barangay===b?1:0));
  const cut=Math.floor(n*0.75);
  let train=rows.slice(0,cut);
  const test=rows.slice(cut);
  const rand=rng(3);
  if(train.length>1500){
    train=train.slice().sort(()=>rand()-0.5).slice(0,1500);
  }
  const Xtr=train.map(toX),ytr=train.map(p=>typeNames.indexOf(p.type));
  const F=Xtr[0].length;
  const mtry=Math.max(2,Math.round(Math.sqrt(F)));
  const TREES=40;
  const trees=[];
  for(let t=0;t<TREES;t++){
    const idx=Array.from({length:train.length},()=>Math.floor(rand()*train.length));
    trees.push(buildTree(Xtr,ytr,idx,C,0,8,3,mtry,rand));
  }
  const prior=new Array(C).fill(0);
  ytr.forEach(c=>{prior[c]++;});
  let maj=0;
  for(let c=1;c<C;c++)if(prior[c]>prior[maj])maj=c;
  let hit=0,top3=0,base=0;
  const perBrgy={};
  test.forEach(p=>{
    const x=toX(p);
    const dist=new Array(C).fill(0);
    trees.forEach(tr=>{treeDist(tr,x).forEach((v,c)=>{dist[c]+=v;});});
    const ranked=dist.map((v,c)=>[v,c]).sort((a,b)=>b[0]-a[0]);
    const truth=typeNames.indexOf(p.type);
    const ok=ranked[0][1]===truth;
    if(ok)hit++;
    if(ranked.slice(0,3).some(r=>r[1]===truth))top3++;
    if(truth===maj)base++;
    const pb=perBrgy[p.barangay]||(perBrgy[p.barangay]={n:0,correct:0});
    pb.n++;if(ok)pb.correct++;
  });
  const value=hit/test.length;
  return {
    ok:true,value,ci:wilson(value,test.length),top3:top3/test.length,
    baseline:base/test.length,majorityType:typeNames[maj],
    nTrain:train.length,nTest:test.length,perBrgy
  };
}
