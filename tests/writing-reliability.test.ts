import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';
import{interpretWritingReply,repairWritingJson}from'../packages/core/writing-reply';
import{validateKnowledgeCitations}from'../packages/core/writing-citations';
import{fixtureCitation,fixtureKnowledge,knowledgeArticle,citedReply}from'./fixtures/writing-knowledge';
import{markdownDocument,documentText}from'../packages/core/writing-document';
import{mergeWritingDocuments}from'../packages/core/writing-sync';
import{createStore}from'../packages/core/db';
import{CasebenchService}from'../packages/core/service';
import{EditorialService}from'../packages/core/editorial';
import{WritingDocumentService}from'../packages/core/writing-service';
import{isPublicAddress,publicImageUrl,importWritingImages,pageImageCandidates}from'../packages/core/writing-web-media';
import{UNKNOWN_USAGE,type LocalProfile}from'../packages/contracts';

test('Chinese JSON separators do not discard valid evidence or change punctuation inside prose',()=>{
 const raw=JSON.stringify({action:'edit',reply:'说明，保持：原样。',markdown:'# 标题\\n\\n正文，保持原样。',knowledgeCitations:[fixtureCitation]}).replace(',"markdown"','，"markdown"').replace(',"knowledgeCitations"','，"knowledgeCitations"');
 const reply=interpretWritingReply(raw);assert.equal(reply.note,'说明，保持：原样。');assert.equal(reply.text,'# 标题\n\n正文，保持原样。');assert.equal(validateKnowledgeCitations(reply.citations,[knowledgeArticle]).length,1);
 assert.equal(interpretWritingReply('我先查资料。\n```json\n'+raw+'\n```').purpose,'revise');
 assert.equal(repairWritingJson('{"reply":"他说\\\"你好，世界\\\""，"action":"reply"}'),'{"reply":"他说\\\"你好，世界\\\"","action":"reply"}');
 assert.throws(()=>interpretWritingReply('{"action":"edit",broken'),/写作格式异常/);
 assert.throws(()=>validateKnowledgeCitations(interpretWritingReply('{"action":"edit","markdown":"正文"}').citations,[knowledgeArticle]),/知识库引用/);
});

test('stale empty editors, independent paragraph edits and identical edits merge without a reload',()=>{
 const base=markdownDocument('开头\n\n结尾'),local=markdownDocument('我的开头\n\n结尾'),remote=markdownDocument('开头\n\nAI结尾');
 assert.equal(documentText(mergeWritingDocuments(base,local,remote)!),'我的开头\n\nAI结尾');
 assert.deepEqual(mergeWritingDocuments(base,base,remote),remote);
 assert.deepEqual(mergeWritingDocuments(base,local,local),local);
 assert.equal(mergeWritingDocuments(base,local,markdownDocument('其他开头\n\n结尾')),null);
});

