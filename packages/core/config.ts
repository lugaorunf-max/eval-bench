import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { findAgent } from '../../scripts/agent-runtime.mjs';
import { SESSION_PROFILES } from '../../scripts/native-agents.mjs';
import type { FrozenModel, LocalProfile, Profile } from '../contracts/index';

export function projectRoot() { return process.env.CASEBENCH_ROOT || process.cwd(); }
export function stateDir() { return process.env.CASEBENCH_DATA_DIR || path.join(projectRoot(), '.casebench'); }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function publicProfile(p: LocalProfile): Profile & { configHash: string } {
  return { id: p.id, name: p.name, vendor: p.vendor, model: p.model, adapter: p.adapter, color: p.color, modes: p.modes, supportsTemperature: p.supportsTemperature, agentId: p.agentId, configHash: p.discovered ? digest({ id: p.id, agentId: p.agentId, adapter: p.adapter, modes: p.modes, supportsTemperature: p.supportsTemperature }) : digest(p), parameters: { ...(p.requestParams || {}), ...(p.maxTokens ? { max_tokens: p.maxTokens } : {}) }, tool: p.program ? path.basename(p.program) : p.adapter, harnessVersion: p.adapter === 'demo' ? 'casebench-demo-0.1.0' : p.adapter === 'api' ? 'casebench-api-0.1.0' : p.harnessVersion || 'unknown' };
}
export const DEMO_PROFILES: LocalProfile[] = [
  { id: 'demo-a', name: '演示执行器 A', vendor: '本地演示', model: 'demo-a', adapter: 'demo', color: '#16816b', modes: ['text', 'html', 'harness'], supportsTemperature: false },
  { id: 'demo-b', name: '演示执行器 B', vendor: '本地演示', model: 'demo-b', adapter: 'demo', color: '#526cce', modes: ['text', 'html', 'harness'], supportsTemperature: false }
];
const profileSchema = z.object({
  agentId: z.string().max(100).optional(), discovered: z.boolean().optional(),
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,80}$/i), name: z.string().min(1).max(100),
  vendor: z.string().max(100), model: z.string().min(1).max(200),
  adapter: z.enum(['api', 'command']), color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#486dce'),
  modes: z.array(z.enum(['text', 'html', 'harness'])).min(1), supportsTemperature: z.boolean().default(false),
  baseUrl: z.string().url().optional(), apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  requestParams: z.record(z.string(), z.unknown()).optional(), maxTokens: z.number().int().positive().max(100000).optional(),
  program: z.string().min(1).optional(), args: z.array(z.string()).max(100).optional(),
  outputExtensions: z.array(z.string().regex(/^\.[a-z0-9]+$/i)).optional(),
  harnessVersion: z.string().max(200).optional()
}).strict().superRefine((p, ctx) => {
  if (p.adapter === 'api' && (!p.baseUrl || !p.apiKeyEnv)) ctx.addIssue({ code: 'custom', message: 'API 配置需要 baseUrl 和 apiKeyEnv' });
  if (p.adapter === 'command' && !p.program) ctx.addIssue({ code: 'custom', message: '工具配置需要 program' });
  if (p.id.startsWith('demo-')) ctx.addIssue({ code: 'custom', message: 'demo- 是保留前缀' });
  function checkSecrets(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/api.?key|authorization|password|secret|access.?token/i.test(key)) ctx.addIssue({ code: 'custom', message: 'requestParams 不能含凭据，请使用本机环境变量' });
      checkSecrets(child);
    }
  }
  checkSecrets(p.requestParams);
  if (p.requestParams && ['model', 'messages', 'stream'].some(k => k in p.requestParams!)) ctx.addIssue({ code: 'custom', message: 'model、messages 和 stream 由执行器管理，请勿写入 requestParams' });
});
export async function loadProfiles(configPath = process.env.CASEBENCH_CONFIG || path.join(stateDir(), 'config.json')): Promise<LocalProfile[]> {
  let profiles: LocalProfile[] = [];
  try {
    const parsed = z.object({ profiles: z.array(profileSchema).max(20) }).parse(JSON.parse(await readFile(configPath, 'utf8')));
    if (new Set(parsed.profiles.map(p => p.id)).size !== parsed.profiles.length) throw new Error('执行配置 ID 重复');
    profiles = parsed.profiles as LocalProfile[];
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (process.env.CASEBENCH_DISABLE_DISCOVERY !== '1' && await findAgent('gpt')) {
    const old = profiles.find(p => p.id === 'chatgpt-session');
    // Migrate only our own legacy harness; preserve user-supplied command adapters.
    if (!old || old.args?.some(a => /desktop-harness\.mjs$/.test(a))) {
      profiles = profiles.filter(p => p.id !== 'chatgpt-session');
      profiles.push({ id: 'chatgpt-session', agentId: 'gpt', discovered: true, name: 'GPT 桌面端', vendor: 'OpenAI', model: 'default', adapter: 'command', color: '#242832', modes: ['text','html'], supportsTemperature: false, program: process.execPath, args: [path.join(projectRoot(), 'scripts/desktop-harness.mjs'), 'chatgpt-session'], harnessVersion: 'casebench-session-0.4' });
    }
  }
  if (process.env.CASEBENCH_DISABLE_DISCOVERY !== '1') for (const [agentId,name,vendor,color] of [['workbuddy','WorkBuddy','Tencent','#16816b'],['deepseek','DeepSeek Harness','DeepSeek','#4d6bfe'],['minimax','MiniMax Code','MiniMax','#e65463']]) {
    if (!await findAgent(agentId)) continue;
    const id=SESSION_PROFILES[agentId];
    if(profiles.some(p=>p.id===id&&!p.discovered))continue;
    profiles=profiles.filter(p=>p.id!==id);
    profiles.push({id,agentId,discovered:true,name,vendor,model:'default',adapter:'command',color,modes:['text','html'],supportsTemperature:false,program:process.execPath,args:[path.join(projectRoot(),'scripts/native-harness.mjs'),agentId],harnessVersion:'casebench-native-0.5'});
  }
  return [...DEMO_PROFILES, ...profiles];
}

export function resolveFrozenProfile(model: FrozenModel, profiles: LocalProfile[]) {
  const p = profiles.find(p => p.id === (model.baseProfileId || model.id));
  return p && publicProfile(p).configHash === model.configHash ? p : undefined;
}
