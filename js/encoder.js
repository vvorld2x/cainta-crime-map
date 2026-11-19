import {BARANGAYS,BRGY_COORDS,CAINTA,CRIME_TYPES,STATUSES,CLOSED_STATUSES,BOUNDS,LIMITS} from './constants.js';
import {state,canWrite} from './state.js';
import {esc,$,showToast,clean,validDate,validTime,numberInRange} from './util.js';
import {MAP} from './map.js';
import {setTab} from './tabs.js';
import {refreshAll} from './refresh.js';
import {insertOne,insertMany,updateOne,softDelete,restore} from './api.js';
import {logAction} from './audit.js';
import {reloadData} from './data.js';

let pickMode=false;
let saving=false;
let importing=false;
let editingId=null;

const SORT_KEYS=['id','datetime','type','barangay','location','modus','status'];
const ROW_CAP=80;
let sortKey='id';
let sortDir='desc';

function compareRecords(a,b){
  let result;
  if(sortKey==='id')result=a.id-b.id;
  else if(sortKey==='datetime')result=(a.date+' '+a.time).localeCompare(b.date+' '+b.time);
  else result=String(a[sortKey]).localeCompare(String(b[sortKey]),undefined,{sensitivity:'base',numeric:true});
  if(result===0)result=a.id-b.id;
  return sortDir==='asc'?result:-result;
}

function updateSortHeaders(){
  document.querySelectorAll('[data-sort-th]').forEach(th=>{
    const active=th.dataset.sortTh===sortKey;
    th.setAttribute('aria-sort',active?(sortDir==='asc'?'ascending':'descending'):'none');
    th.querySelector('.sort-ind').textContent=active?(sortDir==='asc'?'▲':'▼'):'';
  });
}

function changeSort(key){
  if(!SORT_KEYS.includes(key))return;
  if(sortKey===key){
    sortDir=sortDir==='asc'?'desc':'asc';
  }else{
    sortKey=key;
    sortDir=key==='id'||key==='datetime'?'desc':'asc';
  }
  buildEncTable();
}

export function buildEncTable(){
  const tb=$('enc-tbl');
  tb.replaceChildren();
  const q=clean($('search-input').value,100).toLowerCase();
  const filtered=state.crimeData.filter(c=>!q||(c.type+' '+c.barangay+' '+c.modus+' '+c.date+' '+c.location).toLowerCase().includes(q));
  const sorted=filtered.slice().sort(compareRecords);
  $('rec-count').textContent=sorted.length>ROW_CAP?'(showing '+ROW_CAP+' of '+sorted.length+' records)':'('+sorted.length+' records)';
  updateSortHeaders();
  sorted.slice(0,ROW_CAP).forEach(c=>{
    const badge=CLOSED_STATUSES.includes(c.status)?'badge-g':c.status==='Ongoing Investigation'?'badge-b':'badge-a';
    tb.insertAdjacentHTML('beforeend',
      '<tr><td class="idx">#'+esc(c.id)+'</td>'
      +'<td class="mono small">'+esc(c.date)+' '+esc(c.time)+'</td>'
      +'<td><span class="type-label" style="color:'+esc(c.color)+'">'+esc(c.type)+'</span></td>'
      +'<td>'+esc(c.barangay)+'</td>'
      +'<td class="clip">'+esc(c.location)+'</td>'
      +'<td class="small">'+esc(c.modus)+'</td>'
      +'<td><span class="badge '+badge+'">'+esc(c.status)+'</span></td>'
      +'<td><div class="row-actions">'
      +'<button class="btn btn-ghost btn-sm" data-edit-id="'+esc(c.id)+'" aria-label="Edit record"><i class="fa-solid fa-pen"></i></button>'
      +'<button class="btn btn-ghost btn-sm" data-del-id="'+esc(c.id)+'" aria-label="Delete record"><i class="fa-solid fa-trash"></i></button>'
      +'</div></td></tr>'
    );
  });
}

const FIELD_LABELS=[
  ['date','Date'],
  ['time','Time'],
  ['type','Crime Type'],
  ['barangay','Barangay'],
  ['status','Status'],
  ['location','Location'],
  ['modus','Modus'],
  ['lat','Latitude'],
  ['lng','Longitude']
];

