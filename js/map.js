import {CAINTA,BRGY_COORDS,CLOSED_STATUSES} from './constants.js';
import {CARTO_KEY} from './config.js';
import {state,visibleData} from './state.js';
import {esc,$} from './util.js';

export let MAP=null;
export const LG={};
const LS={markers:true,heatmap:true,clusters:true};
const tiles={};

function cartoUrl(path){
  const key=CARTO_KEY?'?key='+encodeURIComponent(CARTO_KEY):'';
  return 'https://basemaps.cartocdn.com/'+path+'/{z}/{x}/{y}.png'+key;
}

function baseLayer(){
  return state.darkOn?tiles.dark:tiles.street;
}

export function initMap(){
  MAP=L.map('map',{zoomControl:false}).setView(CAINTA,14);
  const attribution='© OpenStreetMap contributors © CARTO';
  tiles.street=L.tileLayer(cartoUrl('rastertiles/voyager'),{maxZoom:20,attribution});
  tiles.dark=L.tileLayer(cartoUrl('dark_all'),{maxZoom:20,attribution});
  tiles.sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'});
  tiles.street.addTo(MAP);
  LG.markers=L.layerGroup().addTo(MAP);
  LG.heatmap=L.layerGroup().addTo(MAP);
  LG.clusters=L.layerGroup().addTo(MAP);

  $('zoom-in').addEventListener('click',()=>MAP.zoomIn());
  $('zoom-out').addEventListener('click',()=>MAP.zoomOut());
  $('reset-view').addEventListener('click',()=>MAP.setView(CAINTA,14));
  document.querySelectorAll('[data-layer]').forEach(row=>{
    row.addEventListener('click',()=>toggleLayer(row.dataset.layer));
  });
  $('satellite-row').addEventListener('click',toggleSatellite);

  $('leg-ring-hot').style.borderColor='#E8323A';
  $('leg-ring-hot').style.opacity='.7';
  $('leg-ring-int').style.borderColor='#D97706';
  $('leg-ring-int').style.opacity='.6';
  $('leg-ring-int').style.borderStyle='dashed';
}

function toggleLayer(name){
  if(!LG[name])return;
  LS[name]=!LS[name];
  if(LS[name])MAP.addLayer(LG[name]);else MAP.removeLayer(LG[name]);
  $('sw-'+name).classList.toggle('on',LS[name]);
}

function toggleSatellite(){
  state.satOn=!state.satOn;
  if(state.satOn){
    MAP.removeLayer(baseLayer());
    tiles.sat.addTo(MAP);
  }else{
    MAP.removeLayer(tiles.sat);
    baseLayer().addTo(MAP);
  }
  $('sw-satellite').classList.toggle('on',state.satOn);
}

export function applyDarkTiles(dark){
  if(state.satOn)return;
  const from=dark?tiles.street:tiles.dark;
  const to=dark?tiles.dark:tiles.street;
  MAP.removeLayer(from);
  to.addTo(MAP);
}

export function invalidateMap(){
  if(MAP)MAP.invalidateSize();
}

export function buildMarkers(){
  LG.markers.clearLayers();
  visibleData().forEach(c=>{
    const mk=L.circleMarker([c.lat,c.lng],{radius:6,fillColor:c.color,color:'#ffffff',weight:1.5,fillOpacity:.88});
    const badge=CLOSED_STATUSES.includes(c.status)?'badge-g':'badge-a';
    mk.bindPopup(
      '<div class="pu-type" style="color:'+esc(c.color)+'">'+esc(c.type)+'</div>'
      +'<div class="pu-row"><span>Date</span><span>'+esc(c.date)+'</span></div>'
      +'<div class="pu-row"><span>Time</span><span>'+esc(c.time)+'</span></div>'
      +'<div class="pu-row"><span>Barangay</span><span>'+esc(c.barangay)+'</span></div>'
      +'<div class="pu-row"><span>Location</span><span>'+esc(c.location)+'</span></div>'
      +'<div class="pu-row"><span>Modus</span><span>'+esc(c.modus)+'</span></div>'
      +'<span class="pu-badge '+badge+'">'+esc(c.status)+'</span>'
    );
    LG.markers.addLayer(mk);
  });
}

export function buildHeatmap(){
  LG.heatmap.clearLayers();
  const data=visibleData();
  const res=0.0018;
  const grid={};
  data.forEach(c=>{
    const gx=Math.round(c.lat/res)*res;
    const gy=Math.round(c.lng/res)*res;
    const k=gx+','+gy;
    grid[k]=(grid[k]||0)+1;
  });
  const mx=Math.max(...Object.values(grid),1);
  Object.entries(grid).forEach(([k,v])=>{
    const [la,lo]=k.split(',').map(Number);
    const t=v/mx;
    const r=Math.round(220*Math.min(t*2.5,1));
    const g=Math.round(100*(1-t*1.2));
    L.circle([la,lo],{radius:160,fillColor:'rgb('+r+','+Math.max(g,0)+',30)',fillOpacity:t*0.38,color:'none'}).addTo(LG.heatmap);
  });
}

export function kmeans(pts,k,iters){
  if(!pts.length)return {centers:[],sizes:[]};
  let centers=pts.slice(0,Math.min(k,pts.length)).map(p=>({lat:p.lat,lng:p.lng}));
  const asgn=new Array(pts.length).fill(0);
  for(let it=0;it<(iters||20);it++){
    pts.forEach((p,i)=>{
      let best=0;
      let dist=Infinity;
      centers.forEach((c,j)=>{
        const dd=(p.lat-c.lat)**2+(p.lng-c.lng)**2;
        if(dd<dist){dist=dd;best=j;}
      });
      asgn[i]=best;
    });
    centers=centers.map((c,j)=>{
      const members=pts.filter((_,i)=>asgn[i]===j);
      if(!members.length)return c;
      return {
        lat:members.reduce((s,p)=>s+p.lat,0)/members.length,
        lng:members.reduce((s,p)=>s+p.lng,0)/members.length
      };
    });
  }
  return {centers,sizes:centers.map((_,j)=>pts.filter((_,i)=>asgn[i]===j).length)};
}

export function focusBarangay(name){
  if(name&&BRGY_COORDS[name])MAP.setView(BRGY_COORDS[name],15);
}
