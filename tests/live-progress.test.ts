import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { readLiveProgress } from '../packages/core/live-progress';
import type { RunRecord } from '../packages/contracts';

test('实时进度仅返回当前尝试，拒绝伪造任务链接和符号链接', async () => {
  const previous = process.env.CASEBENCH_DATA_DIR;
  const dir = await mkdtemp('/private/tmp/casebench-live-'); process.env.CASEBENCH_DATA_DIR = dir;
  const runId = 'run_' + 'a'.repeat(32), resultId = 'result_' + 'b'.repeat(32), attemptId = 'attempt_' + 'c'.repeat(32);
  const run = { id: runId, results: [{ id: resultId, profileId: 'local', attempt: { id: attemptId } }] } as unknown as RunRecord;
  const folder = path.join(dir, 'runs', runId, resultId, attemptId), file = path.join(folder, 'live.json');
  const data = { threadId: '019a0000-1234-7123-8123-123456789abc', phase: 'running', model: 'reported-model', updatedAt: new Date().toISOString(), events: [], outputText: '实时正文' };
  try {
    assert.deepEqual(await readLiveProgress(run), []);
    await mkdir(folder, { recursive: true }); await writeFile(file, JSON.stringify(data));
    assert.equal((await readLiveProgress(run))[0].outputText, '实时正文');
    const retry = { ...run, results: [{ ...run.results[0], attempt: { ...run.results[0].attempt!, id: 'attempt_' + 'd'.repeat(32) } }] };
    assert.deepEqual(await readLiveProgress(retry), []);
    await writeFile(file, JSON.stringify({ ...data, threadId: 'javascript:alert(1)' }));
    assert.deepEqual(await readLiveProgress(run), []);
    await unlink(file); const source = path.join(dir, 'other.json'); await writeFile(source, JSON.stringify(data)); await symlink(source, file);
    assert.deepEqual(await readLiveProgress(run), []);
  } finally { if (previous === undefined) delete process.env.CASEBENCH_DATA_DIR; else process.env.CASEBENCH_DATA_DIR = previous; }
});

test('a running task clock advances while the model has no new text and stops after completion',async()=>{
 const before=process.env.CASEBENCH_DATA_DIR,dir=await mkdtemp('/private/tmp/live-clock-');process.env.CASEBENCH_DATA_DIR=dir;
 try{const runId='run_'+'a'.repeat(32),resultId='result_'+'b'.repeat(32),attemptId='attempt_'+'c'.repeat(32),run={id:runId,status:'running',results:[{id:resultId,profileId:'native',attempt:{id:attemptId,status:'running'}}]} as unknown as RunRecord,folder=path.join(dir,'runs',runId,resultId,attemptId);await mkdir(folder,{recursive:true});const at=Date.now()-60000;await writeFile(path.join(folder,'live.json'),JSON.stringify({threadId:'clock',phase:'running',model:'test',updatedAt:new Date(at).toISOString(),events:[],outputText:'',activeDurationMs:1500}));
 assert.ok((await readLiveProgress(run))[0].activeDurationMs!>=61500);run.results[0].attempt!.status='succeeded';assert.equal((await readLiveProgress(run))[0].activeDurationMs,1500);
 }finally{if(before===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=before;}
});
