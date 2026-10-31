import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {HotspotsBridge} from '../packages/core/hotspots/bridge';
import {EditorialService} from '../packages/core/editorial';
import {ArticleMaterialsService} from '../packages/core/article-materials';
import {workspaceNavigation} from '../apps/web/components/workspace-navigation';
import {GET,POST} from '../apps/web/app/api/hotspots/[...path]/route';

test('hotspots imports preserve provenance, deduplicate, and keep article references separate from prose',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'hotspots-')),before=process.env.CASEBENCH_ROOT;
 const event={id:'event-1',title:'事件标题',summary:'选题摘要',product:'产品',field:'AI与大模型',publishedAt:null};
 const entry={id:'case-1',eventId:event.id,title:'外部案例',summary:'原文摘要不是提示词',url:'https://example.com/case',conditions:'条件',notes:'笔记'};
 const server=createServer((req,res)=>{if(req.headers['x-hotspots-bridge']!=='fixture-key'){res.writeHead(403).end();return;}if(req.url?.startsWith('/api/admin/monitor/assets/')){res.writeHead(200,{'content-type':'image/png'}).end(Buffer.from('actual-fixture-bytes'));return;}if(req.url==='/api/admin/monitor/local-sources'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const d=JSON.parse(body);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({links:d.sources.map((s:any)=>({sourceId:s.id,eventId:'legacy-event'}))}));});return;}res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({event:req.url?.endsWith('/legacy-event')?{...event,id:'legacy-event',title:'旧选题'}:event,cases:[entry],reports:[{url:'https://example.com/event'}],assets:[],experiments:[{experimentId:'experiment-1',input:'人工输入',output:'人工结果',version:'v1',conclusion:'人工结论'}]}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 await mkdir(path.join(dir,'integrations/hot-monitor/.data'),{recursive:true});await writeFile(path.join(dir,'integrations/hot-monitor/.data/bridge.json'),JSON.stringify({port,key:'fixture-key'}));process.env.CASEBENCH_ROOT=dir;
 const store=await createStore(path.join(dir,'state'),':memory:'),s=new CasebenchService(store),bridge=new HotspotsBridge(s),e=new EditorialService(s);
 try{
  const a=await bridge.source(event.id),b=await bridge.source(event.id);assert.equal(a.id,b.id);assert.equal((await e.list('source')).length,1);
  const c=await bridge.source(event.id,entry.id);assert.notEqual(c.id,a.id);assert.match(c.summary,/条件/);
  await assert.rejects(()=>bridge.test(event.id,entry.id,{prompt:''}),/./);
  const runCase=await bridge.test(event.id,entry.id,{prompt:'用户确认的完整提示词',artifactType:'web'});const again=await bridge.test(event.id,entry.id,{prompt:'后续另一段文字',artifactType:'web'});assert.equal(runCase?.id,again?.id);assert.equal((await s.listCases()).length,1);assert.equal(runCase?.prompt,'用户确认的完整提示词');
  const media=await bridge.asset('asset-1');const mediaAgain=await bridge.asset('asset-1');assert.equal(media.id,mediaAgain.id);assert.equal((await e.list('prepared-media')).length,1);
  const instance=await bridge.experiment(event.id,'experiment-1');assert.equal(instance.origin,'manual');assert.equal(instance.metrics,undefined);assert.equal((await bridge.experiment(event.id,'experiment-1')).id,instance.id);
  let article=await e.create({title:'文章'});article=await new ArticleMaterialsService(e).references(article.id,{revision:article.revision,add:[{kind:'source',id:c.id}]});assert.equal(article.references.length,1);assert.equal(article.document?.content?.some(n=>JSON.stringify(n).includes(c.summary)),false);
  const globalState=globalThis as typeof globalThis & {casebenchStore?:Promise<any>};const previousStore=globalState.casebenchStore;globalState.casebenchStore=Promise.resolve(store);
  const legacy=await e.addSource({title:'旧选题',summary:'旧参考资料'});let oldArticle=await e.create({title:'已有稿件',references:[{kind:'source',id:legacy.id}]});const snapshot=JSON.stringify(oldArticle.references);await bridge.reconcile();await bridge.reconcile();assert.equal((await bridge.source('legacy-event')).id,legacy.id);assert.deepEqual((await e.article(oldArticle.id)).references,JSON.parse(snapshot));assert.equal((await bridge.usage())['legacy-event'],1);
  const ctx=(p:string[])=>({params:Promise.resolve({path:p})});
  for(const p of [['feed'],['journals'],['legacy','item','1']]){const r=await GET(new Request('http://127.0.0.1/api/hotspots/'+p.join('/'),{headers:{host:'127.0.0.1'}}),ctx(p));assert.equal(r.status,404);}
  const same=await POST(new Request('http://localhost/api/hotspots/bridge/source/event-1',{method:'POST',headers:{host:'127.0.0.1',origin:'http://127.0.0.1','content-type':'application/json'},body:'{}'}),ctx(['bridge','source','event-1']));assert.equal(same.status,200);globalState.casebenchStore=previousStore;
  const cross=await POST(new Request('http://127.0.0.1/api/hotspots/events',{method:'POST',headers:{host:'127.0.0.1',origin:'https://external.example','content-type':'application/json'},body:'{}'}),ctx(['events']));assert.equal(cross.status,403);
  assert.equal(workspaceNavigation('/hotspots').active,'hotspots');assert.deepEqual(workspaceNavigation('/hotspots/cases').items.map(i=>i.label),['选题']);assert.equal(workspaceNavigation('/topics').active,'hotspots');assert.equal(workspaceNavigation('/r/run_1').active,'testing');assert.deepEqual(workspaceNavigation('/').items.map(i=>i.label),['测试案例库','实测记录']);assert.equal(workspaceNavigation('/materials').active,'materials');assert.deepEqual(workspaceNavigation('/write').items.map(i=>i.label),['资料','写作']);
 }finally{if(before===undefined)delete process.env.CASEBENCH_ROOT;else process.env.CASEBENCH_ROOT=before;await store.close();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
