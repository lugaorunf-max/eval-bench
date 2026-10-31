import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadProfiles, resolveFrozenProfile, stateDir } from '../../packages/core/config';
import { executeAdapter, collectOutputs, probeProfile, redact, readSessionOutput } from '../../packages/adapters/index';
import { UNKNOWN_USAGE, type RunRecord, type LocalProfile, type Usage, type ExecutionMetadata, type ExecutionStatus } from '../../packages/contracts/index';

process.env.CASEBENCH_ROOT ??= path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
function option(name: string, fallback?: string) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; }
const server = option('--server', process.env.CASEBENCH_SERVER || 'http://127.0.0.1:43110')!.replace(/\/$/, '');
const serverUrl = new URL(server);
if (!['http:', 'https:'].includes(serverUrl.protocol) || serverUrl.username || serverUrl.password || !['localhost', '127.0.0.1'].includes(serverUrl.hostname)) throw new Error('首版本地执行器仅连接本机开发网站。');
const authFile = path.join(stateDir(), `device-${createHash('sha256').update(server).digest('hex').slice(0, 12)}.json`);
let token = '', generation = 0;
const stop = new AbortController();
process.once('SIGINT', () => stop.abort(new Error('用户中止运行')));
process.once('SIGTERM', () => stop.abort(new Error('进程收到停止信号')));
async function request(route: string, method = 'GET', body?: unknown) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (generation) headers['x-casebench-lease'] = String(generation);
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(server + '/api/' + route, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
  return result;
}
async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
async function login(force = false) {
  if (!force) {
    try { token = JSON.parse(await readFile(authFile, 'utf8')).token; return; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const identity = await request('runner/register', 'POST', { name: os.hostname() });
  token = identity.token;
  await atomicJson(authFile, identity);
  console.log('本地执行器已连接网站。凭据仅保存在本机。');
}
interface Checkpoint {
  runId: string; resultId: string; attemptId: string; completed: boolean; synced: boolean;
  metadata?: ExecutionMetadata; status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled'; outputText: string; error: string | null;
  durationMs: number | null; usage: Usage; reportedModel: string | null; logs: string;
  files: { id: string; name: string; mime: string; path: string; sha256: string; size: number }[];
}
async function findCheckpoints(dir: string): Promise<{ file: string; data: Checkpoint }[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  const output = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) output.push(...await findCheckpoints(full));
    else if (e.name === 'checkpoint.json') output.push({ file: full, data: JSON.parse(await readFile(full, 'utf8')) as Checkpoint });
  }
  return output;
}
async function syncCheckpoint(file: string, cp: Checkpoint) {
  if (!cp.completed || cp.synced) return;
  for (const f of cp.files) {
    const bytes = await readFile(f.path);
    if (createHash('sha256').update(bytes).digest('hex') !== f.sha256) throw new Error(`产物校验失败 ${f.name}，不会上传已被修改的文件。`);
    const form = new FormData(); form.set('id', f.id); form.set('file', new Blob([bytes], { type: f.mime }), f.name);
    await request(`runner/runs/${cp.runId}/attempts/${cp.attemptId}/files`, 'POST', form);
  }
  await request(`runner/runs/${cp.runId}/attempts/${cp.attemptId}/complete`, 'POST', { status: cp.status, outputText: cp.outputText, error: cp.error, durationMs: cp.durationMs, usage: cp.usage, reportedModel: cp.reportedModel, metadata: cp.metadata || {}, logs: cp.logs });
  cp.synced = true; await atomicJson(file, cp);
  console.log(`  已归档 ${cp.resultId} · ${cp.status}`);
}
async function runCommand(runId: string, syncOnly: boolean) {
  if (!/^run_[a-f0-9]{32}$/.test(runId)) throw new Error('请提供网页创建的完整 run_id。');
  await login();
  const claim = await request(`runner/runs/${runId}/claim`, 'POST', {});
  generation = claim.generation;
  const run = claim.run as RunRecord;
  const profiles = await loadProfiles(option('--config'));
  const directory = path.join(stateDir(), 'runs', runId);
  await mkdir(directory, { recursive: true });
  console.log(`${run.spec.demo ? '演示运行（不调用外部模型）' : '真实模型运行'} ${runId}`);
  console.log(`  ${run.spec.cases.length} 个案例 × ${run.spec.models.length} 个配置 · 并发 ${run.spec.concurrency} · ${run.spec.timeoutSeconds ? `限时 ${run.spec.timeoutSeconds}s` : '不限时'}`);
  const heartbeat = setInterval(() => {
    void request(`runner/runs/${runId}/heartbeat`, 'POST', {}).catch(e => console.error(`  连接提示：${e.message}；本地产物继续保留。`));
  }, 15_000); heartbeat.unref();
  try {
    const checkpoints = await findCheckpoints(directory);
    for (const cp of checkpoints.filter(c => c.data.completed && !c.data.synced)) await syncCheckpoint(cp.file, cp.data);
    if (syncOnly) { console.log('本地已完成产物同步结束。'); return; }
    const current = await request(`runs/${runId}`) as RunRecord;
    const retry = argv.includes('--retry-failed');
    const tasks = current.results.filter(r => r.status === 'pending' || (retry && r.status !== 'succeeded'));
    if (!tasks.length) {
      const unfinished = current.results.filter(r => ['running', 'uploading'].includes(r.status));
      if (unfinished.length) throw new Error('有任务上次已启动但未确认结束。先执行 sync；确认需要重新付费调用时再使用 --retry-failed。');
      console.log('没有需要执行的任务，成功结果不会重复调用。'); return;
    }
    for (const m of run.spec.models) {
      const p = resolveFrozenProfile(m, profiles);
      if (!p) throw new Error(`执行配置「${m.name}」与发起时不一致，请恢复原配置或创建新的运行。`);
      const probe = await probeProfile(p);
      if (!probe.ready) throw new Error(`${m.name}：${probe.detail}`);
    }
    let next = 0, syncFailures = 0;
    const worker = async () => {
      for (;;) {
        if (stop.signal.aborted) return;
        const r = tasks[next++]; if (!r) return;
        const c = run.spec.cases.find(c => c.versionId === r.caseVersionId)!;
        const m = run.spec.models.find(m => m.id === r.profileId)!;
        const p = resolveFrozenProfile(m, profiles)!;
        const start = await request(`runner/runs/${runId}/attempts`, 'POST', { resultId: r.id, retry: r.status !== 'pending' });
        const attemptDir = path.join(directory, r.id, start.attemptId), outDir = path.join(attemptDir, 'out'), inDir = path.join(attemptDir, 'inputs');
        await mkdir(outDir, { recursive: true }); await mkdir(inDir, { recursive: true });
        const checkpointFile = path.join(attemptDir, 'checkpoint.json');
        const cp: Checkpoint = { runId, resultId: r.id, attemptId: start.attemptId, completed: false, synced: false, status: 'failed', outputText: '', error: null, durationMs: null, usage: { ...UNKNOWN_USAGE }, reportedModel: null, logs: '', files: [] };
        await atomicJson(checkpointFile, cp);
        console.log(`  开始 ${c.title} · ${m.name}`);
        const started = performance.now(), timeout = run.spec.timeoutSeconds ? AbortSignal.timeout(run.spec.timeoutSeconds * 1000) : null, signal = timeout ? AbortSignal.any([stop.signal, timeout]) : stop.signal;
        try {
          const inputPaths = [];
          for (const input of c.inputs) {
            const response = await fetch(`${server}/api/files/${input.id}`, { headers: { Authorization: `Bearer ${token}` }, signal });
            if (!response.ok) throw new Error(`无法下载输入素材 ${input.name}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) throw new Error(`输入素材校验不一致 ${input.name}`);
            const target = path.join(inDir, `${input.id}-${path.basename(input.name)}`);
            await writeFile(target, bytes); inputPaths.push(target);
          }
          const result = await executeAdapter({ case: c, model: m, profile: p, directory: attemptDir, outputDirectory: outDir, inputPaths, signal });
          cp.outputText = result.text; cp.metadata = result.metadata; cp.usage = result.usage; cp.reportedModel = result.reportedModel; cp.logs = redact(result.logs, profiles);
          cp.status = 'succeeded';
        } catch (e) {
          cp.status = timeout?.aborted ? 'timed_out' : stop.signal.aborted || (e instanceof Error && /用户停止/.test(e.message)) ? 'cancelled' : 'failed';
          cp.error = redact(e instanceof Error ? e.message : String(e), profiles); cp.logs = cp.error;
          console.error(`  ${c.title}：${cp.error}`);
        }
        if (!cp.metadata?.threadId) {
          const recovered = await readSessionOutput(outDir); cp.metadata = recovered.metadata;
          if (recovered.reportedModel) cp.reportedModel = recovered.reportedModel;
          if (recovered.usage.source === 'reported') cp.usage = recovered.usage;
          if (!cp.outputText) cp.outputText = recovered.text;
        }
        cp.durationMs = Math.round(performance.now() - started);
        try { cp.files = (await collectOutputs(outDir, p.outputExtensions)).map(f => ({ ...f, id: `file_${randomUUID().replaceAll('-', '')}` })); }
        catch (e) { cp.status = 'failed'; cp.error = e instanceof Error ? e.message : String(e); cp.files = []; }
        cp.completed = true;
        await atomicJson(checkpointFile, cp);
        try { await syncCheckpoint(checkpointFile, cp); }
        catch (e) { syncFailures++; console.error(`  上传暂未完成：${e instanceof Error ? e.message : String(e)}。文件已留在本地，恢复连接后执行 sync。`); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(run.spec.concurrency, tasks.length) }, worker));
    if (syncFailures) process.exitCode = 2;
    console.log(`\n查看结果：${server}/r/${runId}\n本地产物：${directory}`);
  } finally { clearInterval(heartbeat); }
}
async function main() {
  const [command, runId] = argv;
  if (command === 'login') { await login(true); return; }
  if (command === 'doctor') {
    const profiles = await loadProfiles(option('--config'));
    for (const p of profiles) { const result = await probeProfile(p); console.log(`${result.ready ? '✓' : '×'} ${p.name} · ${p.model} · ${result.detail}`); }
    return;
  }
  if (['run', 'resume', 'sync'].includes(command) && runId) return runCommand(runId, command === 'sync');
  console.log('Casebench 本地执行器\n\n  ./casebench doctor\n  ./casebench login\n  ./casebench run <run_id>\n  ./casebench resume <run_id>\n  ./casebench sync <run_id>\n\n先在网页创建运行，复制命令后执行。真实模型凭据只从本机环境读取。');
}
main().catch(e => { console.error(`\n${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1; });
