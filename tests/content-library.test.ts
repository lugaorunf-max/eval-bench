import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {EditorialService} from '../packages/core/editorial';
import {ContentLibrary,canonicalSource} from '../packages/core/content-library';
import {ArticleMaterialsService} from '../packages/core/article-materials';
import {WritingDocumentService} from '../packages/core/writing-service';
import {MediaPreparationService} from '../packages/core/media-preparation';
import type {PreparedMedia} from '../packages/contracts/editorial';
import {newId,now} from '../packages/core/service';
const setup=async()=>{const directory=await mkdtemp('/private/tmp/content-library-'),store=await createStore(directory,':memory:'),s=new CasebenchService(store),e=new EditorialService(s),library=new ContentLibrary(e);return {directory,store,s,e,library,close:async()=>{await store.close();await rm(directory,{recursive:true,force:true});}};};

test('same post has one source and candidate, files are reused, article selections stay independent',async()=>{
 const t=await setup();try{const {s,e,library}=t,a=await e.create({title:'文章 A'}),b=await e.create({title:'文章 B'}),f=await s.putFile(Buffer.from('shared photo'),'photo.png','image/png','reference'),again=await s.putFile(Buffer.from('shared photo'),'renamed.png','image/png','reference');assert.equal(f.id,again.id);
 const c=await library.candidate({url:'https://x.com/a/status/123?s=20',title:'宝塔',articleId:a.id,mediaIds:[f.id]}),same=await library.candidate({url:'https://twitter.com/b/status/123?utm_source=x',title:'同一宝塔',articleId:b.id});assert.equal(c.id,same.id);assert.equal((await e.list('library-source')).length,1);assert.equal((await library.candidates()).length,1);
 const materials=new ArticleMaterialsService(e);await materials.media(a.id,{fileIds:[f.id]});await materials.media(b.id,{fileIds:[f.id]});assert.equal((await library.uses('media',f.id)).length,2);await library.detachMedia(a.id,f.id);assert.equal((await e.article(a.id)).media.length,0);assert.equal((await e.article(b.id)).media[0].id,f.id);assert.equal((await library.uses('media',f.id)).filter(u=>u.reference).length,1);
 assert.equal(canonicalSource('https://x.com/person/status/123/photo/1'),'https://x.com/i/status/123');assert.throws(()=>canonicalSource('javascript:alert(1)'));
 }finally{await t.close();}
});

test('trash hides new choices, preserves article media and historical versions, and prevents destructive purge',async()=>{
 const t=await setup();try{const {s,e,library}=t,f=await s.putFile(Buffer.from('protected photo'),'photo.png','image/png','reference'),a=await e.create({title:'引用中的文章'}),materials=new ArticleMaterialsService(e),docs=new WritingDocumentService(e);await materials.media(a.id,{fileIds:[f.id]});const updated=await docs.save(a.id,{documentRevision:0,document:{type:'doc',content:[{type:'writingMedia',attrs:{fileId:f.id,caption:'图'}},{type:'paragraph'}]}});
 await assert.rejects(library.patch('media',f.id,{trash:true}),/正文中使用/);assert.equal((await library.media()).find(m=>m.id===f.id)?.meta.trashedAt,null);assert.ok((await s.fileBytes(f.id)).length);assert.equal((await library.dependencies('media',f.id)).canPurge,false);await assert.rejects(library.purge('media',f.id),/先移入回收站/);
 await docs.save(a.id,{documentRevision:updated.documentRevision,checkpoint:true,document:{type:'doc',content:[{type:'paragraph'}]}});await library.detachMedia(a.id,f.id);await library.patch('media',f.id,{trash:true});assert.ok((await library.dependencies('media',f.id)).reasons.some(r=>r.includes('历史')));await assert.rejects(library.purge('media',f.id),/仍被使用/);
 const b=await e.create({title:'另一篇'});await assert.rejects(materials.media(b.id,{fileIds:[f.id]}),/回收站/);await library.patch('media',f.id,{trash:false});await materials.media(b.id,{fileIds:[f.id]});assert.equal((await e.article(b.id)).media.length,1);
 const unused=await s.putFile(Buffer.from('unused photo'),'unused.png','image/png','reference');await library.patch('media',unused.id,{trash:true});assert.equal((await library.dependencies('media',unused.id)).canPurge,true);await library.purge('media',unused.id);await assert.rejects(s.file(unused.id),/文件不存在/);await assert.rejects(access(s.filePath(unused.id)));
 }finally{await t.close();}
});

