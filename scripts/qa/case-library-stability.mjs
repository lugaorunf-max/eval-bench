// Run with an existing CUA tab handle. This test never starts a browser or changes business records.
import assert from 'node:assert/strict';
const states=['可测试','待筛选','回收站'];
export async function verifyCaseLibraryStability(tab,{cycles=2,compareContentOrigin=true}={}){
 const capture=()=>tab.playwright.evaluate(({compareContentOrigin})=>{
  const selectors=['[data-case-slot="toolbar"]','[data-case-slot="search"]','[data-case-slot="actions"]','[data-case-slot="states"]','[data-case-slot="tools"]','[data-case-slot="content"]','[data-case-action="create"]','.context-toggle'];
  const rect=(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const anchors=Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);if(!e)throw Error('missing layout anchor '+s);const r=rect(e);if(s.endsWith('="content"]')){delete r.height;if(!compareContentOrigin)delete r.y;}return [s,r];}));
  document.querySelectorAll('[aria-label="案例状态"]>button:not(.lm-clear-event),.workspace-rail nav button,.ws-content-modules>button').forEach(e=>{anchors[e.getAttribute('aria-label')||e.textContent]=rect(e);});
  return {anchors,viewport:innerWidth,pageWidth:document.documentElement.scrollWidth};
 },{compareContentOrigin});
 const select=async label=>{const b=tab.playwright.getByRole('navigation',{name:'案例状态'}).getByRole('button',{name:label,exact:true});await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true');return capture();};
 const snapshots=[{state:'可测试',...await select('可测试')}];
 for(let n=0;n<cycles;n++)for(const state of ['待筛选','回收站','可测试'])snapshots.push({state,...await select(state)});
 const first=snapshots[0];
 for(const sample of snapshots){assert.ok(sample.pageWidth<=sample.viewport+1,'horizontal overflow');assert.deepEqual(Object.keys(sample.anchors),Object.keys(first.anchors));for(const [selector,r]of Object.entries(first.anchors))for(const [axis,value]of Object.entries(r))assert.ok(Math.abs(sample.anchors[selector][axis]-value)<=.5,`${sample.state}: ${selector} ${axis} drift ${sample.anchors[selector][axis]-value}px`);}
 return {cycles,states,compareContentOrigin,viewport:first.viewport,snapshots,maxAllowedDrift:.5,passed:true};
}
