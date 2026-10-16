import {$} from './util.js';
import {invalidateMap} from './map.js';

const query=window.matchMedia('(max-width: 900px)');

function setDrawer(open){
  $('sidebar').classList.toggle('open',open);
  $('sb-backdrop').classList.toggle('show',open);
  $('menu-btn').setAttribute('aria-expanded',String(open));
}

export function closeDrawer(){
  setDrawer(false);
}

function applyCollapse(){
  document.querySelectorAll('.collapsible').forEach(el=>{
    el.classList.toggle('collapsed',query.matches);
  });
}

export function initMobile(){
  applyCollapse();
  $('menu-btn').addEventListener('click',()=>setDrawer(!$('sidebar').classList.contains('open')));
  $('sb-close').addEventListener('click',closeDrawer);
  $('sb-backdrop').addEventListener('click',closeDrawer);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeDrawer();
  });
  document.querySelectorAll('.collapse-head').forEach(head=>{
    head.addEventListener('click',()=>{
      if(query.matches)head.parentElement.classList.toggle('collapsed');
    });
  });
  $('rec-list').addEventListener('click',closeDrawer);
  $('brgy-sel').addEventListener('change',closeDrawer);
  document.querySelectorAll('.ntab').forEach(btn=>btn.addEventListener('click',closeDrawer));
  let timer;
  const onResize=()=>{
    clearTimeout(timer);
    timer=setTimeout(invalidateMap,150);
  };
  window.addEventListener('resize',onResize);
  window.addEventListener('orientationchange',onResize);
  query.addEventListener('change',()=>{
    applyCollapse();
    closeDrawer();
    invalidateMap();
  });
}
