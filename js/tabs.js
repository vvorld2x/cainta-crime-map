import {MAP,invalidateMap} from './map.js';
import {$} from './util.js';
import {canWrite} from './state.js';

const TABS=['map','dashboard','encode','predict','audit'];
const PANELS=['dashboard','encode','predict','audit'];
const hooks={};

export function onTab(name,fn){
  hooks[name]=fn;
}

export function setTab(t){
  if(!TABS.includes(t))return;
  if((t==='encode'||t==='audit')&&!canWrite())return;
  document.querySelectorAll('.ntab').forEach(n=>n.classList.toggle('on',n.dataset.tab===t));
  $('map-wrap').style.display=t==='map'?'flex':'none';
  PANELS.forEach(p=>$('panel-'+p).classList.toggle('on',p===t));
  if(t==='map'&&MAP)setTimeout(invalidateMap,50);
  if(hooks[t])hooks[t]();
}
