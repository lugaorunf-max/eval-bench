import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createContextServer,projectContext} from './context-server.mjs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createKnowledgeSource} from './project/server/knowledge.mjs';
const token='test-only-private-bridge-123456';
test('article-only mode omits structure cards and blueprint parents and keeps the matched passage',()=>{
 const content='开头背景。'.repeat(4000)+'这里是命中的独有证据。'+'后文。'.repeat(1000);
 const out=projectContext({templates:[{id:'N1'}],blueprints:[{id:'NEWS',sourceArticleIds:['PARENT']}],examples:[{id:'MATCH',contentExcerpt:'这里是命中的独有证据。'}]}, {instructions:'规则'}, {articles:[{id:'MATCH',title:'文章',originalNotePath:'/private/source',_sourceText:content},{id:'PARENT',title:'蓝图来源',_sourceText:'不应加入正文参考'}]},true);
 assert.equal('templates' in out,false);assert.equal('blueprints' in out,false);assert.equal(out.articles.length,1);assert.equal(out.articles[0].id,'MATCH');assert.match(out.articles[0].content,/命中的独有证据/);assert.equal(out.articles[0].contentScope,'excerpt');
});
test('unanalysed full articles and blueprint parents are readable citation objects without private paths',()=>{
 const found={revision:'r1',examples:[{id:'A1',title:'IPO 报道',evidenceLevel:'candidate',contentExcerpt:'召回片段'}],blueprints:[{id:'NEWS-P',name:'推进',sourceArticleIds:['A2'],nodes:[]}]};
 const library={articles:[{id:'A1',title:'IPO 报道',url:'https://example.com/ipo',account:'作者',publishDate:'2026-01-01',evidenceLevel:'candidate',originalNotePath:'/private/original.md',_sourceText:'这篇尚未拆解的文章有可读取全文。末段是独立可核对的原文内容。'},{id:'A2',title:'蓝图原文',evidenceLevel:'analyzed',originalNotePath:'/private/parent.md',_sourceText:'先给出异常，再展示材料，最后解释影响。'}]};
 const out=projectContext(found,{id:'humanizer-zh',revision:'s1',instructions:'规则'},library);
 assert.equal(out.articles[0].id,'A1');assert.equal(out.articles[0].contentScope,'full');assert.match(out.articles[0].content,/末段是独立可核对的原文内容/);
 assert.equal(out.articles[0].evidenceLevel,'candidate');assert.equal(out.articles[0].url,'https://example.com/ipo');
 assert.equal(out.articles[1].id,'A2');assert.equal(out.articles[1].title,'蓝图原文');assert.doesNotMatch(JSON.stringify(out),/\/private\/|notePath|obsidian:/);
});
test('bridge preserves ordered narrative beats, material roles and dependencies without private source paths',()=>{
 const blueprint={id:'NEWS-MEMORY',name:'变化—证据—解释',genre:'资讯',structureId:'N1',version:'1',revision:'b1',fit:'产品发生可验证变化',needs:'先核对跨会话记忆证据',boundary:'没有实测不得声称体验',notePath:'/private/blueprint.md',sourceArticleIds:['A1'],nodes:[{id:'change',title:'读者先看到什么变化',readerQuestion:'和以前相比变在哪里？',move:'先交代变化，再用证据解释',transition:'从变化引出验证',evidence:'/private/original.md',beats:[{id:'setup',type:'narration',instruction:'提出需要验证的问题',dependsOn:[]},{id:'memory-proof',type:'material',instruction:'在解释前展示跨会话调用记录',kind:'case',role:'证明同一信息被实际调用',required:true,dependsOn:[],notePath:'/private/material.md'},{id:'explain',type:'observation',instruction:'解释证据能够支持的判断',dependsOn:['memory-proof']}]}]};
 const out=projectContext({revision:'r1',blueprints:[blueprint],retrieval:{engine:'haystack-fastembed-v1'}},{id:'humanizer-zh',revision:'s1',instructions:'规则'});
 const b=out.blueprints[0];assert.equal(b.title,blueprint.name);assert.equal(b.version,'1');assert.equal(b.boundary,blueprint.boundary);assert.equal(b.nodes[0].readerQuestion,blueprint.nodes[0].readerQuestion);assert.equal(b.nodes[0].transition,blueprint.nodes[0].transition);
 assert.deepEqual(b.nodes[0].beats.map(v=>v.id),['setup','memory-proof','explain']);
 assert.deepEqual(b.nodes[0].beats[1],{id:'memory-proof',type:'material',instruction:'在解释前展示跨会话调用记录',dependsOn:[],kind:'case',role:'证明同一信息被实际调用',required:true});
 assert.deepEqual(b.nodes[0].beats[2].dependsOn,['memory-proof']);assert.doesNotMatch(JSON.stringify(out),/\/private\/|notePath|obsidian:/);
});
test('authenticated retrieval projects current writing references without exposing local paths or making model calls',async()=>{
 let input;const server=createContextServer({token,library:async()=>({revision:'r1',stats:{articles:1}}),lookup:async v=>{input=v;return {revision:'r1',retrieval:{engine:'local-bm25-rrf-v1'},templates:[{id:'A1',name:'消息推进',notePath:'/private/vault'}],examples:[{id:'a1',title:'写法示例',notePath:'/secret',obsidianUrl:'obsidian://secret',contentExcerpt:'文本片段',evidenceLevel:'candidate'}]};},skill:async()=>({id:'humanizer-zh',revision:'skill1',instructions:'规则'})});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(url+'/health')).status,401);
  const response=await fetch(url+'/context',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({brief:'写一篇资讯',genre:'资讯',references:[{id:'r1',title:'本篇消息',content:'真实事实'}]})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.modelCalls,0);assert.equal(body.examples[0].evidenceLevel,'candidate');assert.equal(input.references[0].content,'真实事实');assert.doesNotMatch(JSON.stringify(body),/obsidian:|\/secret|\/private\/vault/);
  assert.equal((await fetch(url+'/generate',{method:'POST',headers:{authorization:'Bearer '+token}})).status,404);
  assert.equal((await fetch(url+'/context',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'})).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('health does not report connected when the supplied retrieval engine has failed',async()=>{
 const server=createContextServer({token,library:async()=>({revision:'r1',source:{retrieval:{engine:'haystack-fastembed-v1',phase:'error',ready:false}}})});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/health',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,503);assert.equal((await response.json()).ready,false);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('bridge runs the supplied live Obsidian retriever and pinned writing rules on an isolated fixture vault',async()=>{
 const root=await mkdtemp(join(tmpdir(),'writing-bridge-vault-'));await mkdir(join(root,'库/结构'),{recursive:true});await mkdir(join(root,'库/文章'));
 await writeFile(join(root,'库/结构/N1.md'),'---\n类型: 写作结构\n体裁: 资讯\n结构代码: N1\n结构名称: 消息解释\n---\n# N1 消息解释\n\n## 推进顺序\n1. 变化\n2. 背景');
 const note=join(root,'库/文章/A1.md'),content='---\n类型: 文章拆解\n文章ID: A1\n标题: 检索接口验证\n体裁: 资讯\n结构代码: N1\n复核状态: 自动候选\n---\n# 检索接口验证\n\n## 来源与正文转写\n磁悬浮体验是此隔离样本的独有主题。';await writeFile(note,content);
 const source=createKnowledgeSource({vaultPath:root,libraryPath:'库',engine:'local'}),server=createContextServer({token,library:source.loadLibrary,lookup:source.retrieve});server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer '+token};
 try{assert.equal((await fetch(url+'/health',{headers})).status,200);const result=await fetch(url+'/context',{method:'POST',headers,body:JSON.stringify({brief:'磁悬浮体验资讯',genre:'资讯',references:[]})});assert.equal(result.status,200);const data=await result.json();assert.equal(data.examples[0].id,'A1');assert.equal(data.engine,'local-bm25-rrf-v1');assert.match(data.examples[0].contentExcerpt,/磁悬浮体验/);assert.equal(data.writingSkill.id,'humanizer-zh');assert.ok(data.writingSkill.instructions.length>1000);assert.equal(data.modelCalls,0);assert.doesNotMatch(JSON.stringify(data),/obsidian:\/\/|notePath|libraryPath/);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));source.close();await rm(root,{recursive:true,force:true});}
});
