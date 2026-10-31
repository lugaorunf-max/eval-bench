import {fixtureKnowledge,citedReply} from './fixtures/writing-knowledge';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createStore } from '../packages/core/db';
import { CasebenchService } from '../packages/core/service';
import { EditorialService, writingPrompt } from '../packages/core/editorial';
import { WritingDocumentService, finishDocumentGeneration } from '../packages/core/writing-service';
import { documentText, markdownDocument, normalizeArticle, revisionChanges, validateDocument } from '../packages/core/writing-document';
import type { WritingArticle } from '../packages/contracts/editorial';
import { UNKNOWN_USAGE, type LocalProfile } from '../packages/contracts';

test('editable document persists, validates references, restores versions and rejects stale saves',async()=>{
  const dir=await mkdtemp('/private/tmp/casebench-document-'),store=await createStore(dir);
  try{
    const e=new EditorialService(new CasebenchService(store)),w=new WritingDocumentService(e),i=await e.addInstance({title:'Actual tutorial',task:'Draw',output:'It worked'});
    let a=await e.create({references:[{kind:'instance',id:i.id}]});
    const image=await e.s.putFile(new Uint8Array([1,2,3]),'actual.png','image/png','reference');
    a=await e.patch(a.id,{revision:a.revision,mediaIds:[image.id]});
    const doc=markdownDocument('# My article\n\nMy manual edits.');
    doc.content!.splice(1,0,{type:'writingReference',attrs:{referenceId:a.references[0].id}},{type:'writingMedia',attrs:{fileId:image.id,caption:'Actual screenshot'}});
    a=await w.save(a.id,{documentRevision:0,document:doc});
    assert.equal(a.documentRevision,1);assert.equal((await e.article(a.id)).document?.content?.[1].type,'writingReference');
    assert.equal((await w.save(a.id,{documentRevision:0,document:doc})).documentRevision,1);
    await assert.rejects(w.save(a.id,{documentRevision:0,document:markdownDocument('Different stale draft')}),/已在其他窗口/);
    const exported=documentText(a.document!,a.media);assert.match(exported,/Actual screenshot/);assert.doesNotMatch(exported,/Actual tutorial|It worked|引用资料/);
    assert.match(writingPrompt(a,'Revise with this material','revise'),/Actual screenshot/);
    await assert.rejects(w.save(a.id,{documentRevision:1,document:{type:'doc',content:[{type:'writingMedia',attrs:{fileId:'unrelated'}}]}}),/素材不存在/);
    assert.throws(()=>validateDocument({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]},a),/安全/);
    const edited=markdownDocument('A newer manual paragraph');a=await w.save(a.id,{documentRevision:1,document:edited,checkpoint:true});
    const prior=a.versions!.at(-1)!;a=await w.restore(a.id,{versionId:prior.id,documentRevision:2});assert.match(documentText(a.document!),/My manual edits/);assert.equal(a.documentRevision,3);
    assert.equal((await e.instances())[0].metrics?.inputTokens,null);assert.equal((await e.s.listRuns()).length,0);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('AI proposals support partial adoption, preserve embedded context and never overwrite concurrent edits',async()=>{
  const dir=await mkdtemp('/private/tmp/casebench-revision-'),store=await createStore(dir);
  try{
    const e=new EditorialService(new CasebenchService(store)),w=new WritingDocumentService(e);let a=await e.create({});
    a=await w.save(a.id,{documentRevision:0,document:markdownDocument('First paragraph.\n\nKeep this middle.\n\nLast paragraph.')});
    const base=normalizeArticle(a),finished=finishDocumentGeneration(a,base,'reply','Changed first.\n\nKeep this middle.\n\nChanged last.','revise');
    assert.equal(finished.proposal!.changes.length,2);assert.match(documentText(finished.document!),/First paragraph/);
    await e.mutate(a.id,'article',()=>finished);a=await w.proposal(a.id,{proposalId:finished.proposal!.id,action:'apply',documentRevision:1,changeIds:[finished.proposal!.changes[0].id]});
    assert.match(documentText(a.document!),/Changed first/);assert.match(documentText(a.document!),/Last paragraph/);assert.equal(a.proposal,null);
    const p=finishDocumentGeneration(a,normalizeArticle(a),'reply2','AI replacement.','revise');await e.mutate(a.id,'article',()=>p);a=await w.save(a.id,{documentRevision:2,document:markdownDocument('My newer changes must survive.')});
    await assert.rejects(w.proposal(a.id,{proposalId:p.proposal!.id,action:'apply',documentRevision:3,changeIds:p.proposal!.changes.map(c=>c.id)}),/新修改/);
    assert.match(documentText((await e.article(a.id)).document!),/must survive/);
    a=await w.proposal(a.id,{proposalId:p.proposal!.id,action:'discard',documentRevision:3,changeIds:[]});assert.equal(a.proposal,null);
    const reference=await e.addSource({title:'Source',summary:'True evidence'});a=await e.patch(a.id,{revision:a.revision,addReference:{kind:'source',id:reference.id}});
    const doc=markdownDocument('Intro.\n\nEnding.');doc.content!.splice(1,0,{type:'writingReference',attrs:{referenceId:a.references[0].id}});a=await w.save(a.id,{documentRevision:3,document:doc});
    const candidate=finishDocumentGeneration(a,normalizeArticle(a),'reply3','Rewritten intro.\n\nRewritten ending.','revise');assert.ok(candidate.proposal);const apply=await e.mutate(a.id,'article',()=>candidate);a=await w.proposal(a.id,{proposalId:apply.proposal!.id,action:'apply',documentRevision:4,changeIds:apply.proposal!.changes.map(c=>c.id)});assert.ok(a.document!.content!.some(n=>n.type==='writingReference'));
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('automatic generation preserves concurrent human edits as a proposal',async()=>{
  const dir=await mkdtemp('/private/tmp/casebench-draft-'),store=await createStore(dir);
  try{
    const profile:LocalProfile={id:'writer-api',name:'Writer',vendor:'test',model:'writer-model',adapter:'api',color:'#242832',modes:['text'],supportsTemperature:false};
    let release!:()=>void;const barrier=new Promise<void>(r=>release=r);
    const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>fixtureKnowledge(),execute:async task=>{assert.match(task.case.prompt,/My hand edited text/);await barrier;return {text:citedReply('AI revision.'),usage:UNKNOWN_USAGE,logs:'',reportedModel:profile.model};}}),w=new WritingDocumentService(e);
    let a=await e.create({});a=await w.save(a.id,{documentRevision:0,document:markdownDocument('My hand edited text')});
    a=await e.send(a.id,{purpose:'auto',text:'Improve',revision:a.revision,profileId:profile.id,model:profile.model,requestKey:randomUUID()});
    a=await w.save(a.id,{documentRevision:1,document:markdownDocument('Keep my simultaneous edit')});release();
    for(let n=0;n<100&&a.messages.at(-1)?.status==='pending';n++){await new Promise(r=>setTimeout(r,20));a=await e.article(a.id);}
    assert.equal(a.messages.at(-1)?.status,'complete');assert.match(documentText(a.document!),/simultaneous/);assert.equal(a.proposal!.baseRevision,1);assert.equal(a.documentRevision,2);
    const legacy={...a,document:undefined,documentRevision:undefined};assert.match(documentText(normalizeArticle(legacy).document!),/AI revision/);assert.doesNotMatch(documentText(normalizeArticle(legacy).document!),/本次知识库参考/);
    const empty=normalizeArticle(await e.create({}));const draft=finishDocumentGeneration(empty,empty,'draft','# Initial draft\n\nFull content.','draft');assert.equal(draft.proposal,null);assert.match(documentText(draft.document!),/Full content/);
    assert.equal(revisionChanges(markdownDocument('Same'),markdownDocument('Same')).length,0);
  }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
