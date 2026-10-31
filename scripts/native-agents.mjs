import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findAgent,capture,normalizeUsage,usageDifference,ZERO_TOKEN_TOTAL} from './agent-runtime.mjs';

export const SESSION_PROFILES={gpt:'chatgpt-session',workbuddy:'workbuddy-session',deepseek:'deepseek-session',minimax:'minimax-session'};
export async function executionHealth(agentId){try{const saved=JSON.parse(await readFile(path.join(process.env.CASEBENCH_DATA_DIR||path.join(process.env.CASEBENCH_ROOT||process.cwd(),'.casebench'),'agents',agentId,'execution-health.json'),'utf8'));if(agentId==='workbuddy'){const program=(await findAgent(agentId))?.path;if(saved.program&&saved.program!==program||process.env.CASEBENCH_WORKBUDDY_PROGRAM&&!saved.program)return null;}return saved;}catch{return null;}}
async function reportHealth(agentId,model,error=null){const directory=path.join(process.env.CASEBENCH_DATA_DIR||path.join(process.env.CASEBENCH_ROOT||process.cwd(),'.casebench'),'agents',agentId);await mkdir(directory,{recursive:true});const issue=error&&/no longer available|model.*not found|model.*unavailable/i.test(error)?'model_unavailable':error&&/balance|余额/i.test(error)?'balance':error&&/auth|login|登录|授权/i.test(error)?'authentication':error?'execution':null;const prior=await executionHealth(agentId),models={...(prior?.models||{}),...(prior?.model?{[prior.model]:{issue:prior.issue,at:prior.at}}:{})},at=new Date().toISOString();models[model]={issue,at};await writeFile(path.join(directory,'execution-health.json'),JSON.stringify({model,issue,at,models,...(agentId==='workbuddy'?{program:(await findAgent(agentId))?.path}:{})}),{mode:0o600});}
export function sessionAgent(model){return model.agentId||Object.entries(SESSION_PROFILES).find(([,id])=>id===(model.baseProfileId||model.id))?.[0]||null;}
export function lineRpc(installation,args,{cwd,env={},timeout=20000,permissionTools=[]}={}){
 const child=spawn(installation.program,[...installation.args,...args],{cwd,env:{...process.env,...env},shell:false,stdio:['pipe','pipe','pipe']});
 let seq=0,closed=false,stderr='';const pending=new Map(),listeners=new Set();
 const fail=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();for(const fn of listeners)fn({method:'$transport/error',params:{message:e.message}});};
 const send=m=>{if(!closed&&!child.stdin.destroyed)child.stdin.write(JSON.stringify(m)+'\n');};
 child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});child.on('error',fail);child.stdin.on('error',fail);
 child.on('close',code=>{if(!closed)fail(new Error(`Agent 连接已断开（${code}）${/auth|login/i.test(stderr)?'，请检查登录状态':''}`));});
 const reader=createInterface({input:child.stdout});reader.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}
  if(m.id!=null&&pending.has(m.id)&&!m.method){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);if(m.error){const e=Error(String(m.error.message||'Agent 请求失败'));e.code=m.error.code;e.data=m.error.data;p.reject(e);}else p.resolve(m.result);return;}
  if(m.id!=null&&m.method){if(m.method==='session/request_permission'){const call=m.params?.toolCall||{},name=call.rawInput?.name||call.rawInput?.toolName||'',allowed=permissionTools.some(t=>name==='mcp__casebench_media__'+t||name==='casebench_media/'+t||call.title==='casebench_media · '+t),option=allowed?m.params?.options?.find(o=>o.kind==='allow_once'):null;send({jsonrpc:'2.0',id:m.id,result:{outcome:option?{outcome:'selected',optionId:option.optionId}:{outcome:'cancelled'}}});}else send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'文本评测不授权外部工具或文件操作'}});return;}
  for(const fn of listeners)fn(m);
 });
 return {request(method,params={},wait=timeout){return new Promise((resolve,reject)=>{const id=++seq,timer=wait?setTimeout(()=>{pending.delete(id);reject(Error(`${method} 响应超时`));},wait):undefined;pending.set(id,{resolve,reject,timer});send({jsonrpc:'2.0',id,method,params});});},notify:(method,params)=>send({jsonrpc:'2.0',method,params}),on(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){closed=true;reader.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('连接已结束'));}pending.clear();child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),2000);timer.unref();child.once('close',()=>clearTimeout(timer));child.kill('SIGTERM');}};
}
export function acpClient(installation,options={}){return lineRpc(installation,installation.id==='deepseek'?['acp']:['acp'],options);}
export const ACP_INIT={protocolVersion:1,clientCapabilities:{},clientInfo:{name:'casebench',title:'Eval Bench',version:'0.5.0'}};
export function acpModels(response){
 const option=response.configOptions?.find(o=>o.category==='model'||o.id==='model');
 const flatten=items=>(items||[]).flatMap(o=>o.options?flatten(o.options):typeof o.value==='string'?[o]:[]);
 if(option)return flatten(option.options).map(o=>({id:o.value,name:o.name||o.value,family:'其他',isDefault:o.value===option.currentValue}));
 return (response.models?.availableModels||[]).map(o=>({id:o.modelId,name:o.name||o.modelId,family:'其他',isDefault:o.modelId===response.models.currentModelId}));
}
// MiniMax advertises /usage as a local command. Its totals are session-wide,
// so query before and after a prompt rather than counting them again on resume.
export function parseNativeUsage(text){
 const read=label=>{const match=new RegExp(`^${label}: ([\\d,]+)$`,'m').exec(text);if(!match)return null;const value=Number(match[1].replaceAll(',',''));return Number.isSafeInteger(value)&&value>=0?value:null;};
 if(!text.startsWith('Session usage:\n'))return null;
 const inputTokens=read('Input tokens'),outputTokens=read('Output tokens');
 if(inputTokens===null||outputTokens===null)return null;
 return {inputTokens,outputTokens,cachedInputTokens:read('Cache read tokens')};
}
export async function probeAcpAgent(installation,directory){
 await mkdir(directory,{recursive:true});const cwd=path.join(directory,'workspace');await mkdir(cwd,{recursive:true});
 const client=acpClient(installation,{cwd,timeout:35000}),file=path.join(directory,'catalog-session.json');
 try{const hello=await client.request('initialize',ACP_INIT);let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch{}
  let response;if(saved?.sessionId)try{response=await client.request('session/resume',{sessionId:saved.sessionId,cwd,mcpServers:[]});}catch(e){if(!/not found|unknown|resum|resource|missing/i.test(e.message))throw e;}
  if(!response){response=await client.request('session/new',{cwd,mcpServers:[]});await writeFile(file,JSON.stringify({sessionId:response.sessionId}),{mode:0o600});}
  const models=acpModels(response);if(!models.length)throw Error('Agent 未返回可选模型');
  await client.request('session/close',{sessionId:response.sessionId||saved.sessionId},1200).catch(()=>{});
  return {version:hello.agentInfo?.version,models};
 }finally{client.close();}
}
function progressWriter(task,agentId){
 const progress={agentId,threadId:task.conversation?.threadId||null,turnId:task.conversation?.clientMessageId||null,phase:'connecting',model:null,updatedAt:new Date().toISOString(),events:[],outputText:'',usage:normalizeUsage(null),activeDurationMs:0};
 let chain=Promise.resolve(),started=0,finished=0;
 const save=()=>{progress.updatedAt=new Date().toISOString();progress.activeDurationMs=started?(finished||Date.now())-started:0;const data=JSON.stringify(progress);chain=chain.then(async()=>{await writeFile(path.join(task.directory,'live.json.tmp'),data,{mode:0o600});await rename(path.join(task.directory,'live.json.tmp'),path.join(task.directory,'live.json'));});};
 const event=text=>{progress.events=[...progress.events,{at:new Date().toISOString(),text:String(text).slice(0,1000)}].slice(-40);save();};
 return {progress,save,event,start(){started=Date.now();progress.phase='running';save();},finish(){finished=Date.now();save();},async persist(extra={}){await chain;const metadata={agentId,...(progress.threadId?{threadId:progress.threadId}:{}),...(progress.turnId?{turnId:progress.turnId}:{}),activeDurationMs:progress.activeDurationMs,...(progress.usageRaw?{usageRaw:progress.usageRaw}:{}),...extra};await writeFile(path.join(task.outputDirectory,'session.json'),JSON.stringify({threadId:progress.threadId,model:progress.model,usage:progress.usage,metadata},null,2));if(progress.outputText.trim())await writeFile(path.join(task.outputDirectory,'response.md'),progress.outputText);}};
}
export async function runAcpSession(task,prompt,agentId){
 const installation=await findAgent(agentId);if(!installation)throw Error('未找到本机 Agent 执行程序');
 const cwd=task.conversation?.sessionCwd||task.directory,w=progressWriter(task,agentId),p=w.progress;
 const client=acpClient(installation,{cwd,timeout:35000,permissionTools:task.toolSession?.tools.map(t=>t.name)||[]});let cancelled=false,submitted=false,ready=false,commands=[],usageReading=false,usageText='';
 const cancel=()=>{cancelled=true;if(ready&&p.threadId)client.notify('session/cancel',{sessionId:p.threadId});};
 process.once('SIGTERM',cancel);const poll=setInterval(()=>{void readFile(path.join(task.directory,'cancel.json')).then(cancel).catch(()=>{});},500);poll.unref();
 client.on(m=>{if(m.method!=='session/update'||(p.threadId&&m.params?.sessionId!==p.threadId))return;const u=m.params.update;if(u.sessionUpdate==='available_commands_update'){commands=u.availableCommands||[];return;}if(m.params?.sessionId!==p.threadId)return;if(usageReading){if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text')usageText=(usageText+u.content.text).slice(0,10000);return;}if(!submitted)return;if(u.sessionUpdate==='agent_message_chunk'&&u.content?.type==='text'){p.outputText=(p.outputText+u.content.text).slice(-2000000);w.save();}else if(u.sessionUpdate==='agent_thought_chunk'&&u.content?.type==='text'&&u.content.text)w.event('公开推理摘要：'+u.content.text);else if(u.sessionUpdate==='tool_call')w.event(`处理步骤：${u.title||'Agent 工具请求'}`);});
 const readUsage=async()=>{usageReading=true;usageText='';try{await client.request('session/prompt',{sessionId:p.threadId,prompt:[{type:'text',text:'/usage'}]},5000);return parseNativeUsage(usageText);}catch{return null;}finally{usageReading=false;}};
 let version;
 try{w.event('正在连接本机 Agent');const hello=await client.request('initialize',ACP_INIT);version=hello.agentInfo?.version;
  const session=await client.request(task.conversation?'session/resume':'session/new',{...(task.conversation?{sessionId:task.conversation.threadId}:{}),cwd,mcpServers:task.toolSession?[{name:'casebench_media',type:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./media-tools.mjs',import.meta.url)),task.toolSession.file],env:[]}]:[]});
  p.threadId=session.sessionId||task.conversation.threadId;ready=true;
  const selected=task.model.model,models=acpModels(session);if(selected!=='default'&&!models.some(m=>m.id===selected))throw Error('当前 Agent 已不提供测试时选择的模型，请刷新连接后重新测试');
  if(selected!=='default')await client.request('session/set_config_option',{sessionId:p.threadId,configId:'model',value:selected});
  // Always override a process-wide full-access default for these text-only sessions.
  if(agentId==='minimax')await client.request('session/set_config_option',{sessionId:p.threadId,configId:'permissionMode',value:'default'});
  p.model=models.find(m=>m.id===(selected==='default'?models.find(m=>m.isDefault)?.id:selected))?.name||null;
  // Never send an unknown slash command to a model. Only use the command when
  // this process has explicitly advertised it as supported.
  if(agentId==='minimax')for(let n=0;n<10&&!commands.length;n++)await new Promise(resolve=>setTimeout(resolve,50));
  const hasUsage=agentId==='minimax'&&commands.some(command=>command.name==='usage');
  const baseline=hasUsage?await readUsage():null;
  if(cancelled)throw Error('用户停止了本轮执行');p.turnId=task.conversation?.clientMessageId||`native_${Date.now()}`;submitted=true;w.start();w.event(task.conversation?'原会话已恢复，开始处理追问':'会话已创建，开始处理');
  const result=await client.request('session/prompt',{sessionId:p.threadId,prompt:[{type:'text',text:prompt}]},0);
  if(result.usage)p.usage=normalizeUsage(result.usage);
  if(cancelled||result.stopReason==='cancelled')throw Error('用户停止了本轮执行');
  if(result.stopReason!=='end_turn')throw Error(`Agent 本轮结束：${result.stopReason||'未提供状态'}`);
  if(hasUsage){const total=await readUsage();if(total){p.usageRaw={total};p.usage=usageDifference(total,baseline||(!task.conversation?ZERO_TOKEN_TOTAL:null));}}
  if(!p.outputText.trim())throw Error('Agent 没有返回正文');p.phase='completed';w.event('本轮完成，正在归档');await reportHealth(agentId,task.model.model);return p.outputText;
 }catch(e){p.phase='failed';w.event(e.message);if(!cancelled)await reportHealth(agentId,task.model.model,e.message);throw e;}
 finally{w.finish();clearInterval(poll);process.removeListener('SIGTERM',cancel);await w.persist({sessionCwd:cwd,...(version?{agentVersion:version}:{})});if(p.threadId)await client.request('session/close',{sessionId:p.threadId},3000).catch(()=>{});client.close();}
}

export function workbuddyEnvironment(installation){return {...process.env,CODEBUDDY_FORCE_LITE_WB_BUNDLE:installation.path?.includes('app.asar.unpacked')?'1':'',CODEBUDDY_CONFIG_DIR:process.env.WORKBUDDY_CONFIG_DIR||path.join(process.env.HOME||'','.workbuddy')};}
export async function workbuddyModels(installation){const help=await capture(installation.program,[...installation.args,'--help'],{timeout:6000,env:workbuddyEnvironment(installation)});const names=/supported:\s*\(([^)]+)\)/i.exec(help.split('\n').find(l=>/--model <model>/.test(l))||'')?.[1]||'';return names.split(',').map(id=>id.trim()).filter(Boolean).map(id=>({id,name:id,family:'其他',isDefault:id==='auto'}));}
export async function probeWorkbuddyAgent(installation){
 return new Promise((resolve,reject)=>{
  const child=spawn(installation.program,[...installation.args,'-p','--input-format','stream-json','--output-format','stream-json','--verbose'],{env:workbuddyEnvironment(installation),shell:false,stdio:['pipe','pipe','pipe']});
  let settled=false;const reader=createInterface({input:child.stdout}),timer=setTimeout(()=>finish(Error('WorkBuddy 控制接口握手超时')),12000);
  function finish(error,data){if(settled)return;settled=true;clearTimeout(timer);reader.close();child.stdin.end();child.kill('SIGTERM');error?reject(error):resolve(data);}
  child.stderr.resume();child.on('error',e=>finish(e));child.stdin.on('error',e=>finish(e));child.on('close',()=>{if(!settled)finish(Error('WorkBuddy 执行器在握手时退出'));});
  reader.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.type!=='control_response'||m.response?.request_id!=='casebench-catalog')return;if(m.response.subtype!=='success'){finish(Error('WorkBuddy 控制接口拒绝请求'));return;}const r=m.response.response||{},models=(r.models||[]).filter(m=>typeof m.id==='string').map(m=>({id:m.id,name:m.name||m.id,family:'其他',isDefault:m.id===r.currentModelId}));if(!models.length){finish(Error('WorkBuddy 未返回模型目录'));return;}finish(null,{models,hasAccount:!!r.account});});
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'casebench-catalog',request:{subtype:'initialize',hasPrompt:false}})+'\n');
 });
}
export async function runWorkbuddySession(task,prompt){
 const installation=await findAgent('workbuddy');if(!installation)throw Error('未发现 WorkBuddy');
 const cwd=task.conversation?.sessionCwd||task.directory,w=progressWriter(task,'workbuddy'),p=w.progress;
 const writing=task.case?.id==='writing'||!!task.toolSession;
 const toolNames=task.toolSession?[...(task.case?.scene==='writing'?['WebSearch','WebFetch']:[]),...task.toolSession.tools.map(t=>'mcp__casebench_media__'+t.name)]:['WebSearch','WebFetch','mcp__writing_web__read_public_page'];
 const webConfig=task.toolSession?JSON.stringify({mcpServers:{casebench_media:{type:'stdio',defer_loading:false,command:process.execPath,args:[fileURLToPath(new URL('./media-tools.mjs',import.meta.url)),task.toolSession.file]}}}):writing?JSON.stringify({mcpServers:{writing_web:{type:'stdio',defer_loading:false,command:process.execPath,args:['--import',import.meta.resolve('tsx'),fileURLToPath(new URL('./writing-web-tools.ts',import.meta.url))]}}}):'{"mcpServers":{}}';
 const args=['-p','--output-format','stream-json','--include-partial-messages','--verbose','--strict-mcp-config','--mcp-config',webConfig,'--permission-mode',writing?'bypassPermissions':'dontAsk','--tools',writing?toolNames.map(n=>n.startsWith('mcp__')?'NoDefer('+n+')':n).join(','):'',...(writing?['--allowedTools',toolNames.join(','),'--disallowedTools','Bash,Read,Write,Edit,MultiEdit,Glob,Grep,Agent,Skill','-y']:[]),'--model',task.model.model,...(task.conversation?['--resume',task.conversation.threadId]:[]),prompt];
 let cancelled=false,done=false,lastResult;const messages=new Map(),delta=new Map();
 const child=spawn(installation.program,[...installation.args,...args],{cwd,shell:false,env:workbuddyEnvironment(installation),stdio:['ignore','pipe','pipe']});
 const stop=()=>{cancelled=true;child.kill('SIGINT');};process.once('SIGTERM',stop);const timer=setInterval(()=>{void readFile(path.join(task.directory,'cancel.json')).then(stop).catch(()=>{});},500);timer.unref();let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
 const render=()=>{p.outputText=[...messages.values()].join('\n\n').slice(-2000000);w.save();};
 const reader=createInterface({input:child.stdout});reader.on('line',line=>{let e;try{e=JSON.parse(line);}catch{return;}if(e.session_id)p.threadId=e.session_id;if(e.type==='system'&&e.subtype==='init'){p.model=e.model==='auto'?null:e.model;w.event('原生会话已连接');}if(e.type==='assistant'){if(e.message?.model&&e.message.model!=='auto')p.model=e.message.model;for(const c of e.message?.content||[])if(c.type==='tool_use'&&['WebSearch','WebFetch','mcp__writing_web__read_public_page'].includes(c.name))w.event(c.name==='WebSearch'?'正在搜索公开网页':'正在读取公开网页');const text=(e.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');if(text)messages.set(e.uuid||e.message.id,text);delta.clear();render();}if(e.type==='stream_event'){const ev=e.event;if(ev?.type==='content_block_delta'&&ev.delta?.type==='text_delta'){const key=e.uuid||'stream';delta.set(key,(delta.get(key)||'')+ev.delta.text);p.outputText=[...messages.values(),...delta.values()].join('\n\n').slice(-2000000);w.save();}if(ev?.type==='message_stop')delta.clear();}if(e.type==='result'){lastResult=e;p.turnId=e._requestId||e.uuid;const usage=normalizeUsage(e.usage),total={inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,cachedInputTokens:usage.cachedTokens};p.usageRaw={total};p.usage=usageDifference(total,task.conversation?(task.conversation.previousTotal||null):ZERO_TOKEN_TOTAL);w.save();}});
 try{w.start();w.event('正在执行 WorkBuddy 本机任务');await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{done=true;if(cancelled)reject(Error('用户停止了本轮执行'));else if(lastResult?.is_error)reject(Error((lastResult.errors||[]).join('\n')||lastResult.result||'WorkBuddy 执行失败'));else if(code!==0)reject(Error(`WorkBuddy 退出（${code}）：${stderr.slice(-800)}`));else resolve();});});if(/Authentication required|\/login command/i.test(p.outputText))throw Error('WorkBuddy 执行器未登录，请完成执行器授权后重试');if(!p.outputText.trim())throw Error('WorkBuddy 没有返回正文');p.phase='completed';w.event('本轮完成');await reportHealth('workbuddy',task.model.model);return p.outputText;}
 catch(e){p.phase='failed';w.event(e.message);if(!cancelled)await reportHealth('workbuddy',task.model.model,e.message);if(/Authentication required|\/login command|未登录/i.test(e.message)){p.outputText='';throw Error(installation.path?.includes('app.asar.unpacked')?'WorkBuddy 桌面凭据受保护，独立执行器尚未获得授权；请完成官方执行器授权后再刷新连接。':'WorkBuddy 官方执行器尚未登录或授权已失效，请完成官方登录后刷新连接。');}throw e;}
 finally{clearInterval(timer);process.removeListener('SIGTERM',stop);reader.close();if(!done)child.kill('SIGTERM');w.finish();await w.persist({sessionCwd:cwd});}
}