test('candidate promotion is idempotent, cases have frozen article references, deletion preserves snapshots',async()=>{
 const t=await setup();try{const {e,s,library}=t,c=await library.candidate({url:'https://x.com/a/status/456',title:'网页案例'}),entry=await library.promote(c.id,{prompt:'做一个有按钮的网页',artifactType:'web'}),again=await library.promote(c.id,{prompt:'重试不应新增',artifactType:'web'});assert.equal(entry.id,again.id);assert.equal((await s.listCases()).length,1);
 const a=await e.create({title:'文章'}),materials=new ArticleMaterialsService(e);await materials.references(a.id,{revision:a.revision,add:[{kind:'case',id:entry.id}]});const frozen=(await e.article(a.id)).references[0];assert.equal(frozen.task,'做一个有按钮的网页');await s.saveCase({title:entry.title,prompt:'新版本提示词',scene:entry.scene,capabilities:entry.capabilities,artifactType:entry.artifactType,executionMode:entry.executionMode,instructions:entry.instructions,inputIds:[],referenceId:null,expectedVersion:entry.version},entry.id);assert.equal((await e.article(a.id)).references[0].task,frozen.task);
 await library.patch('case',entry.id,{trash:true});assert.equal((await s.listCases()).length,0);assert.equal((await s.listCases(true)).length,1);await assert.rejects(library.purge('case',entry.id),/仍被使用/);await library.patch('case',entry.id,{trash:false,title:'新名称'});assert.equal((await s.listCases())[0].title,'新名称');
 const other=await library.candidate({url:'https://x.com/b/status/789',title:'另一条来源'});const linked=await library.promote(other.id,{targetCaseId:entry.id});assert.equal(linked.id,entry.id);assert.equal((await s.listCases()).length,1);assert.equal((await library.meta('case',entry.id)).sourceIds.length,2);
 }finally{await t.close();}
});

test('reconciliation preserves prose, groups derived files by source, collections do not own assets',async()=>{
 const t=await setup();try{const {e,s,library}=t,raw=await s.putFile(Buffer.from('raw'),'video.mp4','video/mp4','reference'),gif=await s.putFile(Buffer.from('gif'),'clip.gif','image/gif','reference'),a=await e.create({title:'旧文章'});await new ArticleMaterialsService(e).media(a.id,{fileIds:[gif.id]});await e.insert<PreparedMedia>('prepared-media',{id:newId('media'),file:raw,instanceId:null,parentFileId:null,origin:'downloaded',source:{kind:'x',id:'source-1',url:'https://x.com/a/status/321',title:'原帖'},caption:'原视频',createdAt:now()});await e.insert<PreparedMedia>('prepared-media',{id:newId('media'),file:gif,instanceId:null,parentFileId:raw.id,origin:'processed',caption:'动图',createdAt:now()});const before=await e.article(a.id);await library.reconcile();await library.reconcile();const after=await e.article(a.id);assert.deepEqual(after,before);assert.deepEqual((await library.meta('media',gif.id)).sourceIds,(await library.meta('media',raw.id)).sourceIds);assert.equal((await e.list('library-source')).length,1);
 const collection=await library.collection({title:'网页效果'});await library.patch('media',gif.id,{collectionIds:[collection.id],tags:['网页','网页']});assert.deepEqual((await library.meta('media',gif.id)).tags,['网页']);await library.updateCollection(collection.id,{remove:true});assert.deepEqual((await library.meta('media',gif.id)).collectionIds,[]);assert.ok(await s.file(gif.id));
 }finally{await t.close();}
});

