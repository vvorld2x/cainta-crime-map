export const $=id=>document.getElementById(id);

const ESC_MAP={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};

export function esc(value){
  return String(value===null||value===undefined?'':value).replace(/[&<>"']/g,c=>ESC_MAP[c]);
}

export function clean(value,max){
  return String(value===null||value===undefined?'':value).replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max);
}

export function validDate(s){
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const [y,m,d]=s.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return false;
  return y>=2000&&dt.getTime()<=Date.now()+86400000;
}

export function validTime(s){
  return typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function numberInRange(value,min,max){
  if(value===''||value===null||value===undefined)return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=min&&n<=max?n:NaN;
}

let toastTimer;
export function showToast(message,type){
  const t=$('toast');
  const icon=document.createElement('i');
  icon.className='fa-solid fa-'+(type==='success'?'circle-check':'circle-exclamation');
  const text=document.createElement('span');
  text.textContent=message;
  t.replaceChildren(icon,text);
  t.className='toast toast-'+(type==='success'?'s':'e')+' show';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),3500);
}
