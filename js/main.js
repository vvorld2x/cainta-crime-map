import {LIMITS} from './constants.js';
import {state,canWrite,isAdmin,undoHandlers} from './state.js';
import {$,showToast} from './util.js';
import {configured} from './supabase.js';
import {signIn,signOut,currentSessionUser,onSignedOut} from './auth.js';
import {fetchProfile,purgeExpired} from './api.js';
import {reloadData} from './data.js';
import {onRefresh,refreshAll} from './refresh.js';
import {initMap,buildMarkers,buildHeatmap,invalidateMap,LG} from './map.js';
import {buildSelects,buildLegend,buildCrimeFilter,buildRecentList,updateStats,initSidebar} from './sidebar.js';
import {onTab,setTab} from './tabs.js';
import {buildDashboard,clearDashboard} from './dashboard.js';
import {buildEncTable,initEncoder,resetEncoder} from './encoder.js';
import {initAnalysis,clearAnalysis} from './analysis.js';
import {buildAuditLog,setAuditTab,initAudit} from './audit.js';
import {toggleDark} from './theme.js';
import {initMobile,closeDrawer} from './mobile.js';

const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let failures=0;
let lockedUntil=0;
let idleTimer=null;
let entering=false;
let loggingOut=false;

function showLoginError(message){
  $('l-err-text').textContent=message;
  $('l-err').classList.add('show');
}

function clearLoginError(){
  $('l-err').classList.remove('show');
}

function resetIdleTimer(){
  clearTimeout(idleTimer);
  idleTimer=setTimeout(()=>{doLogout();},LIMITS.idleMs);
}

function startIdleWatch(){
  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev=>{
    window.addEventListener(ev,resetIdleTimer,{passive:true});
  });
  resetIdleTimer();
}

function stopIdleWatch(){
  clearTimeout(idleTimer);
  ['mousemove','keydown','click','touchstart','scroll'].forEach(ev=>{
    window.removeEventListener(ev,resetIdleTimer);
  });
}

function showLogin(){
  $('app').classList.remove('show');
  $('login-screen').classList.remove('hidden');
  requestAnimationFrame(()=>$('login-screen').classList.remove('out'));
}

function showApp(){
  $('app').classList.add('show');
  $('login-screen').classList.add('out');
  setTimeout(()=>{
    if($('app').classList.contains('show'))$('login-screen').classList.add('hidden');
    invalidateMap();
  },500);
}

function applyRole(){
  const writer=canWrite();
  $('tab-encode').classList.toggle('hidden',!writer);
  $('tab-audit').classList.toggle('hidden',!writer);
}

async function enterApp(user){
  if(entering)return;
  entering=true;
  try{
    let profile=null;
    try{
      profile=await fetchProfile(user.id);
    }catch(e){
      profile=null;
    }
    if(!profile){
      await signOut();
      showLogin();
      showLoginError('This account is not authorized.');
      return;
    }
    state.user={id:user.id};
    state.profile={display_name:profile.display_name,role:profile.role};
    $('tb-username').textContent=profile.display_name;
    applyRole();
    try{
      await reloadData();
    }catch(e){
      showToast('Could not load incident data','error');
    }
    if(isAdmin())purgeExpired();
    setTab('map');
    showApp();
    startIdleWatch();
  }finally{
    entering=false;
  }
}

async function doLogout(){
  if(loggingOut)return;
  loggingOut=true;
  try{
    await performLogout();
  }finally{
    loggingOut=false;
  }
}

async function performLogout(){
  stopIdleWatch();
  closeDrawer();
  resetEncoder();
  undoHandlers.clear();
  state.user=null;
  state.profile=null;
  state.crimeData=[];
  state.deletedBin=[];
  state.activeBrgy='';
  $('brgy-sel').value='';
  refreshAll();
  clearDashboard();
  clearAnalysis();
  LG.clusters.clearLayers();
  ['enc-tbl','audit-log','audit-trash'].forEach(id=>$(id).replaceChildren());
  $('imp-status').textContent='';
  $('l-pass').value='';
  $('l-user').value='';
  clearLoginError();
  setTab('map');
  setAuditTab('log');
  await signOut();
  showLogin();
}

async function handleLogin(e){
  e.preventDefault();
  clearLoginError();
  const now=Date.now();
  if(now<lockedUntil){
    showLoginError('Too many attempts. Try again in '+Math.ceil((lockedUntil-now)/1000)+' seconds.');
    return;
  }
  const email=$('l-user').value.trim().toLowerCase();
  const password=$('l-pass').value;
  if(!EMAIL_RE.test(email)||email.length>254||!password||password.length>128){
    showLoginError('Invalid email or password. Please try again.');
    return;
  }
  const btn=$('login-btn');
  btn.disabled=true;
  try{
    const user=await signIn(email,password);
    failures=0;
    $('l-pass').value='';
    await enterApp(user);
  }catch(err){
    failures++;
    if(failures>=LIMITS.maxLoginFailures){
      failures=0;
      lockedUntil=Date.now()+LIMITS.lockoutMs;
      showLoginError('Too many attempts. Try again in '+Math.ceil(LIMITS.lockoutMs/1000)+' seconds.');
    }else{
      showLoginError('Invalid email or password. Please try again.');
    }
    $('l-pass').value='';
    $('l-pass').focus();
  }finally{
    btn.disabled=false;
  }
}

function bindShell(){
  document.querySelectorAll('.ntab').forEach(btn=>{
    btn.addEventListener('click',()=>setTab(btn.dataset.tab));
  });
  $('dark-btn').addEventListener('click',toggleDark);
  $('logout-btn').addEventListener('click',doLogout);
}

function registerRefresh(){
  onRefresh(buildCrimeFilter);
  onRefresh(buildRecentList);
  onRefresh(buildMarkers);
  onRefresh(buildHeatmap);
  onRefresh(updateStats);
  onRefresh(buildEncTable);
}

function registerTabs(){
  onTab('dashboard',buildDashboard);
  onTab('encode',buildEncTable);
  onTab('audit',()=>{
    buildAuditLog();
    setAuditTab('log');
  });
}

async function init(){
  $('login-form').addEventListener('submit',handleLogin);
  if(!configured){
    $('login-btn').disabled=true;
    showLoginError('Supabase is not configured. Set the project URL and anon key in js/config.js.');
    return;
  }
  initMap();
  buildSelects();
  buildLegend();
  buildCrimeFilter();
  initSidebar();
  initEncoder();
  initAnalysis();
  initAudit();
  bindShell();
  initMobile();
  registerRefresh();
  registerTabs();
  onSignedOut(()=>{
    if($('app').classList.contains('show'))doLogout();
  });
  const user=await currentSessionUser();
  if(user)await enterApp(user);
}

init();
