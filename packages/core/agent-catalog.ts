import { AGENT_TYPES, capture, findAgent, rpcClient } from '../../scripts/agent-runtime.mjs';
import { loadProfiles, stateDir } from './config';
import path from 'node:path';
import { probeAcpAgent, SESSION_PROFILES,probeWorkbuddyAgent,executionHealth,workbuddyEnvironment } from '../../scripts/native-agents.mjs';
import type { AgentCatalog, AgentModel } from '../contracts';

let cached: { at: number; value: AgentCatalog[] } | undefined;
let pending: Promise<AgentCatalog[]> | undefined;
export async function agentCatalog(force = false): Promise<AgentCatalog[]> {
  if (!force && cached && Date.now() - cached.at < (cached.value.some(a => a.ready) ? 30000 : 3000)) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const profiles = await loadProfiles();
    const value = await Promise.all(AGENT_TYPES.map(async definition => {
      const at = new Date().toISOString(), installation = await findAgent(definition.id);
      const base: AgentCatalog = { id: definition.id, name: definition.name, profileId: null, ready: false, installed: !!installation, state: 'not_installed', detail: '未发现本机安装，可设置程序路径后刷新', models: [], modelSource: 'none', checkedAt: at, capabilities: { continuation: false, usage: false, streaming: false, history: false } };
      if (!installation) return base;
      try { base.version = (await capture(installation.program,[...installation.args,'--version'],{timeout:5000,env: definition.id==='workbuddy'?workbuddyEnvironment(installation):{}})).split('\n').at(-1)?.slice(0,200); } catch { base.version='未知'; }
      if (definition.id !== 'gpt') {
        const profile=profiles.find(p=>p.id===SESSION_PROFILES[definition.id]);base.profileId=profile?.id||null;
        if(definition.id==='deepseek'||definition.id==='minimax')try{
          const catalog=await probeAcpAgent(installation,path.join(stateDir(),'agents',definition.id));
          const health=await executionHealth(definition.id),name=catalog.models.find(m=>m.id===health?.model)?.name;
          for(const model of catalog.models){const issue=health?.models?.[model.id]?.issue;if(issue)model.detail=issue==='balance'?'上次调用返回余额不足':issue==='model_unavailable'?'上次调用时，服务商已停用此型号':'上次调用失败，执行前请确认配置';}
          if(health?.issue===null&&catalog.models.some(m=>m.id===health.model))for(const model of catalog.models)model.isDefault=model.id===health.model;
          return {...base,version:catalog.version||base.version,ready:!!profile,state:'ready' as const,models:catalog.models,modelSource:'agent' as const,detail:health?.issue==='balance'?`接口已连接 · 上次 ${name||'所选模型'} 返回余额不足，可换模型或补充额度`:health?.issue==='model_unavailable'?`接口已连接 · 上次 ${name||'所选模型'} 被服务商停用，请选择其他型号`:health?.issue==='execution'?`接口已连接 · 上次 ${name||'所选模型'} 执行失败，查看运行日志确认服务商状态`:'原生会话接口已连接 · 登录额度在执行时校验',capabilities:{continuation:true,usage:definition.id==='minimax',streaming:true,history:false}};
        }catch(error){return {...base,state:/auth|login|登录/i.test((error as Error).message)?'not_logged_in' as const:'unreachable' as const,detail:(error as Error).message};}
        if (definition.id === 'workbuddy') try {
          const result=await probeWorkbuddyAgent(installation);base.models=result.models;base.modelSource='agent';
          const health=await executionHealth('workbuddy'),hasAuthFailure=health?.issue==='authentication'||Object.values(health?.models||{}).some(v=>v.issue==='authentication'),workingCustom=health?.issue===null&&health.model.startsWith('custom-local:')?health.model:Object.entries(health?.models||{}).find(([id,v])=>id.startsWith('custom-local:')&&v.issue===null)?.[0];
          if(hasAuthFailure||!result.hasAccount)for(const model of base.models)if(!model.id.startsWith('custom-local:')){if(!result.hasAccount)model.available=false;model.isDefault=false;model.detail=!result.hasAccount?'执行器未登录':health?.models?.[model.id]?.issue==='authentication'?'上次未获得执行器授权；完成官方登录后可重试':'内置通道曾返回授权失败；此型号尚未单独验证';}
          if(workingCustom)for(const model of base.models)model.isDefault=model.id===workingCustom;
          if(!base.models.some(m=>m.available!==false))return {...base,state:'not_logged_in' as const,detail:'独立执行器未获得授权；桌面已登录不代表此连接可执行'};
          return {...base,ready:!!profile,state:'ready' as const,detail:workingCustom?'自定义模型已真实验证 · 内置 auto 上次授权失败 · 桌面任务同步未验证':'持续执行器已接入 · 登录与模型权限以执行结果为准 · 桌面任务同步未验证',capabilities:{continuation:true,usage:true,streaming:true,history:false}};
        } catch(error) {return {...base,state:'unreachable' as const,detail:(error as Error).message};}
        return {...base,state:'unsupported' as const,detail:'已发现安装；该 Agent 的会话协议尚未适配'};
      }
      const profile=profiles.find(p=>p.agentId==='gpt'||p.id==='chatgpt-session');base.profileId=profile?.id||null;
      const client=rpcClient(installation,{timeout:15000});
      try {
        await client.initialize();const account=await client.request('account/read',{refreshToken:false});
        if(!account.account)return {...base,state:'not_logged_in' as const,detail:'已安装，请先在 GPT 本机执行器中登录'};
        const models:AgentModel[]=[];let cursor:string|undefined;
        do {const response=await client.request('model/list',{limit:100,...(cursor?{cursor}:{})});for(const m of response.data||[])if(!m.hidden&&typeof m.model==='string')models.push({id:m.model,name:m.displayName||m.model,family:/gpt-(\d+(?:\.\d+)?)/.exec(m.model)?.[1]||'其他',isDefault:!!m.isDefault});cursor=response.nextCursor||undefined;}while(cursor&&models.length<500);
        if(!models.length)throw new Error('Agent 未返回可用模型');
        return {...base,ready:!!profile,state:'ready' as const,models,modelSource:'agent' as const,detail:'程序已自动发现 · 模型来自当前 Agent · 支持逐轮会话',capabilities:{continuation:true,usage:true,streaming:true,history:true}};
      } catch(error) {return {...base,state:'unreachable' as const,detail:error instanceof Error?error.message:'Agent 连接失败'};} finally {client.close();}
    }));
    cached={at:Date.now(),value};return value;
  })().finally(()=>{pending=undefined});
  return pending;
}
