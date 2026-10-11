import {sb} from './supabase.js';

export async function signIn(email,password){
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error||!data||!data.user)throw new Error('Sign in failed');
  return data.user;
}

export async function signOut(){
  try{
    await sb.auth.signOut();
  }catch(e){}
}

export async function currentSessionUser(){
  const {data,error}=await sb.auth.getSession();
  if(error||!data||!data.session)return null;
  const check=await sb.auth.getUser();
  if(check.error||!check.data||!check.data.user)return null;
  return check.data.user;
}

export function onSignedOut(fn){
  sb.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT')fn();
  });
}