function sameValue(key,a,b){
  if(key==='lat'||key==='lng')return Math.abs(Number(a)-Number(b))<1e-7;
  return a===b;
}

function describeChanges(before,after){
  return FIELD_LABELS
    .filter(([key])=>!sameValue(key,before[key],after[key]))
    .map(([key,label])=>label+': '+before[key]+' to '+after[key]);
}

function setEncoderOpen(open){
  $('enc-form').classList.toggle('hidden',!open);
  const t=$('enc-toggle');
  t.setAttribute('aria-expanded',String(open));
  t.title=open?'Hide encoder form':'Show encoder form';
  t.setAttribute('aria-label',t.title);
  t.firstElementChild.className=open?'fa-solid fa-chevron-up':'fa-solid fa-chevron-down';
}

function setEditMode(rec){
  editingId=rec?rec.id:null;
  if(rec)setEncoderOpen(true);
  $('enc-form').classList.toggle('editing',!!rec);
  $('enc-title-text').textContent=rec?'Edit Incident Record #'+rec.id:'Encode New Incident Record';
  $('enc-title-icon').className=rec?'fa-solid fa-pen-to-square':'fa-solid fa-plus-circle';
  $('save-label').textContent=rec?'Update Record':'Save Record';
  $('clear-btn').classList.toggle('hidden',!!rec);
  $('cancel-edit-btn').classList.toggle('hidden',!rec);
}

function clearForm(){
  ['f-date','f-time','f-loc','f-modus','f-lat','f-lng'].forEach(id=>{$(id).value='';});
  $('f-type').value='';
  $('f-brgy').value='';
  $('f-status').value='Under Investigation';
}

function cancelEdit(){
  setEditMode(null);
  clearForm();
}

export function resetEncoder(){
  endMapPick();
  setEditMode(null);
  clearForm();
  $('search-input').value='';
}

function startEdit(id){
  if(!canWrite())return;
  const rec=state.crimeData.find(c=>String(c.id)===String(id));
  if(!rec)return;
  $('f-date').value=rec.date;
  $('f-time').value=rec.time;
  $('f-type').value=rec.type;
  $('f-brgy').value=rec.barangay;
  $('f-status').value=rec.status;
  $('f-loc').value=rec.location;
  $('f-modus').value=rec.modus;
  $('f-lat').value=String(rec.lat);
  $('f-lng').value=String(rec.lng);
  setEditMode(rec);
  $('enc-form').scrollIntoView({behavior:'smooth',block:'start'});
}

function readForm(){
  const date=$('f-date').value;
  const time=$('f-time').value;
  const type=$('f-type').value;
  const brgy=$('f-brgy').value;
  const status=$('f-status').value;
  if(!date||!time||!type||!brgy){
    showToast('Fill in: Date, Time, Crime Type, Barangay','error');
    return null;
  }
  if(!validDate(date)||!validTime(time)){
    showToast('Enter a valid date and time','error');
    return null;
  }
  if(!CRIME_TYPES.some(c=>c.name===type)||!BARANGAYS.includes(brgy)||!STATUSES.includes(status)){
    showToast('Invalid selection','error');
    return null;
  }
  const lat=numberInRange($('f-lat').value,BOUNDS.latMin,BOUNDS.latMax);
  const lng=numberInRange($('f-lng').value,BOUNDS.lngMin,BOUNDS.lngMax);
  if(Number.isNaN(lat)||Number.isNaN(lng)){
    showToast('Coordinates are outside the Cainta area','error');
    return null;
  }
  const base=BRGY_COORDS[brgy]||CAINTA;
  return {
    date,time,type,barangay:brgy,status,
    location:clean($('f-loc').value,LIMITS.maxText)||'Not specified',
    modus:clean($('f-modus').value,LIMITS.maxText)||'Unknown',
    lat:lat===null?base[0]:lat,
    lng:lng===null?base[1]:lng
  };
}

