import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createMediaToolSession,mediaToolRequest,toolText} from '../packages/core/media-tool-session';
import {xPostUrl} from '../packages/core/media-runtime';
import {deliverWriting} from '../packages/core/writing-delivery';
import {UNKNOWN_USAGE} from '../packages/contracts';
import {fixtureKnowledge,citedReply} from './fixtures/writing-knowledge';
import {knowledgeArticles} from '../packages/core/writing-citations';
import {chromeMediaControl,chromeMediaRequest,chromeMediaStatus} from '../packages/core/chrome-media-bridge';
import {importWritingImages} from '../packages/core/writing-web-media';
import {markdownDocument} from '../packages/core/writing-document';

test('tool sessions restrict names, serialize calls, isolate credentials and expire on close',async()=>{
 const dir=await mkdtemp('/private/tmp/casebench-media-tools-');let release!:()=>void;const wait=new Promise<void>(r=>release=r),calls:string[]=[];
 const s=await createMediaToolSession('http://127.0.0.1:43110',dir,[{name:'only_this',description:'scoped',inputSchema:{type:'object'}}],async name=>{calls.push(name);await wait;return toolText('actual');});
 try{const config=JSON.parse(await readFile(s.file,'utf8'));assert.equal((await mediaToolRequest({...config,method:'list'}) as any).tools.length,1);await assert.rejects(mediaToolRequest({...config,token:'x'.repeat(64),method:'list'}),/失效/);await assert.rejects(mediaToolRequest({...config,method:'call',name:'write_files'}),/未开放/);const first=mediaToolRequest({...config,method:'call',name:'only_this',arguments:{}});await assert.rejects(mediaToolRequest({...config,method:'call',name:'only_this'}),/等待/);release();assert.match(JSON.stringify(await first),/actual/);assert.deepEqual(calls,['only_this']);s.close();await assert.rejects(mediaToolRequest({...config,method:'list'}),/失效/);}finally{s.close();await rm(dir,{recursive:true,force:true});}
});
test('X post identity rejects search pages and unrelated download hosts',()=>{assert.equal(xPostUrl('https://x.com/name/status/12345?s=20').id,'12345');assert.throws(()=>xPostUrl('https://x.com/search?q=demo'));assert.throws(()=>xPostUrl('https://example.com/name/status/12345'));assert.throws(()=>xPostUrl('http://x.com/name/status/12345'));});
test('Chrome bridge sends only queued X operations to the paired client and settles replies once',async()=>{
 const auth={clientId:'testclient12345678',secret:'a'.repeat(64)};chromeMediaControl({...auth,operation:'connect'});assert.equal(chromeMediaStatus().connected,true);
 try{assert.throws(()=>chromeMediaControl({...auth,secret:'b'.repeat(64),operation:'poll'}),/无效/);const work=chromeMediaRequest('search',{query:'voxel demo'}),next=chromeMediaControl({...auth,operation:'poll'}) as any;assert.equal(next.command.type,'search');assert.equal(next.command.query,'voxel demo');assert.equal((chromeMediaControl({...auth,operation:'poll'}) as any).command,null);chromeMediaControl({...auth,operation:'result',id:next.command.id,result:{results:[{url:'https://x.com/test/status/123'}]}});assert.equal((await work).results.length,1);const controller=new AbortController(),cancelled=chromeMediaRequest('post',{url:'https://x.com/test/status/123'},controller.signal);controller.abort();await assert.rejects(cancelled,/取消/);assert.equal(chromeMediaStatus().pending,0);}finally{chromeMediaControl({...auth,operation:'disconnect'});}
});
test('known article videos and GIFs become real media nodes, while an unrelated local file cannot be inserted by guessed Markdown',async()=>{
 const make=(id:string,mime:string)=>({id,name:id,mime,size:100,sha256:'a'.repeat(64),role:'reference' as const,createdAt:new Date().toISOString()}),video=make('video_known','video/mp4'),gif=make('gif_known','image/gif');
 const text='正文\n\n![视频](/api/files/video_known)\n\n![动图](/api/files/gif_known)\n\n![其他文章](/api/files/unrelated)';
 const imported=await importWritingImages({} as any,text,[],undefined,[video,gif]);assert.deepEqual(imported.files.map(f=>f.id),[video.id,gif.id]);assert.equal(imported.byUrl['/api/files/unrelated'],undefined);
 const document=markdownDocument(text,imported.byUrl);assert.equal(document.content?.filter(n=>n.type==='writingMedia').length,2);assert.ok(document.content?.some(n=>n.type==='writingMedia'&&n.attrs?.fileId===video.id));
});
test('missing writing body gets exactly one bounded repair and preserves citation checks and both usages',async()=>{
 const directory=await mkdtemp('/private/tmp/casebench-delivery-'),articles=knowledgeArticles(fixtureKnowledge().context);let calls=0;
 try{const task:any={directory,outputDirectory:directory,case:{prompt:'写真实文章'},signal:new AbortController().signal};const result=await deliverWriting(task,articles,async retry=>{calls++;if(calls===2)assert.match(retry.case.prompt,/markdown 必须含实际文稿/);return {text:calls===1?' {"action":"edit","reply":"已经完成"}':citedReply('# 可验证的正文\n\n实际内容。','edit'),usage:{...UNKNOWN_USAGE,inputTokens:10,outputTokens:5,source:'reported'},logs:'',reportedModel:'test'};});assert.equal(calls,2);assert.equal(result.repaired,true);assert.equal(result.output.usage.inputTokens,20);assert.match(result.reply.text,/实际内容/);
 let badCalls=0;await assert.rejects(deliverWriting(task,articles,async()=>{badCalls++;return {text:'{"action":"edit","markdown":"有文稿但没有真实引用"}',usage:UNKNOWN_USAGE,logs:'',reportedModel:null};}));assert.equal(badCalls,2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
