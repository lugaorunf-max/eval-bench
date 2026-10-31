import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import {createStore} from '../packages/core/db';
import {CasebenchService,now} from '../packages/core/service';
import {EditorialService} from '../packages/core/editorial';
import {ContentLibrary} from '../packages/core/content-library';
import {ensureVideoCover} from '../packages/core/video-cover';
import {runMediaCommand} from '../packages/core/media-runtime';
import {runInputSchema} from '../packages/contracts';
import {seedStore} from '../packages/core/seed';

test('tests default to unlimited, retain explicit limits longer than one hour and reject invalid limits',()=>{
 const body={concurrency:1,caseIds:['sample-copy'],models:[{profileId:'demo-a'}],requestKey:randomUUID()};
 assert.equal(runInputSchema.parse(body).timeoutSeconds,null);assert.equal(runInputSchema.parse({...body,timeoutSeconds:null}).timeoutSeconds,null);assert.equal(runInputSchema.parse({...body,timeoutSeconds:14400}).timeoutSeconds,14400);assert.equal(runInputSchema.parse({...body,timeoutSeconds:600}).timeoutSeconds,600);assert.throws(()=>runInputSchema.parse({...body,timeoutSeconds:-1}));
});
test('an observed runner exit preserves partial response and does not overwrite already completed attempts',async()=>{
 const dir=await mkdtemp('/private/tmp/runner-exit-'),store=await createStore(dir,':memory:'),s=new CasebenchService(store),old=process.env.CASEBENCH_DATA_DIR;process.env.CASEBENCH_DATA_DIR=dir;
 try{await seedStore(store);const r=await s.createRun({caseIds:['sample-copy'],models:[{profileId:'demo-a'}],concurrency:1,requestKey:randomUUID()}),device=await s.registerDevice('test'),lease=await s.claim(r.id,device.id),a=await s.beginAttempt(r.id,r.results[0].id,device.id,lease.generation),folder=path.join(dir,'runs',r.id,r.results[0].id,a.attemptId);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'live.json'),JSON.stringify({threadId:null,phase:'failed',model:'reported',updatedAt:now(),events:[],outputText:'已经收到的半段输出',activeDurationMs:123}));await s.runnerExited(r.id,'执行器异常退出');const ended=(await s.getRun(r.id)).results[0];assert.equal(ended.status,'failed');assert.equal(ended.attempt?.outputText,'已经收到的半段输出');assert.equal(ended.attempt?.durationMs,123);await s.runnerExited(r.id,'另一次退出');assert.equal((await s.getRun(r.id)).results[0].attempt?.error,'执行器异常退出');
 }finally{if(old===undefined)delete process.env.CASEBENCH_DATA_DIR;else process.env.CASEBENCH_DATA_DIR=old;await store.close();await rm(dir,{recursive:true,force:true});}
});
test('video covers reject black frames, persist selection and do not pollute the media library',async()=>{
 const dir=await mkdtemp('/private/tmp/video-cover-'),store=await createStore(dir,':memory:'),s=new CasebenchService(store),e=new EditorialService(s),library=new ContentLibrary(e);
 try{const videoPath=path.join(dir,'sample.mp4');await runMediaCommand(ffmpeg!,['-nostdin','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x100:d=0.5','-f','lavfi','-i','color=c=red:s=160x100:d=0.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-pix_fmt','yuv420p','-y',videoPath]);const video=await s.putFile(await readFile(videoPath),'case.mp4','video/mp4','reference'),cover=await ensureVideoCover(e,video);assert.ok(cover.frames.length>0&&cover.frames.length<6);assert.deepEqual(await ensureVideoCover(e,video),cover);assert.ok(!(await library.media()).some(m=>cover.frames.some(f=>f.id===m.id)));const candidate=await library.candidate({url:'https://x.com/test/status/3456',title:'测试视频',mediaIds:[video.id]});assert.equal((await library.cover('candidate',candidate.id))?.id,cover.defaultId);const manual=await s.putFile(Buffer.from('manual'),'manual.png','image/png','reference');await library.patch('candidate',candidate.id,{coverFileId:manual.id,summary:'经整理的画面描述'});assert.equal((await library.cover('candidate',candidate.id))?.id,manual.id);assert.equal((await library.meta('candidate',candidate.id)).summary,'经整理的画面描述');
 }finally{await store.close();await rm(dir,{recursive:true,force:true});}
});