test('collecting a case saves article candidates without silently selecting writing context',async()=>{
 const t=await setup();try{const {MediaWorkflowService}=await import('../packages/core/media-workflow'),a=await t.e.create({title:'定向文章'}),workflow=new MediaWorkflowService(t.e);const result=await workflow.collect({url:'https://x.com/a/status/888',title:'收集案例',summary:'外部演示，尚未实测',intent:'case',articleId:a.id}) as any;assert.ok(result.candidate.id);const article=await t.e.article(a.id);assert.equal(article.references.length,0);assert.ok((await t.library.meta('candidate',result.candidate.id)).articleIds.includes(a.id));await workflow.collect({url:'https://x.com/a/status/888',title:'重复收集',intent:'case',articleId:a.id});assert.equal((await t.e.article(a.id)).references.length,0);assert.equal((await t.library.candidates()).length,1);
 }finally{await t.close();}
});

test('analysis and manual confirmation share the same locked promotion, preserving provenance and context',async()=>{
 const t=await setup();try{const {MediaWorkflowService}=await import('../packages/core/media-workflow'),{library,e,s}=t,c=await library.candidate({url:'https://x.com/a/status/990',title:'同一条案例',eventId:'event_test'}),draftId=newId('casedraft');await e.insert('case-prompt-draft',{id:draftId,createdAt:now(),leadId:c.id,url:c.url,title:c.title,sourceText:'原文',author:'作者',files:[],originalPrompt:'',reconstructedPrompt:'生成一个网页',evidence:'仅有原文',unknowns:[],scene:'code',artifactType:'web',matches:[]});
 const [manual,analyzed]=await Promise.all([library.promote(c.id,{prompt:'人工确认的提示词'}),new MediaWorkflowService(e).saveDraft(draftId,{title:'整理的案例',prompt:'根据原文整理',promptKind:'reconstructed',scene:'code',artifactType:'web'})]);assert.equal(manual.id,analyzed!.id);assert.equal((await s.listCases()).length,1);assert.deepEqual((await library.meta('case',manual.id)).eventIds,['event_test']);assert.equal((await e.get<any>(draftId,'case-prompt-draft')).savedCaseId,manual.id);
 await library.patch('case',manual.id,{trash:true});await library.purge('case',manual.id);assert.equal((await library.candidates())[0].savedCaseId,null);const recreated=await library.promote(c.id,{prompt:'重新确认'});assert.notEqual(recreated.id,manual.id);assert.equal((await s.listCases()).length,1);
 }finally{await t.close();}
});

test('unpublished candidate visuals and removed article reference snapshots stay protected',async()=>{
 const t=await setup();try{const f=await t.s.putFile(Buffer.from('case visual'),'effect.png','image/png','reference');await t.library.candidate({url:'https://x.com/a/status/991',title:'待确认效果',mediaIds:[f.id]});await t.library.patch('media',f.id,{trash:true});assert.ok((await t.library.dependencies('media',f.id)).reasons.includes('备选案例的效果素材'));await assert.rejects(t.e.snapshot({kind:'media',id:f.id}),/回收站/);await assert.rejects(t.library.purge('media',f.id),/仍被使用/);
 const f2=await t.s.putFile(Buffer.from('reference visual'),'reference.png','image/png','reference'),a=await t.e.create({title:'保留历史引用',references:[{kind:'media',id:f2.id}]});await new ArticleMaterialsService(t.e).references(a.id,{revision:a.revision,remove:[a.references[0].id]});await t.library.patch('media',f2.id,{trash:true});assert.ok((await t.library.dependencies('media',f2.id)).reasons.some(r=>r.includes('历史')));
 }finally{await t.close();}
});
