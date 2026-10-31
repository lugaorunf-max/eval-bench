import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {saveKnowledgeConfig,knowledgeStatus,writingKnowledge} from '../packages/core/writing-knowledge';
import {EditorialService} from '../packages/core/editorial';
import {CasebenchService} from '../packages/core/service';
import {createStore} from '../packages/core/db';
import {UNKNOWN_USAGE,type LocalProfile} from '../packages/contracts';
import {documentText} from '../packages/core/writing-document';
import type {WritingArticle} from '../packages/contracts/editorial';
import {fixtureKnowledge,knowledgeArticle,fixtureCitation,citedReply} from './fixtures/writing-knowledge';
import {appendKnowledgeCitations,validateKnowledgeCitations} from '../packages/core/writing-citations';

test('citation markers follow actual article IDs and preserve encoded original URLs',()=>{
 const articles=[{...knowledgeArticle,url:'https://example.com/article?biz=abc%3D%3D'},{...knowledgeArticle,id:'OTHER',title:'另一篇文章'}];
 const citations=validateKnowledgeCitations([fixtureCitation,{...fixtureCitation,articleId:'OTHER',purpose:'fact'}],articles);
 const text=appendKnowledgeCitations('本次报道〔库:OTHER〕。\n\n原有外部资料[1]。',citations);
 assert.match(text,/本次报道〔库2〕/);assert.match(text,/原有外部资料\[1\]/);assert.match(text,/biz=abc%3D%3D/);assert.doesNotMatch(text,/%253D/);
 assert.match(appendKnowledgeCitations('旧式来源标记[1]。',citations,['kb:OTHER']),/旧式来源标记〔库2〕/);
 assert.throws(()=>appendKnowledgeCitations('引用〔库:UNREAD〕',citations),/未读取|引用/);
});

