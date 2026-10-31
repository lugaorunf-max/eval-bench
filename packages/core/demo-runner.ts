import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { loadProfiles, projectRoot, resolveFrozenProfile, stateDir } from './config';
import { AppError, CasebenchService } from './service';
import { probeProfile } from '../adapters';
import type { LocalProfile, RunRecord } from '../contracts';

const state = globalThis as unknown as { casebenchDemos?: Set<string> };
const active = state.casebenchDemos ??= new Set();
export async function startDemo(service: CasebenchService, runId: string, origin: string) {
  const run = await service.getRun(runId);
  if (!run.spec.demo || run.spec.models.some(p => p.adapter !== 'demo')) throw new AppError(400, '网页演示入口只运行演示执行器，真实模型请使用本机命令。');
  return launch(service, run, runId, origin);
}
export function validateLocalProfiles(run: RunRecord, profiles: LocalProfile[]) {
  if (run.spec.demo || run.spec.models.some(m => m.adapter !== 'command')) throw new AppError(400, '这个入口只启动已在本机配置的命令行工具。');
  return run.spec.models.map(m => {
    const p = resolveFrozenProfile(m, profiles);
    if (!p || p.adapter !== 'command') throw new AppError(409, `执行配置「${m.name}」已变化，请重新创建运行。`);
    return p;
  });
}
export async function startLocalRun(service: CasebenchService, runId: string, origin: string) {
  const run = await service.getRun(runId);
  for (const p of validateLocalProfiles(run, await loadProfiles())) {
    const probe = await probeProfile(p);
    if (!probe.ready) throw new AppError(400, `${p.name}：${probe.detail}`);
  }
  return launch(service, run, runId, origin);
}
async function launch(service:CasebenchService,run: RunRecord, runId: string, origin: string) {
  if (active.has(runId)) return { started: true };
  if (!run.results.some(r => r.status === 'pending')) throw new AppError(409, '这批任务已启动或结束，请查看结果。');
  const root = projectRoot();
  await mkdir(path.join(stateDir(), 'logs'), { recursive: true });
  const log = await open(path.join(stateDir(), 'logs', `${runId}.log`), 'a', 0o600);
  active.add(runId);
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'apps/cli/index.ts'), 'run', runId, '--server', origin], {
      cwd: root, env: { ...process.env, CASEBENCH_ROOT: root }, shell: false,
      stdio: ['ignore', log.fd, log.fd], detached: false
    });
    let observed=false;const ended=(reason:string)=>{if(observed)return;observed=true;active.delete(runId);void service.runnerExited(runId,reason).catch(e=>console.error('执行器退出状态保存失败',e));};
    child.once('error',e=>ended('执行器未能启动：'+e.message));
    child.once('exit',(code,signal)=>ended(`执行器已退出（${signal||code}），保留已收到的输出和文件。`));
    child.unref();
    return { started: true };
  } finally { await log.close(); }
}
