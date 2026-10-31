import { access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const AGENT_TYPES = [
  { id: 'gpt', name: 'GPT 桌面端', commands: ['codex'], apps: ['ChatGPT.app', 'Codex.app'], bundles: ['Contents/Resources/codex-cli/bin/codex','Contents/Resources/codex'] },
  { id: 'workbuddy', name: 'WorkBuddy', commands: ['codebuddy','workbuddy'], apps: ['WorkBuddy.app'], bundles: ['Contents/Resources/app.asar.unpacked/cli/bin/codebuddy'] },
  { id: 'deepseek', name: 'DeepSeek Harness', commands: ['dsh'], apps: ['DeepSeek Harness.app'], bundles: ['Contents/Resources/runtime/cli/bin/dsh'] },
  { id: 'minimax', name: 'MiniMax Code', commands: ['mcode'], apps: ['MiniMax Code.app'], bundles: [] },
  { id: 'kimi', name: 'Kimi Code', commands: ['kimi'], apps: ['Kimi Code.app','Kimi.app'], bundles: ['Contents/Resources/kimi'] }
];
export async function findAgent(id, options = {}) {
  const env = options.env || process.env, platform = options.platform || process.platform, home = options.home || os.homedir();
  const definition = AGENT_TYPES.find(a => a.id === id); if (!definition || env.CASEBENCH_ENABLED_AGENTS && !env.CASEBENCH_ENABLED_AGENTS.split(',').includes(id)) return null;
  const exists = options.exists || (async file => { try { await access(file, 1); return true; } catch { return false; } });
  const override = env[`CASEBENCH_${id.toUpperCase()}_PROGRAM`];
  const candidates = override ? [{ file: override, source: 'override' }] : [];
  if (platform === 'darwin') for (const root of ['/Applications',path.join(home,'Applications')]) for (const app of definition.apps) for (const bundle of definition.bundles) candidates.push({ file:path.join(root,app,bundle),source:'desktop' });
  for (const directory of (env.PATH || '').split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)) for (const cmd of definition.commands) for (const ext of platform === 'win32' ? ['.exe','.cmd',''] : ['']) candidates.push({file:path.join(directory,cmd+ext),source:'PATH'});
  if (id === 'kimi') candidates.push({ file:path.join(home,'.local','bin',platform==='win32'?'kimi.exe':'kimi'),source:'user' });
  if (id === 'minimax') {
    candidates.push({file:path.join(home,'.minimax-code','bin',platform==='win32'?'mcode.cmd':'mcode'),source:'user'});
    candidates.push({file:path.join(env.CASEBENCH_ROOT||process.cwd(),'tools/minimax-cli/node_modules/@minimax-ai/code/cli.js'),source:'connector'});
  }
  for (const item of candidates) if (await exists(item.file)) {
    const script = id === 'workbuddy' && item.file.includes('app.asar.unpacked') || /\.[mc]?js$/.test(item.file);
    return { id, name:definition.name, path:item.file, program:script?process.execPath:item.file, args:script?[item.file]:[], source:item.source };
  }
  return null;
}
export async function capture(program,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(program,args,{shell:false,env:{...process.env,...options.env},stdio:['ignore','pipe','pipe']});let output='',error='';
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('读取本地程序超时'));},options.timeout||5000);
    child.stdout.on('data',b=>output=(output+b).slice(-300000));child.stderr.on('data',b=>error=(error+b).slice(-3000));
    child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(new Error(`本地程序退出（${code}）`))});
  });
}
export function rpcClient(installation,options={}) {
  const child=spawn(installation.program,[...installation.args,'app-server','--stdio'],{cwd:options.cwd,env:process.env,shell:false,stdio:['pipe','pipe','pipe']});
  const reader=createInterface({input:child.stdout}),pending=new Map(),listeners=new Set();let seq=0,closed=false;
  const fail=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(e)}pending.clear();for(const f of listeners)f({method:'$transport/error',params:{message:e.message}})};
  child.on('error',fail);child.stdin.on('error',fail);child.stderr.resume();child.on('close',()=>{if(!closed)fail(new Error('Agent 连接已断开'))});
  const send=m=>{if(!closed)child.stdin.write(JSON.stringify(m)+'\n')};
  reader.on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id!=null&&!m.method&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(String(m.error.message).slice(0,1000))):p.resolve(m.result);return;}if(m.id!=null&&m.method){if(options.onServerRequest){void Promise.resolve().then(()=>options.onServerRequest(m.method,m.params)).then(result=>send({id:m.id,result})).catch(e=>send({id:m.id,error:{code:-32601,message:e.message}}));return;}send({id:m.id,error:{code:-32601,message:'网页文本会话不自动授权工具操作，请在原生 Agent 中处理。'}});return;}for(const f of listeners)f(m);});
  const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} 响应超时`))},options.timeout||12000);pending.set(id,{resolve,reject,timer});send({id,method,params})});
  return { request,notify:(method,params)=>send({method,params}),on:f=>{listeners.add(f);return()=>listeners.delete(f)},async initialize(){const r=await request('initialize',{clientInfo:{name:'casebench',title:'Eval Bench',version:'0.4.0'},...(options.experimentalApi?{capabilities:{experimentalApi:true}}:{})});send({method:'initialized',params:{}});return r},close(){closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('连接已结束'))}pending.clear();reader.close();child.stdin.end();child.kill('SIGTERM')} };
}
const number = value => typeof value==='number' && Number.isSafeInteger(value) && value>=0 ? value:null;
export function normalizeUsage(raw) {
  const inputTokens=number(raw?.inputTokens ?? raw?.input_tokens),outputTokens=number(raw?.outputTokens ?? raw?.output_tokens);
  return {inputTokens,outputTokens,cachedTokens:number(raw?.cachedInputTokens ?? raw?.cachedTokens ?? raw?.cached_input_tokens ?? raw?.cachedReadTokens ?? raw?.cache_read_input_tokens),cost:null,currency:null,source:inputTokens!==null||outputTokens!==null?'reported':'unknown'};
}
export function usageDifference(total,baseline) {
  if(!total||!baseline)return normalizeUsage(null);
  const out={};for(const key of ['inputTokens','outputTokens','cachedInputTokens','reasoningOutputTokens','totalTokens']){const a=number(total[key]),b=number(baseline[key]);out[key]=a!==null&&b!==null&&a>=b?a-b:null;}
  return normalizeUsage(out);
}
export const ZERO_TOKEN_TOTAL={inputTokens:0,outputTokens:0,cachedInputTokens:0,reasoningOutputTokens:0,totalTokens:0};
export async function readNativeThread(threadId,installation){
 const client=rpcClient(installation);try{await client.initialize();const info=await client.request('thread/read',{threadId,includeTurns:false});let turns=[],cursor;
 try{do{const r=await client.request('thread/turns/list',{threadId,limit:100,itemsView:'full',sortDirection:'asc',...(cursor?{cursor}:{})});turns.push(...r.data);cursor=r.nextCursor;}while(cursor&&turns.length<500)}catch(e){if(!/unknown|unsupported|not found|method/i.test(e.message))throw e;const full=await client.request('thread/read',{threadId,includeTurns:true});turns=full.thread.turns||[];}
 return {thread:info.thread,turns};}finally{client.close();}
}