test('knowledge is mandatory before model execution even when the user only asks for an outline',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-required-'),store=await createStore(dir);let calls=0,unavailable=true;
 const profile:LocalProfile={id:'qa-required',name:'QA',vendor:'QA',model:'fixture',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false};
 try{
  const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>unavailable?null:{...fixtureKnowledge(),context:{...fixtureKnowledge().context,articles:[]}},execute:async()=>{calls++;return {text:citedReply('模型自行生成的大纲'),usage:UNKNOWN_USAGE,logs:'',reportedModel:profile.model};}});
  let a=await e.create({kind:'practice'});a=await e.send(a.id,{text:'给我一个大纲',purpose:'auto',profileId:profile.id,model:profile.model,revision:a.revision,requestKey:randomUUID()});
  for(let i=0;i<150&&a.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,15));a=await e.article(a.id);}
  assert.equal(calls,0);assert.equal(a.messages.at(-1)?.status,'failed');assert.match(a.messages.at(-1)?.error||'',/知识库/);assert.equal(documentText(a.document!),'');
  unavailable=false;let b=await e.create({kind:'practice'});b=await e.send(b.id,{text:'生成结构',purpose:'auto',profileId:profile.id,model:profile.model,revision:b.revision,requestKey:randomUUID()});for(let i=0;i<150&&b.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,15));b=await e.article(b.id);}assert.equal(calls,0);assert.equal(b.messages.at(-1)?.status,'failed');
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('structures, outlines and drafts cite the actual unanalysed article read before generation',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-citations-'),store=await createStore(dir);let lookedUp=false,calls=0,response='';
 const profile:LocalProfile={id:'qa-citations',name:'QA',vendor:'QA',model:'fixture',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false};
 try{
  const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>{lookedUp=true;return fixtureKnowledge();},execute:async()=>{assert.equal(lookedUp,true);calls++;return {text:response,usage:UNKNOWN_USAGE,logs:'',reportedModel:profile.model};}});
  async function generate(text:string){lookedUp=false;let a=await e.create({kind:'practice'});a=await e.send(a.id,{text,purpose:'auto',profileId:profile.id,model:profile.model,revision:a.revision,requestKey:randomUUID()});for(let i=0;i<150&&a.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,15));a=await e.article(a.id);}return a;}
  for(const [request,value] of [['给三个结构',{action:'reply',reply:'结构：问题、证据、判断。'}],['生成大纲',{action:'edit',markdown:'# 大纲\n\n问题。\n\n证据。'}],['生成文章',{action:'edit',markdown:'# 正文\n\n围绕问题展示证据并说明边界。'}]] as const){
   response=JSON.stringify({...value,knowledgeCitations:[fixtureCitation]});const a=await generate(request),m=a.messages.at(-1)!;
   assert.equal(m.status,'complete',m.error);assert.match(m.text,/本次知识库参考/);assert.match(m.text,/有正文但尚未拆解的写法样本/);assert.match(m.text,/未拆解/);assert.match(m.text,/https:\/\/example.com\/writing-source/);
   assert.equal((m.knowledge as any).citations[0].articleId,knowledgeArticle.id);
   if(value.action==='edit'){assert.doesNotMatch(documentText(a.document!),/本次知识库参考/);assert.ok(a.messages.at(-1)?.documentMarkdown);}
  }
  response=JSON.stringify({action:'edit',markdown:'伪造引用的文章',knowledgeCitations:[{...fixtureCitation,articleId:'NOT-READ'}]});const beforeInvalid=calls,invalid=await generate('生成文章');assert.equal(calls-beforeInvalid,2,'invalid citations receive one repair, then stop');assert.equal(invalid.messages.at(-1)?.status,'failed');assert.equal(documentText(invalid.document!),'');
  response=JSON.stringify({action:'edit',markdown:'伪造原文的文章',knowledgeCitations:[{...fixtureCitation,quote:'这是库中不存在的引文'}]});assert.equal((await generate('生成文章')).messages.at(-1)?.status,'failed');assert.equal(calls,7);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('news outlines and full drafts go straight into the document without a fixed blueprint',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-news-free-'),store=await createStore(dir);
 const profile:LocalProfile={id:'qa-outline',name:'QA',vendor:'QA',model:'fixture',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false};
 let response=citedReply(JSON.stringify({action:'edit',target:'document',reply:'已整理大纲。',markdown:'# 大纲\n\n围绕本篇消息组织。'}));
 const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>({...fixtureKnowledge(),context:{...fixtureKnowledge().context,blueprints:[{id:'BLUEPRINT_SENTINEL'}],templates:[{name:'TEMPLATE_SENTINEL'}]}}),execute:async task=>{assert.doesNotMatch(task.case.prompt,/BLUEPRINT_SENTINEL|TEMPLATE_SENTINEL|LEGACY_TEMPLATE_SENTINEL/);return {text:response,usage:UNKNOWN_USAGE,logs:'',reportedModel:profile.model};}});
 try{
  let a=await e.create({kind:'news',template:'LEGACY_TEMPLATE_SENTINEL'});
  async function send(text:string){a=await e.send(a.id,{text,purpose:'auto',profileId:profile.id,model:profile.model,revision:a.revision,requestKey:randomUUID()});for(let i=0;i<150&&a.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,15));a=await e.article(a.id);}return a.messages.at(-1)!;}
  let m=await send('先给这条消息一个大纲');assert.equal(m.status,'complete',m.error);assert.equal(m.writingStage,'planning');assert.match(documentText(a.document!),/围绕本篇消息/);assert.doesNotMatch(documentText(a.document!),/本次知识库参考|已整理大纲/);assert.match(m.text,/已整理大纲/);assert.equal(a.proposal,null);
  response=citedReply(JSON.stringify({action:'edit',reply:'已写入全文。',markdown:'# 正文\n\n这是根据当前消息写成的短资讯。'}));
  m=await send('按第一个方向直接写完整文章');assert.equal(m.status,'complete',m.error);assert.match(documentText(a.document!),/短资讯/);assert.doesNotMatch(documentText(a.document!),/已写入全文|本次知识库参考/);assert.doesNotMatch(m.text,/短资讯/);assert.match(m.documentMarkdown||'',/短资讯/);assert.equal(a.proposal,null);assert.ok(a.versions?.some(v=>v.label==='AI 修改前'));
  response=citedReply(JSON.stringify({action:'reply',reply:'可以把开头写得更具体。'}));const before=documentText(a.document!);m=await send('你觉得这个开头如何？');assert.equal(m.status,'complete');assert.equal(documentText(a.document!),before);
  a=await e.create({kind:'news'});response=citedReply(JSON.stringify({action:'edit',reply:'已生成正文。',markdown:'# 直接正文\n\n只按本篇材料展开，不强迫先选方向。'}));m=await send('直接写一篇完整文章');assert.equal(m.status,'complete',m.error);assert.equal(m.writingStage,'drafting');assert.match(documentText(a.document!),/直接正文/);
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});

