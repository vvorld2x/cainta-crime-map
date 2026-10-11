import {state,canWrite} from './state.js';
import {fetchActive,fetchRecentlyDeleted} from './api.js';
import {refreshAll} from './refresh.js';

export async function reloadData(){
  const [active,deleted]=await Promise.all([
    fetchActive(),
    canWrite()?fetchRecentlyDeleted():Promise.resolve([])
  ]);
  state.crimeData=active;
  state.deletedBin=deleted;
  refreshAll();
}