async function updateRecord(rec){
  const before=state.crimeData.find(c=>c.id===editingId);
  if(!before){
    showToast('This record is no longer available','error');
    cancelEdit();
    return;
  }
  const changes=describeChanges(before,rec);
  if(!changes.length){
    showToast('No changes to save','error');
    return;
  }
  const snapshot={
    date:before.date,time:before.time,type:before.type,barangay:before.barangay,
    status:before.status,location:before.location,modus:before.modus,lat:before.lat,lng:before.lng
  };
  const id=before.id;
  const updated=await updateOne(id,rec);
  state.crimeData=state.crimeData.map(c=>c.id===id?updated:c);
  refreshAll();
  cancelEdit();
  showToast('Record #'+id+' updated','success');
  const detail=('#'+id+' '+before.type+', '+before.barangay+'. '+changes.join('; ')).slice(0,500);
  logAction('Record Edited',detail,'edit',async()=>{
    await updateOne(id,snapshot);
    await reloadData();
  });
}

async function createRecord(rec){
  const saved=await insertOne(rec);
  state.crimeData.push(saved);
  refreshAll();
  clearForm();
  showToast('Saved: '+rec.type+' in '+rec.barangay,'success');
  logAction('Record Encoded',rec.type+': '+rec.barangay+', '+rec.date+' '+rec.time,'add',async()=>{
    await softDelete([saved.id]);
    await reloadData();
  });
}

async function saveRecord(){
  if(saving||!canWrite())return;
  const rec=readForm();
  if(!rec)return;
  saving=true;
  $('save-btn').disabled=true;
  try{
    if(editingId!==null)await updateRecord(rec);
    else await createRecord(rec);
  }catch(e){
    showToast(editingId!==null?'Could not update record':'Could not save record','error');
  }finally{
    saving=false;
    $('save-btn').disabled=false;
  }
}

async function deleteRecord(id){
  if(!canWrite())return;
  const rec=state.crimeData.find(c=>String(c.id)===String(id));
  if(!rec)return;
  try{
    await softDelete([rec.id]);
  }catch(e){
    showToast('Could not delete record','error');
    return;
  }
  state.crimeData=state.crimeData.filter(c=>c.id!==rec.id);
  state.deletedBin.push({...rec,deletedAt:Date.now()});
  if(editingId===rec.id)cancelEdit();
  refreshAll();
  showToast('Record moved to Recently Deleted','success');
  logAction('Record Deleted',rec.type+': '+rec.barangay+', '+rec.date+' '+rec.time,'edit',async()=>{
    await restore([rec.id]);
    await reloadData();
  });
}

function startMapPick(){
  pickMode=true;
  document.body.classList.add('pick-mode');
  setTab('map');
  $('pick-banner').classList.add('show');
  showToast('Click map to set coordinates','success');
}

function endMapPick(){
  pickMode=false;
  document.body.classList.remove('pick-mode');
  $('pick-banner').classList.remove('show');
}

function excelDate(v){
  if(typeof v==='number'&&Number.isFinite(v)){
    const p=XLSX.SSF.parse_date_code(v);
    if(!p)return null;
    return String(p.y).padStart(4,'0')+'-'+String(p.m).padStart(2,'0')+'-'+String(p.d).padStart(2,'0');
  }
  const s=clean(v,40);
  const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso)return iso[1]+'-'+iso[2].padStart(2,'0')+'-'+iso[3].padStart(2,'0');
  const us=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(us)return us[3]+'-'+us[1].padStart(2,'0')+'-'+us[2].padStart(2,'0');
  return null;
}

function excelTime(v){
  if(typeof v==='number'&&Number.isFinite(v)){
    const frac=v-Math.floor(v);
    const mins=Math.round(frac*1440)%1440;
    return String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');
  }
  const s=clean(v,20);
  const m=s.match(/^(\d{1,2}):(\d{2})/);
  if(!m)return null;
  return m[1].padStart(2,'0')+':'+m[2];
}

