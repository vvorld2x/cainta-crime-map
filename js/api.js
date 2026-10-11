import {sb} from './supabase.js';
import {CRIME_TYPES,LIMITS} from './constants.js';

const COLS='id,incident_date,incident_time,crime_type,barangay,location,modus,status,lat,lng,deleted_at';
const PAGE=1000;
const WRITE_CHUNK=200;

function colorOf(name){
  const found=CRIME_TYPES.find(c=>c.name===name);
  return found?found.color:'#888888';
}

function fromRow(r){
  return {
    id:r.id,
    lat:r.lat,
    lng:r.lng,
    type:r.crime_type,
    color:colorOf(r.crime_type),
    barangay:r.barangay,
    date:r.incident_date,
    time:String(r.incident_time).slice(0,5),
    location:r.location,
    modus:r.modus,
    status:r.status,
    deletedAt:r.deleted_at?Date.parse(r.deleted_at):null
  };
}

function toRow(r){
  return {
    incident_date:r.date,
    incident_time:r.time,
    crime_type:r.type,
    barangay:r.barangay,
    location:r.location,
    modus:r.modus,
    status:r.status,
    lat:r.lat,
    lng:r.lng
  };
}

function check(error){
  if(error){
    console.error('request failed',error.code||'');
    throw new Error('Request failed');
  }
}

function chunks(list,size){
  const out=[];
  for(let i=0;i<list.length;i+=size)out.push(list.slice(i,i+size));
  return out;
}

export async function fetchProfile(userId){
  const {data,error}=await sb.from('profiles').select('display_name,role').eq('id',userId).maybeSingle();
  check(error);
  return data;
}

export async function fetchActive(){
  const out=[];
  for(let from=0;;from+=PAGE){
    const {data,error}=await sb.from('incidents').select(COLS).is('deleted_at',null).order('id',{ascending:true}).range(from,from+PAGE-1);
    check(error);
    out.push(...data.map(fromRow));
    if(data.length<PAGE)break;
  }
  return out;
}

export async function fetchRecentlyDeleted(){
  const since=new Date(Date.now()-LIMITS.trashMs).toISOString();
  const {data,error}=await sb.from('incidents').select(COLS).not('deleted_at','is',null).gte('deleted_at',since).order('deleted_at',{ascending:false}).limit(500);
  check(error);
  return data.map(fromRow);
}

export async function insertOne(rec){
  const {data,error}=await sb.from('incidents').insert(toRow(rec)).select(COLS).single();
  check(error);
  return fromRow(data);
}

export async function insertMany(recs){
  const ids=[];
  for(const part of chunks(recs,500)){
    const {data,error}=await sb.from('incidents').insert(part.map(toRow)).select('id');
    if(error){
      console.error('request failed',error.code||'');
      const failure=new Error('Request failed');
      failure.insertedIds=ids;
      throw failure;
    }
    data.forEach(r=>ids.push(r.id));
  }
  return ids;
}

export async function softDelete(ids){
  for(const part of chunks(ids,WRITE_CHUNK)){
    const {error}=await sb.from('incidents').update({deleted_at:new Date().toISOString()}).in('id',part);
    check(error);
  }
}

export async function restore(ids){
  for(const part of chunks(ids,WRITE_CHUNK)){
    const {error}=await sb.from('incidents').update({deleted_at:null}).in('id',part);
    check(error);
  }
}

export async function insertAudit(action,detail,type){
  const {data,error}=await sb.from('audit_log').insert({action,detail,action_type:type}).select('id').single();
  check(error);
  return data.id;
}

export async function fetchAudit(){
  const {data,error}=await sb.from('audit_log').select('id,action,detail,action_type,created_at').order('created_at',{ascending:false}).limit(100);
  check(error);
  return data;
}

export async function purgeExpired(){
  const {error}=await sb.rpc('purge_deleted_incidents');
  if(error)console.error('request failed',error.code||'');
}
