import {callMediaTool} from './media-tool-client.mjs';
import { writeFile, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { findAgent,rpcClient,usageDifference,ZERO_TOKEN_TOTAL,normalizeUsage,capture } from './agent-runtime.mjs';

export async function runCodexSession(task,prompt){
 const scopedConfig=task.toolSession?{config:{'features.shell_tool':false,'features.unified_exec':false,'features.view_image':false,'features.multi_agent':false}}:{};
 const dir=task.directory||process.cwd(),progressFile=path.join(dir,'live.json');
 const progress={threadId:task.conversation?.threadId||null,turnId:null,phase:'connecting',model:null,updatedAt:new Date().toISOString(),events:[],outputText:'',usage:normalizeUsage(null),usageRaw:{},activeDurationMs:0};
 let saving=Promise.resolve(),nativeTurnId=null,startedAt=null,endedAt=null,nativeDuration=null,done=false,submitted=false,cancelled=false,baseline=progress.threadId?(task.conversation?.previousTotal||null):{...ZERO_TOKEN_TOTAL};
 const save=()=>{progress.updatedAt=new Date().toISOString();progress.activeDurationMs=nativeDuration??(startedAt?(endedAt||Date.now())-startedAt:0);const bytes=JSON.stringify(progress);saving=saving.then(async()=>{await writeFile(progressFile+'.tmp',bytes,{mode:0o600});await rename(progressFile+'.tmp',progressFile)});};
 const event=text=>{progress.events=[...progress.events,{at:new Date().toISOString(),text:String(text).replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').slice(0,2000)}].slice(-40);save()};
 const installation=await findAgent('gpt');if(!installation)throw new Error('未发现 GPT 本机执行器，请检查安装或设置 CASEBENCH_GPT_PROGRAM');
 let agentVersion;try{agentVersion=(await capture(installation.program,[...installation.args,'--version'],{timeout:3000})).split('\n').at(-1)?.slice(0,200)}catch{}
 const client=rpcClient(installation,{cwd:dir,timeout:20000,experimentalApi:!!task.toolSession,onServerRequest:async(method,params)=>{if(method!=='item/tool/call'||!task.toolSession)throw Error('未授权的工具请求');const result=await callMediaTool(task.toolSession,params.tool,params.arguments);event('素材工具：'+params.tool);return {success:!result.isError,contentItems:result.content.map(c=>c.type==='text'?{type:'inputText',text:c.text}:{type:'inputImage',imageUrl:'data:'+c.mimeType+';base64,'+c.data})};}});let resolve,reject;const completion=new Promise((a,b)=>{resolve=a;reject=b});completion.catch(()=>{});
 const messages=new Map();
 const render=()=>{const all=[...messages.values()];const finals=all.filter(m=>m.phase==='final_answer');progress.outputText=(finals.length?finals:all).map(m=>m.text).join('\n\n').slice(-2000000);};
 const clean=raw=>Object.fromEntries(Object.entries(raw||{}).filter(([k,v])=>['inputTokens','outputTokens','cachedInputTokens','cacheWriteInputTokens','reasoningOutputTokens','totalTokens'].includes(k)&&Number.isSafeInteger(v)&&v>=0));
 client.on(m=>{
  if(m.method==='$transport/error'){if(!done)reject(new Error(m.params.message));return;}
  const p=m.params||{};if(!progress.threadId||p.threadId!==progress.threadId)return;
  if(m.method==='thread/tokenUsage/updated'){
   const raw={last:clean(p.tokenUsage?.last),total:clean(p.tokenUsage?.total)};
   if(!submitted){baseline=raw.total;return;}
   if(nativeTurnId&&p.turnId&&p.turnId!==nativeTurnId)return;
   progress.usageRaw=raw;progress.usage=usageDifference(raw.total,baseline);save();
  }
  if(m.method==='turn/started'&&submitted){nativeTurnId=p.turn.id;progress.turnId=nativeTurnId;startedAt=Date.now();progress.phase='running';event('Agent 开始处理这一轮');}
  if(nativeTurnId&&p.turnId&&p.turnId!==nativeTurnId)return;
  if(m.method==='item/started'&&p.item?.type==='agentMessage')messages.set(p.item.id,{text:p.item.text||'',phase:p.item.phase});
  if(m.method==='item/agentMessage/delta'){const old=messages.get(p.itemId)||{text:'',phase:null};messages.set(p.itemId,{...old,text:old.text+(p.delta||'')});render();save();}
  if(m.method==='item/completed'&&p.item?.type==='agentMessage'){messages.set(p.item.id,{text:p.item.text||'',phase:p.item.phase});render();save();}
  if(m.method==='item/started'&&p.item&&!['agentMessage','reasoning','userMessage'].includes(p.item.type))event('执行活动：'+(p.item.title||p.item.name||p.item.type));
  if(m.method==='item/completed'&&p.item?.type==='reasoning'&&Array.isArray(p.item.summary)){const summary=p.item.summary.filter(x=>typeof x==='string').join(' ');if(summary)event('公开推理摘要：'+summary);}
  if(m.method==='model/rerouted'&&p.toModel){progress.model=p.toModel;event('Agent 返回实际执行模型');}
  if(m.method==='turn/completed'&&submitted){
   if(nativeTurnId&&p.turn.id!==nativeTurnId)return;
   for(const item of p.turn.items||[])if(item.type==='agentMessage')messages.set(item.id,{text:item.text||'',phase:item.phase});render();endedAt=Date.now();
   nativeDuration=typeof p.turn.durationMs==='number'?p.turn.durationMs:startedAt?endedAt-startedAt:0;progress.activeDurationMs=nativeDuration;
   if(p.turn.status==='completed'){progress.phase='completed';event('本轮完成，正在保存产物与用量');resolve();}
   else reject(new Error(cancelled||p.turn.status==='interrupted'?'用户停止了本轮执行':p.turn.error?.message||`Agent 返回 ${p.turn.status}`));
  }
 });
 const interrupt=()=>{cancelled=true;if(progress.threadId&&nativeTurnId&&!done)void client.request('turn/interrupt',{threadId:progress.threadId,turnId:nativeTurnId}).catch(()=>{});};
 process.once('SIGTERM',interrupt);const cancelPoll=setInterval(()=>{void readFile(path.join(dir,'cancel.json'),'utf8').then(()=>interrupt()).catch(()=>{});},500);cancelPoll.unref();
 try{
  event('正在连接本机 Agent');await client.initialize();
  if(progress.threadId){
   const r=await client.request('thread/read',{threadId:progress.threadId,includeTurns:false});if(r.thread.status?.type==='active')throw new Error('这段会话正在桌面端执行，请等待完成后再发送');
   const resumed=await client.request('thread/resume',{threadId:progress.threadId,excludeTurns:true,...scopedConfig,...(task.model.model!=='default'?{model:task.model.model}:{})});progress.model=resumed.model||progress.model;
  }else{
   const account=await client.request('account/read',{refreshToken:false});if(!account.account)throw new Error('请先登录 GPT 本机执行器');
   const started=await client.request('thread/start',{...(task.model.model&&task.model.model!=='default'?{model:task.model.model}:{}),cwd:dir,ephemeral:false,...scopedConfig,sandbox:'read-only',approvalPolicy:'on-request',threadSource:'user',serviceName:'casebench',...(task.toolSession?{dynamicTools:task.toolSession.tools.map(t=>({...t,type:'function',deferLoading:false}))}:{})});
   progress.threadId=started.thread.id;progress.model=started.model||progress.model;await client.request('thread/name/set',{threadId:progress.threadId,name:`网页测评 · ${task.case.title}`.slice(0,100)});
  }
  event(task.conversation?'原会话已恢复':'持久会话已建立');if(cancelled)throw new Error('用户停止了本轮执行');
  submitted=true;const response=await client.request('turn/start',{threadId:progress.threadId,input:[{type:'text',text:prompt,text_elements:[]}],...(task.conversation?.clientMessageId?{clientUserMessageId:task.conversation.clientMessageId}:{})});
  nativeTurnId=response.turn.id;progress.turnId=nativeTurnId;startedAt??=Date.now();save();await completion;
  if(!progress.outputText.trim())throw new Error('Agent 没有返回可展示的正文');return progress.outputText;
 }catch(e){interrupt();progress.phase='failed';event(e.message);throw e;}
 finally{
  done=true;endedAt??=Date.now();save();clearInterval(cancelPoll);process.removeListener('SIGTERM',interrupt);await saving;
  const metadata={agentId:'gpt',...(agentVersion?{agentVersion}:{}),...(progress.threadId?{threadId:progress.threadId}:{}),...(progress.turnId?{turnId:progress.turnId}:{}),activeDurationMs:progress.activeDurationMs,usageRaw:progress.usageRaw};
  if(progress.outputText.trim())await writeFile(path.join(task.outputDirectory,'response.md'),progress.outputText);
  await writeFile(path.join(task.outputDirectory,'session.json'),JSON.stringify({threadId:progress.threadId,turnId:progress.turnId,desktopUrl:progress.threadId?`codex://threads/${progress.threadId}`:null,model:progress.model,usage:progress.usage,metadata},null,2));
  client.close();
 }
}
