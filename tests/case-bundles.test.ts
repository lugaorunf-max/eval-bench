import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {EditorialService} from '../packages/core/editorial';
import {ContentLibrary} from '../packages/core/content-library';
import {readCaseBundle,importCaseBundle,planCaseBundle} from '../packages/core/case-bundles';

const bundlePath=path.resolve('data/case-library/kimi-2026-10/manifest.json');
test('the Kimi bundle contains verified literal prompts, distinct Feishu sections and complete portable assets',async()=>{
 const b=await readCaseBundle(bundlePath);assert.equal(b.data.cases.length,13);assert.equal(b.data.pending.length,2);assert.equal(new Set(b.data.cases.map(c=>c.provenance.documentUrl)).size,13);
 for(const c of b.data.cases){assert.equal(createHash('sha256').update(b.prompts.get(c.key)!).digest('hex'),c.prompt.sha256);assert.ok(b.assets.has(c.reference.path));assert.ok(c.scenes!.length>1);assert.equal(c.artifactType,'web');assert.ok(c.provenance.sessionId);}
 assert.ok(b.data.pending.every(c=>!('prompt' in c)));assert.ok(b.data.cases.find(c=>c.key==='amber-kingdom')!.followups.some(f=>f.text.includes('10s')));
});
test('bundle import keeps references separate from execution, preserves original cases and is repeatable',async()=>{
 const directory=await mkdtemp('/private/tmp/case-bundle-'),store=await createStore(directory,':memory:'),s=new CasebenchService(store),e=new EditorialService(s),lib=new ContentLibrary(e);
 try{const b=await readCaseBundle(bundlePath);b.data.cases=b.data.cases.filter(c=>['train','bicycle'].includes(c.key));b.data.pending=b.data.pending.filter(c=>c.key==='robot');const existing=await s.saveCase({title:'已有自定义标题',prompt:b.prompts.get('train'),scene:'code',capabilities:['coding'],artifactType:'web',executionMode:'html',inputIds:[],referenceId:null,instructions:''});await s.updateCaseMetadata(existing.id,{favorite:true});
 const before=await planCaseBundle(s,b);assert.equal(before.create,1);assert.equal(before.reuse,1);const result=await importCaseBundle(s,b);assert.equal(result.bindings.length,3);assert.equal((await s.listCases()).length,2);assert.equal((await s.listRuns()).length,0);assert.equal((await e.instances()).length,0);const updated=(await s.listCases()).find(c=>c.id===existing.id)!;assert.equal(updated.title,'已有自定义标题');assert.equal(updated.favorite,true);assert.equal(updated.prompt,existing.prompt);assert.equal(updated.instructions,'');assert.ok(updated.reference?.mime.startsWith('video/'));
 const binding=result.bindings.find(v=>v.key==='train')!;assert.equal((await lib.cover('case',existing.id))!.id,binding.coverId);const media=await lib.media();assert.ok(media.some(v=>v.id===binding.referenceId));assert.ok(!media.some(v=>v.id===binding.coverId));assert.equal((await lib.candidates()).length,1);
 const repeat=await importCaseBundle(s,b);assert.equal(repeat.create,0);assert.deepEqual(repeat.bindings,result.bindings);assert.equal((await s.listCases()).length,2);assert.equal((await lib.collections()).length,1);assert.equal((await lib.media()).length,3);assert.equal((await lib.candidates()).length,1);
 await s.saveCase({...updated,prompt:'人工调整后的提示词',inputIds:[],referenceId:updated.reference!.id,expectedVersion:updated.version},updated.id);await assert.rejects(planCaseBundle(s,b),/已被修改/);assert.equal((await s.listCases()).find(c=>c.id===existing.id)!.prompt,'人工调整后的提示词');
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('bundle verification rejects traversal, corruption and duplicate case keys before database writes',async()=>{
 const directory=await mkdtemp('/private/tmp/case-bundle-invalid-');try{const original=JSON.parse(await readFile(bundlePath,'utf8')),manifest=structuredClone(original);manifest.cases[0].prompt.path='../outside.md';const file=path.join(directory,'manifest.json');await writeFile(file,JSON.stringify(manifest));await assert.rejects(readCaseBundle(file),/包目录内/);manifest.cases.push(manifest.cases[0]);await writeFile(file,JSON.stringify(manifest));await assert.rejects(readCaseBundle(file),/重复编号/);
 manifest.cases=[original.cases[0]];manifest.pending=[];await mkdir(path.join(directory,'prompts'));await mkdir(path.join(directory,'media'));await writeFile(path.join(directory,manifest.cases[0].prompt.path),await readFile(path.resolve(path.dirname(bundlePath),manifest.cases[0].prompt.path)));await writeFile(path.join(directory,manifest.cases[0].reference.path),'corrupted');await writeFile(file,JSON.stringify(manifest));await assert.rejects(readCaseBundle(file),/素材校验失败/);
 manifest.cases.push({...manifest.cases[0],key:'duplicate-prompt'});await writeFile(file,JSON.stringify(manifest));await assert.rejects(readCaseBundle(file),/重复提示词/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
