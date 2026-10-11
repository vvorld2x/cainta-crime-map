import {state} from './state.js';
import {$} from './util.js';
import {applyDarkTiles} from './map.js';

function applyChartTheme(){
  const tick=state.darkOn?'#C4D0DC':'#7A94A8';
  const grid=state.darkOn?'rgba(255,255,255,.06)':'rgba(0,0,0,.04)';
  Object.values(state.charts).forEach(ch=>{
    if(!ch||!ch.options)return;
    try{
      ['x','y'].forEach(ax=>{
        const scale=ch.options.scales&&ch.options.scales[ax];
        if(!scale)return;
        if(scale.ticks)scale.ticks.color=tick;
        if(scale.grid&&scale.grid.display!==false)scale.grid.color=grid;
      });
      const legend=ch.options.plugins&&ch.options.plugins.legend&&ch.options.plugins.legend.labels;
      if(legend)legend.color=tick;
      ch.update();
    }catch(e){}
  });
}

export function toggleDark(){
  state.darkOn=!state.darkOn;
  document.body.classList.toggle('dark',state.darkOn);
  const btn=$('dark-btn');
  btn.innerHTML=state.darkOn?'<i class="fa-solid fa-sun"></i>':'<i class="fa-solid fa-moon"></i>';
  btn.title=state.darkOn?'Switch to Light Mode':'Switch to Dark Mode';
  applyDarkTiles(state.darkOn);
  applyChartTheme();
}