function parseRow(r){
  const brgy=clean(r.Barangay,80);
  const type=clean(r.Crime_Type,80);
  if(!BARANGAYS.includes(brgy)||!CRIME_TYPES.some(c=>c.name===type))return null;
  const date=excelDate(r.Date);
  const time=excelTime(r.Time===''?0:r.Time);
  if(!date||!time||!validDate(date)||!validTime(time))return null;
  const statusRaw=clean(r.Status,40);
  const status=STATUSES.includes(statusRaw)?statusRaw:'Under Investigation';
  const base=BRGY_COORDS[brgy]||CAINTA;
  const lat=numberInRange(r.Latitude,BOUNDS.latMin,BOUNDS.latMax);
  const lng=numberInRange(r.Longitude,BOUNDS.lngMin,BOUNDS.lngMax);
  return {
    date,time,type,barangay:brgy,status,
    location:clean(r.Location_Description,LIMITS.maxText)||'Not specified',
    modus:clean(r.Modus_Operandi,LIMITS.maxText)||'Unknown',
    lat:lat===null||Number.isNaN(lat)?base[0]:lat,
    lng:lng===null||Number.isNaN(lng)?base[1]:lng
  };
}

async function importExcel(evt){
  const input=evt.target;
  const file=input.files[0];
  input.value='';
  if(!file||importing||!canWrite())return;
  if(!/\.(xlsx|xls)$/i.test(file.name)){
    showToast('Only .xlsx or .xls files are accepted','error');
    return;
  }
  if(file.size>LIMITS.maxImportBytes){
    showToast('File is too large (2 MB maximum)','error');
    return;
  }
  importing=true;
  let insertedIds=[];
  try{
    const buffer=await file.arrayBuffer();
    const wb=XLSX.read(buffer,{type:'array',cellFormula:false,cellHTML:false,cellStyles:false,sheetRows:LIMITS.maxImportRows+1});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
    if(rows.length>LIMITS.maxImportRows){
      showToast('Too many rows (maximum '+LIMITS.maxImportRows+')','error');
      return;
    }
    const parsed=rows.map(parseRow).filter(Boolean);
    const skipped=rows.length-parsed.length;
    if(!parsed.length){
      showToast('No valid rows found. Check the column names and values.','error');
      return;
    }
    try{
      insertedIds=await insertMany(parsed);
    }catch(e){
      insertedIds=e.insertedIds||[];
      await reloadData();
      showToast('Import stopped after '+insertedIds.length+' records','error');
      return;
    }
    await reloadData();
    $('imp-status').textContent=insertedIds.length+' records imported'+(skipped?', '+skipped+' skipped':'');
    showToast(insertedIds.length+' records imported successfully','success');
    const safeName=clean(file.name,100);
    logAction('Excel Data Imported',insertedIds.length+' records loaded from '+safeName,'add',async()=>{
      await softDelete(insertedIds);
      await reloadData();
    });
  }catch(e){
    showToast('Error reading file. Check format.','error');
  }finally{
    importing=false;
  }
}

function exportPDF(){
  showToast('PDF export is not available yet','error');
}

export function initEncoder(){
  $('save-btn').addEventListener('click',saveRecord);
  $('clear-btn').addEventListener('click',clearForm);
  $('cancel-edit-btn').addEventListener('click',cancelEdit);
  $('pick-btn').addEventListener('click',startMapPick);
  $('enc-toggle').addEventListener('click',()=>setEncoderOpen($('enc-form').classList.contains('hidden')));
  $('search-input').addEventListener('input',buildEncTable);
  $('enc-head').addEventListener('click',e=>{
    const btn=e.target.closest('[data-sort-key]');
    if(btn)changeSort(btn.dataset.sortKey);
  });
  $('import-btn').addEventListener('click',()=>$('xlsx-input').click());
  $('xlsx-input').addEventListener('change',importExcel);
  $('pdf-btn').addEventListener('click',exportPDF);
  $('enc-tbl').addEventListener('click',e=>{
    const del=e.target.closest('[data-del-id]');
    if(del){
      deleteRecord(del.dataset.delId);
      return;
    }
    const edit=e.target.closest('[data-edit-id]');
    if(edit)startEdit(edit.dataset.editId);
  });
  MAP.on('click',e=>{
    if(!pickMode)return;
    $('f-lat').value=e.latlng.lat.toFixed(6);
    $('f-lng').value=e.latlng.lng.toFixed(6);
    endMapPick();
    setTab('encode');
    showToast('Coordinates: '+e.latlng.lat.toFixed(4)+', '+e.latlng.lng.toFixed(4),'success');
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&pickMode)endMapPick();
  });
}
