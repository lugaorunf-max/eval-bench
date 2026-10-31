import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { stateDir } from '../packages/core/config';
import { executeAdapter,readSessionOutput,collectOutputs } from '../packages/adapters';
import { UNKNOWN_USAGE,type ExecutionMetadata,type Usage } from '../packages/contracts';
const [turnId,origin,...flags]=process.argv.slice(2);if(!/^turn_[a-f0-9]{32}$/.test(turnId||''))throw new Error('无效的会话轮次');
const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('只连接本机网站');
let token='',lease='';const stop=new AbortController();process.once('SIGTERM',()=>stop.abort(new Error('用户停止了本轮执行')));process.once('SIGINT',()=>stop.abort(new Error('用户停止了本轮执行')));
async function request(route:string,body?:unknown){const response=await fetch(`${origin}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(lease?{'x-casebench-conversation-lease':lease}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
async function atomic(file:string,value:unknown){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file)}
async function main(){
 const authFile=path.join(stateDir(),`device-${createHash('sha256').update(origin).digest('hex').slice(0,12)}.json`);try{token=JSON.parse(await readFile(authFile,'utf8')).token;}catch{const auth=await request('runner/register',{name:os.hostname()});token=auth.token;await atomic(authFile,auth);}
 const job=await request(`runner/conversations/${turnId}/${flags.includes('--recover')?'recover':'claim'}`,{});if(!job.claimed)return;lease=job.lease;
 const directory=path.join(stateDir(),'conversations',job.turn.sessionId,turnId,job.turn.attemptId),out=path.join(directory,'out');await mkdir(out,{recursive:true});const checkpointFile=path.join(directory,'checkpoint.json');
 let checkpoint:{completion:any;files:{id:string;name:string;path:string;mime:string;sha256:string}[];synced:boolean};
 if(flags.includes('--recover')){checkpoint=JSON.parse(await readFile(checkpointFile,'utf8'));}
 else{
  const timeout=job.timeoutSeconds?AbortSignal.timeout(job.timeoutSeconds*1000):null,signal=timeout?AbortSignal.any([stop.signal,timeout]):stop.signal;let seq=0,posting=false;const started=performance.now();
  const progress=async()=>{if(posting)return;posting=true;try{let data:any;try{data=JSON.parse(await readFile(path.join(directory,'live.json'),'utf8'));}catch{data={outputText:'',usage:{...UNKNOWN_USAGE}};}
   const metadata:ExecutionMetadata={agentId:job.profile.agentId||'gpt',threadId:job.conversation.threadId,...(data.turnId?{turnId:data.turnId}:{}),...(typeof data.activeDurationMs==='number'?{activeDurationMs:data.activeDurationMs}:{}),...(data.usageRaw?{usageRaw:data.usageRaw}:{})};
   const state=await request(`runner/conversations/${turnId}/progress`,{seq:++seq,outputText:data.outputText||'',usage:data.usage||{...UNKNOWN_USAGE},metadata});if(state.cancelRequested){await writeFile(path.join(directory,'cancel.json'),'{}');stop.abort(new Error('用户停止了本轮执行'));}
  }catch(e){console.error('进度暂未同步',e instanceof Error?e.message:String(e));}finally{posting=false;}};
  const timer=setInterval(()=>void progress(),750);let completion:any={status:'failed',outputText:'',error:null,usage:{...UNKNOWN_USAGE},metadata:{},reportedModel:null,logs:''};
  try{
   const result=await executeAdapter({case:job.entry,model:job.model,profile:job.profile,directory,outputDirectory:out,inputPaths:[],signal,conversation:job.conversation});
   completion={...completion,status:'succeeded',outputText:result.text,usage:result.usage,metadata:result.metadata||{},reportedModel:result.reportedModel,logs:result.logs};
  }catch(e){completion.error=e instanceof Error?e.message:String(e);completion.logs=completion.error;completion.status=timeout?.aborted?'timed_out':stop.signal.aborted||/用户停止/.test(completion.error)?'cancelled':'failed';}
  finally{clearInterval(timer);while(posting)await new Promise(r=>setTimeout(r,25));}
  const recovered=await readSessionOutput(out);if(recovered.metadata.threadId){completion.metadata=recovered.metadata;completion.usage=recovered.usage;completion.reportedModel=recovered.reportedModel;completion.outputText ||= recovered.text;}
  completion.durationMs=Math.round(performance.now()-started);
  const files=(await collectOutputs(out,job.profile.outputExtensions)).map(f=>({...f,id:`file_${randomUUID().replaceAll('-','')}`}));checkpoint={completion,files,synced:false};await atomic(checkpointFile,checkpoint);
 }
 if(checkpoint.synced)return;
 for(let retry=0;retry<3;retry++)try{
  for(const file of checkpoint.files){const bytes=await readFile(file.path);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('本地产物已被修改，停止归档');const form=new FormData();form.set('id',file.id);form.set('file',new Blob([bytes],{type:file.mime}),file.name);await request(`runner/conversations/${turnId}/files`,form);}
  await request(`runner/conversations/${turnId}/complete`,checkpoint.completion);checkpoint.synced=true;await atomic(checkpointFile,checkpoint);return;
 }catch(e){if(retry===2)throw e;await new Promise(r=>setTimeout(r,1000));}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