test('overlapping local edits can be checkpointed without overwriting the latest draft',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-sync-'),store=await createStore(dir);
 try{const e=new EditorialService(new CasebenchService(store)),w=new WritingDocumentService(e);let a=await e.create({});a=await w.save(a.id,{documentRevision:0,document:markdownDocument('开头\n\n结尾')});const base=a.document!;
 a=await w.save(a.id,{documentRevision:1,document:markdownDocument('开头\n\nAI结尾')});
 a=await w.save(a.id,{documentRevision:1,baseDocument:base,document:markdownDocument('我的开头\n\n结尾')});assert.equal(documentText(a.document!),'我的开头\n\nAI结尾');assert.equal(a.documentRevision,3);
 await assert.rejects(w.save(a.id,{documentRevision:1,baseDocument:base,document:markdownDocument('另一开头\n\n结尾')}),/重叠修改/);
 a=await w.save(a.id,{documentRevision:1,keepConflictVersion:true,document:markdownDocument('另一开头\n\n结尾')});assert.equal(documentText(a.document!),'我的开头\n\nAI结尾');assert.equal(a.versions?.at(-1)?.label,'未合并的本地修改');assert.equal(documentText(a.versions!.at(-1)!.document),'另一开头\n\n结尾');
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('web image import blocks local networks, saves real files and ignores code examples',async()=>{
 for(const host of ['127.0.0.1','10.1.2.3','192.168.1.1','169.254.169.254','100.64.1.2','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(isPublicAddress(host),false,host);
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.throws(()=>publicImageUrl('http://127.0.0.1/image.png'));assert.throws(()=>publicImageUrl('file:///etc/passwd'));assert.throws(()=>publicImageUrl('https://name:secret@example.com/image.png'));
 const dir=await mkdtemp('/private/tmp/writing-images-'),store=await createStore(dir),s=new CasebenchService(store);let downloads=0;
 try{const body='# 图文\n\n![真实配图](https://example.com/photo.png)\n\n```md\n![代码里的图片](https://example.com/code.png)\n```\n\n![不能读取](http://127.0.0.1/secret.png)';
 const imported=await importWritingImages(s,body,[],async url=>{downloads++;return{bytes:Buffer.from('actual-image-bytes'),mime:'image/png',url};});assert.equal(downloads,1);assert.equal(imported.files.length,1);assert.equal(imported.warnings.length,1);assert.equal(imported.sources[0].url,'https://example.com/photo.png');assert.equal((await s.fileBytes(imported.files[0].id)).toString(),'actual-image-bytes');
 const doc=markdownDocument(body,imported.byUrl);assert.ok(doc.content?.some(n=>n.type==='writingMedia'));assert.match(documentText(doc,imported.files),/!\[真实配图\]\(\/api\/files\//);
 const repeated=await importWritingImages(s,'![再次使用](https://example.com/photo.png)',imported.sources,async()=>{throw Error('不应重新下载');});assert.equal(repeated.files[0].id,imported.files[0].id);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('a cited article with images updates the editor and keeps image provenance outside prose',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-image-flow-'),store=await createStore(dir),profile:LocalProfile={id:'qa-images',name:'QA',vendor:'QA',model:'fixture',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false};
 try{const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>fixtureKnowledge(),execute:async()=>({text:citedReply('# 图文\n\n这里是正文。\n\n![页面配图](https://example.com/photo.png)'),usage:UNKNOWN_USAGE,reportedModel:profile.model,logs:''}),imageDownload:async url=>({bytes:Buffer.from('actual-bytes'),mime:'image/png',url})});let a=await e.create({});a=await e.send(a.id,{text:'写一篇介绍这次发布的资讯',purpose:'auto',revision:a.revision,profileId:profile.id,model:profile.model,requestKey:randomUUID()});
 for(let n=0;n<100&&a.messages.at(-1)?.status==='pending';n++){await new Promise(r=>setTimeout(r,20));a=await e.article(a.id);}assert.equal(a.messages.at(-1)?.status,'complete',a.messages.at(-1)?.error);assert.equal(a.media.length,1);assert.equal(a.webMedia?.[0].fileId,a.media[0].id);assert.ok(a.document?.content?.some(n=>n.type==='writingMedia'));assert.doesNotMatch(documentText(a.document!,a.media),/本次知识库参考/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('page images come from actual HTML metadata and lazy image attributes',()=>{
 const html='<title>官网 &amp; 项目</title><meta content="/cover.png?a=1&amp;b=2" property="og:image"><img width="1" height="1" src="/tracking.gif"><img alt="页面截图" data-src="https://cdn.example.com/result.webp"><img src="http://127.0.0.1/private.png">';
 const images=pageImageCandidates(html,'https://example.com/news');assert.deepEqual(images,[{url:'https://example.com/cover.png?a=1&b=2',caption:'官网 & 项目'},{url:'https://cdn.example.com/result.webp',caption:'页面截图'}]);
});

test('existing image links can be restored without rewriting text or reviving removed images',async()=>{
 const {ArticleMaterialsService}=await import('../packages/core/article-materials');
 const dir=await mkdtemp('/private/tmp/writing-image-repair-'),store=await createStore(dir);
 try{const e=new EditorialService(new CasebenchService(store)),w=new WritingDocumentService(e),materials=new ArticleMaterialsService(e,async url=>({bytes:Buffer.from('image-bytes'),mime:'image/png',url}));let a=await e.create({});
 const markdown='# 人工标题\n\n![官方图片](https://example.com/real.png)\n\n这里是人工改过的正文。';
 a=await w.save(a.id,{documentRevision:0,document:markdownDocument(markdown)});
 a=await e.mutate(a.id,'article',a=>({...a,messages:[{id:'test-reply',role:'assistant',status:'complete',text:'说明保持原样',createdAt:new Date().toISOString(),documentMarkdown:markdown+'\n\n![已经删掉的图](https://example.com/deleted.png)'}]}));
 const result=await materials.importImages(a.id,{documentRevision:a.documentRevision});assert.equal(result.warnings.length,0);assert.equal(result.article.media.length,1);assert.equal(result.article.webMedia?.[0].url,'https://example.com/real.png');assert.equal(result.article.document?.content?.[1].type,'writingMedia');assert.match(documentText(result.article.document!,result.article.media),/人工标题|人工改过/);assert.equal(result.article.messages[0].text,'说明保持原样');assert.equal(result.article.versions?.at(-1)?.label,'补入网页图片前');
 const again=await materials.importImages(a.id,{documentRevision:result.article.documentRevision});assert.equal(again.article.documentRevision,result.article.documentRevision);assert.equal(again.article.media.length,1);
 await assert.rejects(materials.importImages(a.id,{documentRevision:0}),/正文已更新/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
