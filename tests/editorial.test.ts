import {fixtureKnowledge,citedReply} from './fixtures/writing-knowledge';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createStore } from '../packages/core/db';
import { CasebenchService } from '../packages/core/service';
import { EditorialService, writingPrompt } from '../packages/core/editorial';
import { seedStore } from '../packages/core/seed';
import { UNKNOWN_USAGE, type LocalProfile } from '../packages/contracts';
import type { WritingArticle } from '../packages/contracts/editorial';

test('editorial references freeze selected evidence, preserve benchmark records and survive reopening',async()=>{
  const dir=await mkdtemp('/private/tmp/casebench-editorial-');let store=await createStore(dir);let articleId='';
  try{
    await seedStore(store);const service=new CasebenchService(store),e=new EditorialService(service);
    const before=await service.listCases();
    const file=await service.putFile(new TextEncoder().encode('recorded material'),'notes.txt','text/plain','reference');
    const instance=await e.addInstance({title:'Manual tutorial',task:'Make a page',output:'The real result',notes:'Reload did not keep score',fileIds:[file.id]});
    const article=await e.create({kind:'practice',references:[{kind:'instance',id:instance.id,parts:['output'],includeFiles:false}]});articleId=article.id;
    assert.equal(article.references[0].task,'');assert.equal(article.references[0].output,'The real result');assert.deepEqual(article.references[0].files,[]);assert.doesNotMatch(article.references[0].notes,/Reload/);
    await e.mutate<typeof instance>(instance.id,'instance',v=>({...v,output:'A new result'}));
    assert.equal((await e.article(article.id)).references[0].output,'The real result');
    const first=await e.patch(article.id,{revision:0,title:'My article'});assert.equal(first.revision,1);
    await assert.rejects(e.patch(article.id,{revision:0,title:'Stale edit'}),/已更新/);
    const patches=await Promise.allSettled([e.patch(article.id,{revision:1,pinned:true}),e.patch(article.id,{revision:1,template:'Other'})]);assert.equal(patches.filter(r=>r.status==='fulfilled').length,1);
    await assert.rejects(e.create({kind:'news',references:[{kind:'instance',id:'missing'}]}));
    await assert.rejects(e.addSource({title:'Bad URL',url:'javascript:alert(1)'}));
    assert.equal((await service.listCases()).length,before.length);assert.equal((await service.listRuns()).length,0);
    await store.close();store=await createStore(dir);const reopened=new EditorialService(new CasebenchService(store));assert.equal((await reopened.article(articleId)).title,'My article');assert.equal((await reopened.instances()).find(i=>i.id===instance.id)?.origin,'manual');
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('writing saves complete drafts, isolates concurrent sends, is idempotent, and recovers interrupted replies',async()=>{
  const dir=await mkdtemp('/private/tmp/casebench-writing-'),store=await createStore(dir);
  try{
    const profile:LocalProfile={id:'writer-api',name:'Writer API',vendor:'test',model:'writer-model',adapter:'api',color:'#242832',modes:['text'],supportsTemperature:false,baseUrl:'https://example.com',apiKeyEnv:'TEST_WRITER_KEY'};
    let calls=0,release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>fixtureKnowledge(),execute:async task=>{calls++;assert.match(task.case.prompt,/Write the whole article/);assert.match(task.case.prompt,/source fact/);await wait;return {text:citedReply('# Full draft\n\nFirst paragraph.\n\nLast paragraph.','reply'),usage:{...UNKNOWN_USAGE,inputTokens:100,outputTokens:40,source:'reported'},reportedModel:'writer-model',logs:''};}});
    const source=await e.addSource({title:'News',summary:'source fact'});const article=await e.create({title:'Chosen title',references:[{kind:'source',id:source.id}]});
    const payload={text:'Write the whole article',profileId:profile.id,model:profile.model,requestKey:randomUUID(),revision:0};
    const queued=await e.send(article.id,payload);assert.equal(queued.messages.length,2);assert.equal(queued.messages[1].status,'pending');
    assert.equal((await e.send(article.id,payload)).messages.length,2);
    await assert.rejects(e.send(article.id,{...payload,requestKey:randomUUID(),revision:queued.revision}),/正在生成/);
    await assert.rejects(e.patch(article.id,{revision:queued.revision,kind:'practice'}),/生成中/);
    release();let done=queued;for(let i=0;i<100&&done.messages[1].status==='pending';i++){await new Promise(r=>setTimeout(r,20));done=await e.article(article.id);}
    assert.equal(done.title,'Chosen title');assert.equal(calls,1);assert.equal(done.messages[1].status,'complete');assert.match(done.messages[1].text,/Last paragraph/);assert.equal(done.messages[1].usage?.outputTokens,40);assert.equal(done.messages[1].references?.[0].sourceId,source.id);
    const prompt=writingPrompt(done,'Continue');assert.match(prompt,/not|不/);assert.match(prompt,/Last paragraph/);
    const damaged=await e.mutate<WritingArticle>(article.id,'article',a=>({...a,messages:[...a.messages,{id:'orphan-message',role:'assistant',text:'',createdAt:new Date().toISOString(),status:'pending'}]}));
    const recovered=await e.article(damaged.id);assert.equal(recovered.messages.at(-1)?.status,'failed');assert.match(recovered.messages.at(-1)?.error||'',/重启/);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
