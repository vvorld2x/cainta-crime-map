const listeners=[];

export function onRefresh(fn){
  listeners.push(fn);
}

export function refreshAll(){
  listeners.forEach(fn=>fn());
}
