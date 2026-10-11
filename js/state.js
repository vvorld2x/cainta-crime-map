import {CRIME_TYPES} from './constants.js';

export const state={
  user:null,
  profile:null,
  crimeData:[],
  deletedBin:[],
  activeTypes:new Set(CRIME_TYPES.map(c=>c.name)),
  activeBrgy:'',
  darkOn:false,
  satOn:false,
  charts:{}
};

export const undoHandlers=new Map();

export function canWrite(){
  return !!state.profile&&(state.profile.role==='admin'||state.profile.role==='officer');
}

export function isAdmin(){
  return !!state.profile&&state.profile.role==='admin';
}

export function visibleData(){
  return state.crimeData.filter(c=>state.activeTypes.has(c.type)&&(!state.activeBrgy||c.barangay===state.activeBrgy));
}

export function brgyData(){
  return state.crimeData.filter(c=>!state.activeBrgy||c.barangay===state.activeBrgy);
}
