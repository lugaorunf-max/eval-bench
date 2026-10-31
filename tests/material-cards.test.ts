import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {EditorialService} from '../packages/core/editorial';
import {ContentLibrary} from '../packages/core/content-library';
import {ArticleAssociations} from '../packages/core/article-associations';
import {MediaPreparationService} from '../packages/core/media-preparation';
import {materialCatalog} from '../packages/core/material-cards';
import {WritingDocumentService} from '../packages/core/writing-service';
import type {EditorialInstance} from '../packages/contracts/editorial';
import {taskPrompt,executionTask} from '../scripts/task-prompt.mjs';
import {executeAdapter} from '../packages/adapters';
const fixture=async()=>{const directory=await mkdtemp('/private/tmp/material-cards-'),store=await createStore(directory,':memory:'),s=new CasebenchService(store),e=new EditorialService(s);return {directory,store,s,e,lib:new ContentLibrary(e),assoc:new ArticleAssociations(e),prep:new MediaPreparationService(e),close:async()=>{await store.close();await rm(directory,{recursive:true,force:true});}};};
test('test definitions keep reference/prompt; one execution card is reused across the article, media library and history',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),b=await t.e.create({title:'B'}),image=await t.s.putFile(Buffer.from('reference'),'ref.png','image/png','reference'),src=await t.lib.source({url:'https://x.com/a/status/100',title:'原帖'}),candidate=await t.lib.candidate({url:src.url,title:'方块',mediaIds:[image.id],articleId:a.id}),entry=await t.lib.promote(candidate.id,{prompt:'创建方块'});await t.lib.link('media',image.id,{sourceId:src.id,articleId:a.id});
 const file=await t.s.putFile(Buffer.from('actual'),'shot.png','image/png','reference'),instance=await t.e.addInstance({title:'实际结果',task:entry.prompt,output:'结果',agent:'GPT',model:'test-model',fileIds:[file.id],articleId:a.id});await t.e.mutate<EditorialInstance>(instance.id,'instance',i=>({...i,caseId:entry.id}));
 let publicData=await materialCatalog(t.e),articleData=await materialCatalog(t.e,a.id),definition=publicData.cards.find(c=>c.id===entry.id)!,card=articleData.cards.find(c=>c.id===instance.id)!;
 assert.equal(definition.variant,'reference');assert.equal(definition.sections.length,1);assert.equal(definition.sections[0].files[0].file.id,image.id);assert.equal(definition.prompt,entry.prompt);assert.equal(definition.sections.some(s=>s.files.some(f=>f.file.id===file.id)),false);
 assert.equal(card.kind,'case');assert.equal(card.variant,'execution');assert.equal(card.cover?.id,file.id);assert.equal(card.sections[0].files[0].file.id,file.id);assert.equal(card.sections[0].agent,'GPT');assert.equal(card.sections[0].model,'test-model');assert.deepEqual(card.items,[{kind:'instance',id:instance.id}]);assert.deepEqual(card,publicData.cards.find(c=>c.id===instance.id));assert.equal(articleData.cards.some(c=>c.id===entry.id),false);assert.equal(publicData.cards.some(c=>c.kind==='material'&&c.sections.some(s=>s.files.some(f=>f.file.id===file.id))),false);
 await t.assoc.change({items:card.items,addArticleIds:[b.id]});assert.equal((await materialCatalog(t.e,b.id)).cards.find(c=>c.variant==='execution')?.id,instance.id);assert.ok((await t.lib.readMedia()).find(m=>m.id===file.id)!.meta.articleIds.includes(b.id));
 await t.lib.patch('instance',instance.id,{title:'统一的结果卡名',summary:'简短说明',coverFileId:file.id});publicData=await materialCatalog(t.e);articleData=await materialCatalog(t.e,b.id);assert.deepEqual(articleData.cards.find(c=>c.id===instance.id),publicData.cards.find(c=>c.id===instance.id));assert.equal(articleData.cards.find(c=>c.id===instance.id)!.title,'统一的结果卡名');
 await t.lib.patch('media',file.id,{title:'统一素材名称'});assert.equal((await materialCatalog(t.e,a.id)).cards.find(c=>c.id===instance.id)!.sections[0].files[0].title,'统一素材名称');
 await t.lib.patch('media',file.id,{trash:true});assert.equal((await materialCatalog(t.e,a.id)).cards.find(c=>c.id===instance.id)!.sections[0].files.length,0);assert.ok((await t.s.fileBytes(file.id)).length);await t.lib.patch('media',file.id,{trash:false});assert.equal((await materialCatalog(t.e,a.id)).cards.find(c=>c.id===instance.id)!.sections[0].files.length,1);
 await t.assoc.change({items:card.items,removeArticleIds:[b.id]});assert.equal((await materialCatalog(t.e,b.id)).cards.some(c=>c.id===instance.id),false);assert.equal((await materialCatalog(t.e,a.id)).cards.some(c=>c.id===instance.id),true);assert.equal((await t.e.instances()).find(i=>i.id===instance.id)!.output,'结果');
 }finally{await t.close();}
});
test('different Agents executing one prompt stay independent and never inherit the reference as a fake result cover',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),f=await t.s.putFile(Buffer.from('ref'),'reference.png','image/png','reference'),candidate=await t.lib.promptCandidate({title:'方块',prompt:'创建方块',mediaIds:[f.id]}),entry=await t.lib.promote(candidate.id,{prompt:'创建方块'}),one=await t.e.addInstance({title:'方块',task:entry.prompt,output:'A',agent:'A',model:'A1',fileIds:[],articleId:a.id}),two=await t.e.addInstance({title:'方块',task:entry.prompt,output:'B',agent:'B',model:'B1',fileIds:[]});for(const i of [one,two])await t.e.mutate<EditorialInstance>(i.id,'instance',v=>({...v,caseId:entry.id}));
 const data=await materialCatalog(t.e),results=data.cards.filter(c=>c.variant==='execution');assert.equal(results.length,2);assert.equal(results.find(c=>c.id===one.id)!.cover,undefined);assert.equal(results.find(c=>c.id===two.id)!.agent,'B');assert.equal((await materialCatalog(t.e,a.id)).cards.filter(c=>c.variant==='execution').length,1);
 }finally{await t.close();}
});
test('real GIF processing inherits exact source and articles, shows alongside original, can be deleted alone and restored, protects embedded media',async()=>{
 const t=await fixture();try{const file=path.join(t.directory,'actual.mp4');await new Promise<void>((resolve,reject)=>{const p=spawn(ffmpeg!,['-f','lavfi','-i','testsrc=size=320x240:rate=10','-t','1','-pix_fmt','yuv420p','-y',file],{stdio:'ignore'});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error('fixture encoding failed')));});
 const video=await t.s.putFile(await readFile(file),'original.mp4','video/mp4','reference'),a=await t.e.create({title:'本篇'}),instance=await t.e.addInstance({title:'实测',task:'方块',output:'已生成',fileIds:[],articleId:a.id});await t.prep.attach({fileId:video.id,instanceId:instance.id,origin:'recorded'});const src=await t.lib.source({url:'https://x.com/a/status/101'});await t.lib.link('media',video.id,{sourceId:src.id});
 const clip=await t.prep.process({fileId:video.id,format:'gif',start:0,end:.7,width:320,fps:8,crop:{x:10,y:10,width:80,height:80}});assert.notEqual(clip.file.id,video.id);assert.equal(clip.parentFileId,video.id);assert.equal(clip.instanceId,instance.id);assert.deepEqual(clip.articleIds,[a.id]);assert.ok((await t.s.fileBytes(clip.file.id)).length);assert.deepEqual((await t.lib.meta('media',clip.file.id)).sourceIds,[src.id]);let data=await materialCatalog(t.e,a.id);assert.equal(data.cards[0].sections[0].files.length,2);assert.equal(data.tiles.find(t=>t.file.id===clip.file.id)!.parentFileId,video.id);
 await t.lib.patch('media',clip.file.id,{trash:true});data=await materialCatalog(t.e,a.id);assert.equal(data.cards[0].sections[0].files.length,1);assert.ok((await t.e.instances()).find(i=>i.id===instance.id)!.media!.some(m=>m.file.id===clip.file.id));await t.lib.patch('media',clip.file.id,{trash:false});assert.equal((await materialCatalog(t.e,a.id)).cards[0].sections[0].files.length,2);
 const article=await t.e.article(a.id);await t.e.mutate(a.id,'article',()=>({...article,media:[clip.file]}));await new WritingDocumentService(t.e).save(a.id,{documentRevision:0,document:{type:'doc',content:[{type:'writingMedia',attrs:{fileId:clip.file.id,caption:'GIF'}},{type:'paragraph'}]}});await assert.rejects(t.lib.patch('media',clip.file.id,{trash:true}),/正文中使用/);assert.equal((await t.lib.meta('media',clip.file.id)).trashedAt,null);
 const mp4=await t.prep.process({fileId:video.id,format:'mp4',start:0,end:.5,width:320,fps:5});assert.equal(mp4.file.mime,'video/mp4');assert.equal((await t.s.file(video.id)).id,video.id);
 }finally{await t.close();}
});
test('confirmed benchmark prompt is verbatim in API and custom-command payloads; internal editorial protocols remain isolated',async()=>{
 const t=await fixture();try{const confirmed='制作一个方块。\n保留原文。',entry={id:'case_fixture',prompt:confirmed,instructions:'不该发送的额外要求',scene:'code',executionMode:'text',artifactType:'copy',inputs:[]},signal=new AbortController().signal;
 assert.equal(taskPrompt({case:entry}),confirmed);assert.equal(executionTask({case:entry}).case.instructions,'');assert.equal(entry.instructions,'不该发送的额外要求');assert.match(taskPrompt({case:{...entry,id:'writing'}}),/不该发送/);
 const dir=path.join(t.directory,'command'),out=path.join(dir,'out');await mkdir(out,{recursive:true});const script=path.join(t.directory,'executor.mjs');await writeFile(script,`import fs from 'node:fs';const task=JSON.parse(fs.readFileSync(process.env.CASEBENCH_TASK_FILE,'utf8'));const prompt=fs.readFileSync(task.promptFile,'utf8');fs.writeFileSync(task.outputDirectory+'/response.txt',JSON.stringify({prompt,instructions:task.case.instructions}));`);
 const profile:any={id:'fixture',adapter:'command',program:process.execPath,args:[script],model:'fixture',modes:['text']};await executeAdapter({case:entry as any,profile,model:profile,directory:dir,outputDirectory:out,inputPaths:[],signal});assert.deepEqual(JSON.parse(await readFile(path.join(out,'response.txt'),'utf8')),{prompt:confirmed,instructions:''});
 const originalFetch=globalThis.fetch;let sent:any;globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:'实际输出'}}]}),{status:200,headers:{'Content-Type':'application/json'}});};const before=process.env.MATERIAL_FIXTURE_KEY;process.env.MATERIAL_FIXTURE_KEY='test';try{await executeAdapter({case:entry as any,profile:{...profile,adapter:'api',baseUrl:'http://127.0.0.1/v1',apiKeyEnv:'MATERIAL_FIXTURE_KEY'},model:profile,directory:dir,outputDirectory:out,inputPaths:[],signal});assert.equal(sent.messages[0].content,confirmed);}finally{globalThis.fetch=originalFetch;if(before===undefined)delete process.env.MATERIAL_FIXTURE_KEY;else process.env.MATERIAL_FIXTURE_KEY=before;}
 }finally{await t.close();}
});