test('writing uses the private knowledge bridge once and retains editor persistence, metrics and isolated article context',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-knowledge-'),old=process.env.CASEBENCH_DATA_DIR;process.env.CASEBENCH_DATA_DIR=dir;const store=await createStore(dir);let requests:any[]=[],fail=false,calls=0,prompt='';
 const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer test-knowledge-token-123456789');res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ready:true}));return;}let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));if(fail){res.statusCode=503;res.end('{}');return;}res.end(JSON.stringify({revision:'vault-r1',engine:'local-bm25-rrf-v1',articles:[knowledgeArticle],templates:[{id:'A1',name:'叙事顺序'}],examples:[{id:'a1',contentExcerpt:'WRITING_PATTERN_ONLY',evidenceLevel:'candidate'}],writingSkill:{instructions:'INLINE_RULES'}}));});server.listen(0,'127.0.0.1');await once(server,'listening');
 const profile:LocalProfile={id:'qa-api',name:'QA writer',vendor:'QA',model:'test-model',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false,baseUrl:'http://127.0.0.1',apiKeyEnv:'QA_KEY'};
 try{
  const safe=await saveKnowledgeConfig({enabled:true,url:'http://127.0.0.1:'+(server.address() as any).port,token:'test-knowledge-token-123456789'});assert.equal('token' in safe,false);assert.equal((await stat(dir+'/writing-knowledge.json')).mode&0o777,0o600);assert.equal((await knowledgeStatus(true)).ready,true);
  const service=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],execute:async input=>{calls++;prompt=input.case.prompt;return {text:citedReply(JSON.stringify({action:'reply',reply:'依据资料讨论'})),usage:UNKNOWN_USAGE,exitCode:0,reportedModel:profile.model,logs:''};}});
  const source=await service.addSource({title:'本篇事实',summary:'CURRENT_FACTS'}),other=await service.addSource({title:'别篇资料',summary:'OTHER_ARTICLE_FACTS'});const a=await service.create({references:[{kind:'source',id:source.id}]});await service.create({references:[{kind:'source',id:other.id}]});
  async function send(revision:number){let next=await service.send(a.id,{text:'请讨论资讯的写法',profileId:profile.id,model:profile.model,requestKey:randomUUID(),revision,purpose:'auto'});for(let i=0;i<100&&next.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,20));next=await service.article(a.id);}return next;}
  const done=await send(0);assert.equal(done.messages.at(-1)?.status,'complete');assert.equal(calls,1);assert.equal(requests.length,1);assert.match(prompt,/先明确问题/);assert.doesNotMatch(prompt,/WRITING_PATTERN_ONLY/);assert.equal(requests[0].mode,'articles');assert.match(prompt,/INLINE_RULES/);assert.match(prompt,/CURRENT_FACTS/);assert.doesNotMatch(prompt,/OTHER_ARTICLE_FACTS/);assert.equal(done.messages.at(-1)?.knowledge?.revision,'vault-r1');assert.ok(done.messages.at(-1)?.durationMs!=null);
  fail=true;const failed=await send(done.revision);assert.equal(failed.messages.at(-1)?.status,'failed');assert.equal(calls,1);assert.match(failed.messages.at(-1)?.error||'',/知识库/);assert.equal(failed.messages[1].text,done.messages[1].text);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await store.close();await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=old;}
});

