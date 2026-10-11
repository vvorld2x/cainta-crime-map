import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';

export const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SUPABASE_URL)
  &&typeof SUPABASE_ANON_KEY==='string'
  &&SUPABASE_ANON_KEY.length>40
  &&!SUPABASE_ANON_KEY.startsWith('YOUR')
  &&!!window.supabase;

export const sb=configured
  ?window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  })
  :null;
