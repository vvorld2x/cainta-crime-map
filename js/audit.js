import {state,undoHandlers,canWrite} from './state.js';
import {esc,$,showToast} from './util.js';
import {insertAudit,fetchAudit,restore,softDelete} from './api.js';
import {reloadData} from './data.js';
import {refreshAll} from './refresh.js';
import {LIMITS} from './constants.js';

const ICONS={add:['ai-add','fa-plus'],edit:['ai-edit','fa-pen'],exp:['ai-exp','fa-file-export']};

export async function logAction(action,detail,type,undo){
  try{
    const id=await insertAudit(action,String(detail).slice(0,500),type);
    if(undo)undoHandlers.set(String(id),undo);
  }catch(e){
    showToast('Audit entry could not be saved','error');
  }
}

export async function buildAuditLog(){
  const el=$('audit-log');
  let rows;
  try{
    rows=await fetchAudit();
  }catch(e){
    el.innerHTML='<p class="pane-note">Activity log could not be loaded.</p>';
    return;
  }
  if(!rows.length){
    el.innerHTML='<p class="pane-note">No activity recorded yet.</p>';
    return;
  }
  el.replaceChildren();
  rows.forEach(a=>{
    const [cls,icon]=ICONS[a.action_type]||ICONS.add;
    const undo=undoHandlers.has(String(a.id))
      ?'<button class="mini-btn" data-undo-id="'+esc(a.id)+'"><i class="fa-solid fa-rotate-left"></i> Undo</button>'
      :'';
    el.insertAdjacentHTML('beforeend',
      '<div class="audit-item"><div class="audit-icon '+cls+'"><i class="fa-solid '+icon+'"></i></div>'
      +'<div class="audit-main"><div class="audit-action">'+esc(a.action)+'</div><div class="audit-detail">'+esc(a.detail)+'</div></div>'
      +'<div class="audit-side">'+undo+'<div class="audit-time">'+esc(new Date(a.created_at).toLocaleString())+'</div></div></div>'
    );
  });
}

async function undoAction(id){
  const handler=undoHandlers.get(id);
  if(!handler){
    showToast('Cannot undo this action','error');
    return;
  }
  try{
    await handler();
    undoHandlers.delete(id);
    await logAction('Action Reverted','Entry #'+id+' was undone','edit');
    await buildAuditLog();
    showToast('Action reverted','success');
  }catch(e){
    showToast('Could not revert this action','error');
  }
}

export function buildTrashBin(){
  const el=$('audit-trash');
  el.replaceChildren();
  const now=Date.now();
  state.deletedBin=state.deletedBin.filter(d=>d.deletedAt&&now-d.deletedAt<LIMITS.trashMs);
  if(!state.deletedBin.length){
    el.innerHTML='<p class="pane-note">No recently deleted records. Deleted records are purged after 24 hours.</p>';
    return;
  }
  state.deletedBin.forEach(d=>{
    const msLeft=LIMITS.trashMs-(now-d.deletedAt);
    const h=Math.floor(msLeft/3600000);
    const m=Math.floor((msLeft%3600000)/60000);
    const countdown=h>0?h+'h '+m+'m remaining':m+'m remaining';
    el.insertAdjacentHTML('beforeend',
      '<div class="trash-item"><div class="audit-icon ai-edit"><i class="fa-solid fa-trash"></i></div>'
      +'<div class="audit-main"><div class="audit-action">'+esc(d.type)+' — '+esc(d.barangay)+'</div>'
      +'<div class="audit-detail">'+esc(d.date)+' '+esc(d.time)+' · '+esc(d.location)+' · '+esc(d.modus)+'</div></div>'
      +'<div class="audit-side col"><button class="mini-btn" data-restore-id="'+esc(d.id)+'"><i class="fa-solid fa-rotate-left"></i> Restore</button>'
      +'<span class="trash-countdown">'+esc(countdown)+'</span></div></div>'
    );
  });
}

async function restoreRecord(id){
  if(!canWrite())return;
  const rec=state.deletedBin.find(d=>String(d.id)===String(id));
  if(!rec)return;
  try{
    await restore([rec.id]);
  }catch(e){
    showToast('Could not restore record','error');
    return;
  }
  state.deletedBin=state.deletedBin.filter(d=>d.id!==rec.id);
  state.crimeData.push({...rec,deletedAt:null});
  refreshAll();
  buildTrashBin();
  showToast('Restored: '+rec.type+' in '+rec.barangay,'success');
  logAction('Record Restored',rec.type+' — '+rec.barangay+' — '+rec.date+' '+rec.time,'edit',async()=>{
    await softDelete([rec.id]);
    await reloadData();
  });
}

export function setAuditTab(tab){
  $('axtab-log').classList.toggle('on',tab==='log');
  $('axtab-trash').classList.toggle('on',tab==='trash');
  $('audit-log-pane').classList.toggle('hidden',tab!=='log');
  $('audit-trash-pane').classList.toggle('hidden',tab!=='trash');
  if(tab==='trash')buildTrashBin();
}

export function initAudit(){
  document.querySelectorAll('[data-audit-tab]').forEach(btn=>{
    btn.addEventListener('click',()=>setAuditTab(btn.dataset.auditTab));
  });
  $('audit-log').addEventListener('click',e=>{
    const btn=e.target.closest('[data-undo-id]');
    if(btn)undoAction(btn.dataset.undoId);
  });
  $('audit-trash').addEventListener('click',e=>{
    const btn=e.target.closest('[data-restore-id]');
    if(btn)restoreRecord(btn.dataset.restoreId);
  });
}