test('follow-up retrieval keeps the article topic and selected direction instead of searching the short reply',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-retrieval-context-'),old=process.env.CASEBENCH_DATA_DIR;
 process.env.CASEBENCH_DATA_DIR=dir;const requests:any[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;requests.push(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify({templates:[],examples:[],articles:[knowledgeArticle],writingSkill:{instructions:'规则'},engine:'fixture'}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  await saveKnowledgeConfig({enabled:true,url:'http://127.0.0.1:'+(server.address() as any).port,token:'test-knowledge-token-123456789'});
  const at=new Date().toISOString(),a:WritingArticle={id:'article-context',title:'Anthropic IPO 的行业影响',kind:'news',template:'默认结构',pinned:false,references:[],media:[],createdAt:at,updatedAt:at,revision:0,messages:[
   {id:'u1',role:'user',status:'complete',createdAt:at,text:'Anthropic 公开提交纳斯达克 IPO 申请，股票代码 ANT。写成评论，匹配三个方向。'},
   {id:'a1',role:'assistant',status:'complete',purpose:'discuss',createdAt:at,text:'**1. 消息解释（N1）**\n讲清申请进度。\n\n**2. 事件影响展开（N3）**\n从 Anthropic IPO 分析商业模式与行业影响。\n\n**3. 文件要点（N2）**\n逐项解读招股文件。'},
   {id:'u2',role:'user',status:'complete',createdAt:at,text:'选择2，两千字左右，完成文章后标注参考文章'}]};
  await writingKnowledge(a,a.messages.at(-1)!.text);
  assert.match(requests[0].brief,/Anthropic/);assert.match(requests[0].brief,/IPO/);
  assert.match(requests[0].brief,/事件影响展开（N3）/);assert.doesNotMatch(requests[0].brief,/消息解释（N1）|文件要点（N2）/);
  assert.equal(requests[0].genre,'评论');
  a.messages.push({id:'a2',role:'assistant',status:'complete',purpose:'revise',createdAt:at,text:'无关的生成正文，不应该作为检索选题。'});
  await writingKnowledge(a,'开头简短一点');
  assert.match(requests[1].brief,/Anthropic/);assert.match(requests[1].brief,/事件影响展开（N3）/);assert.doesNotMatch(requests[1].brief,/无关的生成正文/);
  await writingKnowledge(a,'写成资讯，按第3种重新写');
  assert.equal(requests[2].genre,'资讯');assert.match(requests[2].brief,/文件要点（N2）/);assert.doesNotMatch(requests[2].brief,/事件影响展开（N3）/);
  const fresh={...a,id:'article-other',title:'新文章',messages:[]};
  await writingKnowledge(fresh,'机器人硬件的测评方法');
  assert.doesNotMatch(requests[3].brief,/Anthropic|IPO|N3|招股/);
  await writingKnowledge(a,'补充资料：'+'长文本'.repeat(8000));assert.ok(requests[4].brief.length<=20000);assert.match(requests[4].brief,/Anthropic/);
  await writingKnowledge(a,'用3000字，侧重第三季度的经营变化');assert.match(requests[5].brief,/事件影响展开（N3）/);assert.doesNotMatch(requests[5].brief,/文件要点（N2）/);
  a.messages[1].text='## 方向一：消息解释（N1）\n讲清消息。\n\n## 方向二：事件影响展开（N3）\n从 Anthropic IPO 写到行业影响。\n\n## 方向三：文件要点（N2）\n拆解文件。';
  await writingKnowledge(a,'选择第二种，继续');assert.match(requests[6].brief,/事件影响展开（N3）/);assert.doesNotMatch(requests[6].brief,/文件要点（N2）/);
  await saveKnowledgeConfig({enabled:false,url:'',token:''});await assert.rejects(writingKnowledge(a,'生成文章'),/必须查看知识库/);assert.equal(requests.length,7);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=old;}
});

test('freeform article material gaps are kept without mandatory slots or a fixed block count',async()=>{
 const dir=await mkdtemp('/private/tmp/writing-freeform-gaps-'),store=await createStore(dir),profile:LocalProfile={id:'qa-freeform',name:'QA',vendor:'QA',model:'fixture',adapter:'api',color:'#111111',modes:['text'],supportsTemperature:false};
 const body='# 本篇资讯\n\n先写已有依据。\n\n【素材位：补充本次发布的开放条件】\n\n【待写：核对开放条件后，再讨论使用门槛】';
 const e=new EditorialService(new CasebenchService(store),{profiles:async()=>[profile],knowledge:async()=>fixtureKnowledge(),execute:async()=>({text:citedReply(JSON.stringify({action:'edit',reply:'保留了具体待核实事项。',markdown:body})),usage:UNKNOWN_USAGE,logs:'',reportedModel:profile.model})});
 try{let a=await e.create({});a=await e.send(a.id,{text:'直接写成一条资讯',purpose:'auto',profileId:profile.id,model:profile.model,revision:0,requestKey:randomUUID()});for(let i=0;i<150&&a.messages.at(-1)?.status==='pending';i++){await new Promise(r=>setTimeout(r,15));a=await e.article(a.id);}assert.equal(a.messages.at(-1)?.status,'complete',a.messages.at(-1)?.error);assert.match(documentText(a.document!),/【素材位：补充本次发布的开放条件】/);assert.match(documentText(a.document!),/【待写：/);assert.doesNotMatch(documentText(a.document!),/保留了具体待核实事项|本次知识库参考/);}finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
