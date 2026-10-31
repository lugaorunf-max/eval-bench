import type {DocumentNode} from '../contracts/editorial';
import {revisionChanges,documentEqual} from './writing-document';
const same=documentEqual;
/** Merge only independent block edits. Overlapping edits remain explicit user decisions. */
export function mergeWritingDocuments(base:DocumentNode,local:DocumentNode,remote:DocumentNode):DocumentNode|null {
 if(same(local,base)||same(local,remote))return remote;
 if(same(remote,base))return local;
 const left=revisionChanges(base,local),right=revisionChanges(base,remote);
 const overlap=(a:typeof left[number],b:typeof left[number])=>{
  const ae=a.index+a.before.length,be=b.index+b.before.length;
  if(!a.before.length&&!b.before.length)return a.index===b.index;
  if(!a.before.length)return a.index>=b.index&&a.index<be;
  if(!b.before.length)return b.index>=a.index&&b.index<ae;
  return a.index<be&&b.index<ae;
 };
 const unique=right.filter(r=>!left.some(l=>same(l,r)));
 if(left.some(l=>unique.some(r=>overlap(l,r))))return null;
 const content=[...(base.content||[])];
 for(const c of [...left,...unique].sort((a,b)=>b.index-a.index))content.splice(c.index,c.before.length,...c.after);
 return {...remote,content:content.length?content:[{type:'paragraph'}]};
}