test('legacy source article tags remain visible on the same case, while explicit removal only affects that article',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),b=await t.e.create({title:'B'}),source=await t.lib.source({url:'https://x.com/a/status/555'}),c=await t.lib.candidate({url:source.url,title:'关联案例'}),entry=await t.lib.promote(c.id,{prompt:'原提示词'});const {ContentWorkspace}=await import('../packages/core/content-workspace'),w=new ContentWorkspace(t.e);await w.link(a.id,'source',source.id);await w.link(b.id,'source',source.id);
 const card=(await materialCatalog(t.e)).cards.find(c=>c.id===entry.id)!;assert.deepEqual(new Set(card.articleIds),new Set([a.id,b.id]));assert.equal((await materialCatalog(t.e,b.id)).cards[0].id,entry.id);
 await t.assoc.change({items:[{kind:'case',id:entry.id}],removeArticleIds:[b.id]});assert.deepEqual((await materialCatalog(t.e)).cards.find(c=>c.id===entry.id)!.articleIds,[a.id]);assert.equal((await materialCatalog(t.e,b.id)).cards.length,0);
 }finally{await t.close();}
});
test('article associations authorize media tools without the removed selection button, and unrelated or removed files stay out',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),own=await t.s.putFile(Buffer.from('own'),'own.png','image/png','reference'),other=await t.s.putFile(Buffer.from('other'),'private.png','image/png','reference');await t.assoc.change({items:[{kind:'media',id:own.id}],addArticleIds:[a.id]});
 const {MediaWorkflowService}=await import('../packages/core/media-workflow'),{mediaToolRequest}=await import('../packages/core/media-tool-session');const session=await new MediaWorkflowService(t.e,'http://127.0.0.1:43110').articleSession(a.id,t.directory,new AbortController().signal);
 try{const config=JSON.parse(await readFile(session.file,'utf8')),result=await mediaToolRequest({...config,method:'call',name:'list_article_media',arguments:{}});assert.match(JSON.stringify(result),new RegExp(own.id));assert.doesNotMatch(JSON.stringify(result),new RegExp(other.id));await t.assoc.change({items:[{kind:'media',id:own.id}],removeArticleIds:[a.id]});const removed=await mediaToolRequest({...config,method:'call',name:'list_article_media',arguments:{}});assert.doesNotMatch(JSON.stringify(removed),new RegExp(own.id));}finally{session.close();}
 }finally{await t.close();}
});
test('new screenshots and clips inherit an explicitly associated execution article without requiring a selected reference',async()=>{
 const t=await fixture();try{const a=await t.e.create({title:'A'}),instance=await t.e.addInstance({title:'执行',task:'原提示词',output:'实际结果',fileIds:[]}),image=await t.s.putFile(Buffer.from('capture'),'capture.png','image/png','reference');await t.assoc.change({items:[{kind:'instance',id:instance.id}],addArticleIds:[a.id]});await t.prep.attach({instanceId:instance.id,fileId:image.id});assert.deepEqual((await t.lib.meta('media',image.id)).articleIds,[a.id]);assert.equal((await materialCatalog(t.e,a.id)).tiles.find(t=>t.file.id===image.id)!.instanceId,instance.id);
 }finally{await t.close();}
});

test('HTML is extracted from a normal explanatory reply without adding delivery instructions or changing the raw reply',async()=>{
 const {extractNativeHtml,saveNativeHtml}=await import('../scripts/native-html.mjs'),html='<!doctype html><html><body><button>实际产物</button></body></html>',reply='这是生成的网页：\n\n```html\n'+html+'\n```\n\n说明留在对话中。';assert.equal(extractNativeHtml(reply),html);assert.throws(()=>extractNativeHtml('只有解释，或 <div>片段</div>'),/完整 HTML/);assert.throws(()=>extractNativeHtml('```html\n'+html+'\n```\n```html\n'+html.replace('实际产物','另一份')+'\n```'),/唯一/);
 const dir=await mkdtemp('/private/tmp/material-html-');try{await saveNativeHtml({case:{executionMode:'html'},outputDirectory:dir},reply);assert.equal(await readFile(path.join(dir,'index.html'),'utf8'),html);assert.match(reply,/说明留在对话/);}finally{await rm(dir,{recursive:true,force:true});}
});
