import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createStore} from '../packages/core/db';
import {CasebenchService,now} from '../packages/core/service';
import {EditorialService,writingPrompt} from '../packages/core/editorial';
import {MediaWorkflowService} from '../packages/core/media-workflow';
import {DiscoveryService} from '../packages/core/discovery';
import {matchesLibraryCase} from '../packages/core/library-taxonomy';
import {writingEditorialPolicy} from '../packages/core/writing-editorial-policy';
import type {DiscoveryJob} from '../packages/contracts/content-workspace';
async function fixture(){const dir=await mkdtemp('/private/tmp/polish-'),store=await createStore(dir,':memory:'),s=new CasebenchService(store),e=new EditorialService(s);return {s,e,close:async()=>{await store.close();await rm(dir,{recursive:true,force:true});}};}
test('multiple task and artifact tags survive saving, match secondary filters and freeze in historical versions',async()=>{
 const t=await fixture();try{const entry=await t.s.saveCase({title:'水力模拟',prompt:'用网页模拟水箱并绘制随时间变化的图表。',scene:'dataviz',scenes:['dataviz','code'],artifactType:'web',artifactTypes:['web','image'],capabilities:['coding','reason'],executionMode:'html'});assert.deepEqual(entry.scenes,['dataviz','code']);assert.deepEqual(entry.artifactTypes,['web','image']);assert.equal(matchesLibraryCase(entry,{scenes:['landing'],artifacts:['image'],capabilities:['reason'],favorites:false,query:''}),true);await t.s.saveCase({...entry,scene:'code',scenes:['code'],artifactTypes:['web'],expectedVersion:entry.version},entry.id);assert.deepEqual(entry.scenes,['dataviz','code']);assert.deepEqual(entry.artifactTypes,['web','image']);assert.deepEqual((await t.s.listCases())[0].scenes,['code']);}finally{await t.close();}
});
test('classification is a preview and does not execute or publish a new case version',async()=>{
 const t=await fixture();try{const entry=await t.s.saveCase({title:'水力交互',prompt:'实现阀门调节和水位计算，用图表展示。',scene:'code',artifactType:'web',capabilities:['coding'],executionMode:'html'});
 class Preview extends MediaWorkflowService{override async runAgent(...args:Parameters<MediaWorkflowService['runAgent']>){assert.match(args[2],/不执行案例/);assert.match(args[2],/阀门调节/);return JSON.stringify({scenes:['dataviz','code'],artifactTypes:['web'],capabilities:['coding','reason'],evidence:'提示词要求水位计算与图表。'});}}
 const suggestion=await new Preview(t.e).suggestTaxonomy(entry.id,{profileId:'fixture',model:'fixture'});assert.deepEqual(suggestion.capabilities,['coding','reason']);assert.equal((await t.s.listCases())[0].version,entry.version);assert.deepEqual((await t.s.listCases())[0].capabilities,['coding']);}finally{await t.close();}
});
test('hiding a discovery preserves saved sources and restoring does not restart or delete it',async()=>{
 const t=await fixture();try{const at=now(),job:DiscoveryJob={id:'discovery_fixture',kind:'case',articleId:'',request:'寻找水力网页',profileId:'fixture',model:'fixture',limit:5,status:'complete',phase:'搜集完成',sourceIds:['origin_existing'],queries:['water'],notes:'已找到',createdAt:at,updatedAt:at,requestKey:'fixture',resumeCount:0,messages:[{role:'user',text:'寻找水力网页',at},{role:'assistant',text:'已找到',at}]};await t.e.insert('discovery-job',job);const d=new DiscoveryService(t.e);await d.dismiss(job.id,true);let saved=await t.e.get<DiscoveryJob>(job.id,'discovery-job');assert.ok(saved.dismissedAt);assert.deepEqual(saved.sourceIds,job.sourceIds);assert.deepEqual(saved.messages,job.messages);await d.dismiss(job.id,false);saved=await t.e.get(job.id,'discovery-job');assert.equal(saved.dismissedAt,null);assert.equal(saved.status,'complete');}finally{await t.close();}
});
test('short paragraphs are requested at generation time through the shared writing prompt',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'资讯稿'});assert.match(writingEditorialPolicy,/生成 markdown 时直接采用公众号式短段落/);assert.match(writingPrompt(a,'写初稿','auto')+writingEditorialPolicy,/一句一个自然段/);assert.match(writingEditorialPolicy,/标题、列表、引用、图注和代码块/);}finally{await t.close();}
});
