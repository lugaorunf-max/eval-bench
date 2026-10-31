import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {createMediaBridge} from '../integrations/hot-monitor/modules/hot-monitor/extension/media-bridge.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
test('existing collector gains only a local workspace bridge, without cookie, debugger or all-sites access',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../integrations/hot-monitor/modules/hot-monitor/extension/manifest.json',import.meta.url)));
 assert.equal(manifest.version,'2.4.0');assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert.ok(manifest.content_scripts.some(c=>c.js.includes('media-workspace.js')));assert.ok(manifest.host_permissions.every(h=>/^http:\/\/(localhost|127\.0\.0\.1):43110\//.test(h)));
});
test('bridge uses only the toolbar-selected X tab and rejects outside-page commands and forged senders',async()=>{
 const state={},results=[];let next=null;const api={runtime:{id:'extension-test'},storage:{session:{get:async key=>({[key]:state[key]}),set:async v=>Object.assign(state,v),remove:async key=>delete state[key]}},tabs:{get:async id=>({id,url:'https://x.com/home',windowId:1}),update:async()=>{throw Error('should never navigate to a foreign host');}},action:{setBadgeText:async()=>{},setTitle:async()=>{}},scripting:{executeScript:async({args})=>{const p=args[0];if(p.operation==='poll')return [{result:{command:next}}];if(p.operation==='result'){results.push(p);return [{result:{ok:true}}];}return [{result:{connected:true}}];}}};
 const bridge=createMediaBridge(api),sender={id:'extension-test',frameId:0,url:'http://127.0.0.1:43110/write',tab:{id:3}};
 await assert.rejects(bridge.handle({type:'HM_MEDIA_CONNECT'},sender),/授权 X 网站访问/);await bridge.select({id:9,url:'https://x.com/home',windowId:1});assert.equal((await bridge.handle({type:'HM_MEDIA_CONNECT'},sender)).connected,true);
 await assert.rejects(bridge.handle({type:'HM_MEDIA_POLL'},{...sender,url:'https://x.com/'}),/本机/);
 next={id:'test-command',type:'post',url:'https://example.com/private'};await bridge.handle({type:'HM_MEDIA_POLL'},sender);assert.match(results[0].error,/仅支持指定的 X/);assert.equal(results[0].id,'test-command');
});

import {createLibraryCollector} from '../integrations/hot-monitor/modules/hot-monitor/extension/collector-v2.mjs';
test('manual collection does not select an AI tab or require a topic; destinations are optional and distinct',async()=>{
 const calls=[],selections=[];const api={runtime:{id:'collector-v2',getManifest:()=>({version:'2.0.0'})},tabs:{query:async()=>[{id:1,url:'http://127.0.0.1:43110/write'}],get:async id=>({id,url:'https://x.com/author/status/12345'}),sendMessage:async(...args)=>calls.push(args)},action:{setTitle:async()=>{}},scripting:{executeScript:async input=>{calls.push(input);return [{result:input.args?.[0]?.route==='targets'?{articles:[],events:[]}:{candidate:{id:'candidate-test'}}}];}}};
 const controller=createLibraryCollector(api,{select:async tab=>selections.push(tab.id)}),sender={id:'collector-v2',frameId:0,tab:{id:9}};
 await controller.toolbar({id:9,url:'https://x.com/author/status/12345'});assert.deepEqual(selections,[]);assert.ok(calls.some(c=>Array.isArray(c)&&c[1].type==='HM_LIBRARY_SHOW'));
 const item={url:'https://x.com/author/status/12345',title:'真实原帖标题',summary:'原帖内容'};await controller.handle({type:'HM_LIBRARY_SAVE',intent:'case',item},sender);let saved=calls.find(c=>c.args?.[0]?.route==='collect').args[0].body;assert.equal(saved.intent,'case');assert.equal(saved.eventId,undefined);assert.equal(saved.articleId,undefined);
 calls.length=0;await controller.handle({type:'HM_LIBRARY_SAVE',intent:'media',destination:'article:article_test',item},sender);saved=calls.find(c=>c.args?.[0]?.route==='collect').args[0].body;assert.equal(saved.intent,'media');assert.equal(saved.articleId,'article_test');assert.equal(saved.eventId,undefined);
 await controller.handle({type:'HM_LIBRARY_CONNECT'},sender);assert.deepEqual(selections,[9]);await assert.rejects(controller.handle({type:'HM_LIBRARY_SAVE',intent:'case',item},{...sender,id:'forged'}),/无效/);assert.equal((await controller.handle({type:'HM_AUTO_BOOT'},sender)).shown,false);
});

test('server restart errors survive the isolated script boundary and restore the explicitly selected X tab',async()=>{
 const state={},calls=[];let paired=false;const oldLocation=globalThis.location,oldFetch=globalThis.fetch;
 globalThis.location={origin:'http://127.0.0.1:43110'};globalThis.fetch=async(_url,init)=>{const p=JSON.parse(init.body);calls.push(p.operation);if(p.operation==='connect')paired=true;return {ok:paired,json:async()=>paired?{command:null,connected:true}:{error:'Chrome 采集连接无效，请重新连接'}};};
 const api={runtime:{id:'restart-test'},storage:{session:{get:async key=>({[key]:state[key]}),set:async v=>Object.assign(state,v),remove:async key=>delete state[key]}},tabs:{get:async id=>({id,url:'https://x.com/home',windowId:1})},action:{setBadgeText:async()=>{},setTitle:async()=>{}},scripting:{executeScript:async({func,args})=>{try{return [{result:await func(...args)}];}catch{return [{result:undefined}];}}}};
 try{const bridge=createMediaBridge(api),sender={id:'restart-test',frameId:0,url:'http://127.0.0.1:43110/articles/test',tab:{id:3}};await bridge.select({id:9,url:'https://x.com/home',windowId:1});await bridge.handle({type:'HM_MEDIA_CONNECT'},sender);paired=false;assert.equal((await bridge.handle({type:'HM_MEDIA_POLL'},sender)).connected,true);assert.deepEqual(calls,['connect','poll','connect']);assert.equal(state.casebenchXTab.tabId,9);}finally{globalThis.location=oldLocation;globalThis.fetch=oldFetch;}
});

test('a translated X page is read in the publisher original language before extracting a public prompt',async()=>{
 const {runInNewContext}=await import('node:vm'),source=await readFile(new URL('../integrations/hot-monitor/modules/hot-monitor/extension/media-bridge.mjs',import.meta.url),'utf8');let original=false;
 const link={href:'https://x.com/a/status/123',querySelector:()=>({dateTime:'2026-10-30'})},button={textContent:'显示原文',click:()=>{original=true;}},article={querySelectorAll:selector=>selector==='a[href]'?[link]:selector==='[data-testid="tweetPhoto"] img'?[]:[button],querySelector:selector=>selector==='[data-testid="tweetText"]'?{innerText:original?'Build a blue cube.':'生成一个蓝色方块。'}:null,scrollIntoView:()=>{},getBoundingClientRect:()=>({x:0,y:0,width:500,height:300})};
 const read=runInNewContext(source.slice(source.indexOf('async function readPostDocument'),source.indexOf('async function readSearchDocument'))+';readPostDocument',{URL,document:{querySelectorAll:()=>[article]},location:{href:link.href},setTimeout:f=>{f();return 0;},window:{scrollBy:()=>{}},innerWidth:1000,innerHeight:800,performance:{getEntriesByType:()=>[]}});
 assert.equal((await read('123')).text,'Build a blue cube.');
});

import {createResultCapture} from '../integrations/hot-monitor/modules/hot-monitor/extension/result-capture.mjs';
test('result capture freezes the target, requires a matching effect tab and rejects outside-page uploads',async()=>{
 const state={},windows=[],api={runtime:{id:'capture-test',getURL:p=>'chrome-extension://capture-test/'+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},windows:{create:async v=>windows.push(v)}};
 const c=createResultCapture(api),target={instanceId:'attempt_'+'a'.repeat(32),title:'方块小屋',url:'http://127.0.0.1:40000/11111111-1111-1111-1111-111111111111/result.html'},sender={id:api.runtime.id,frameId:0,url:'http://127.0.0.1:43110/instances'};
 await assert.rejects(c.handle({type:'HM_CAPTURE_TARGET',target},{...sender,url:'https://x.com/'}),/无效/);await c.handle({type:'HM_CAPTURE_TARGET',target},sender);assert.equal(await c.toolbar({id:3,url:'https://example.com'}),false);assert.equal(await c.toolbar({id:4,windowId:1,url:target.url}),true);const id=new URL(windows[0].url).searchParams.get('id');await c.handle({type:'HM_CAPTURE_TARGET',target:{...target,title:'新目标'}},sender);assert.equal((await c.handle({type:'HM_CAPTURE_INFO',id},{id:api.runtime.id,url:api.runtime.getURL('capture.html?id='+id)})).target.title,'方块小屋');await assert.rejects(c.handle({type:'HM_CAPTURE_SAVE',id},sender),/请从效果页/);
});

test('website connect requests only X access, opens or reuses its tab and persists pairing until disconnect',async()=>{
 const session={},local={},requested=[];let created=0;const storage=state=>({get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v),remove:async k=>delete state[k]});
 const api={runtime:{id:'one-click'},storage:{session:storage(session),local:storage(local)},permissions:{request:async v=>{requested.push(v);return true;},contains:async()=>true},tabs:{query:async()=>[],create:async o=>{created++;assert.equal(o.url,'https://x.com/home');return {id:91,url:o.url,windowId:2};},get:async id=>({id,url:'https://x.com/home',windowId:2})},action:{setBadgeText:async()=>{},setTitle:async()=>{}},scripting:{executeScript:async()=>[{result:{bridgeResponse:true,data:{connected:true}}}]}};
 const b=createMediaBridge(api),sender={id:'one-click',frameId:0,url:'http://127.0.0.1:43110/',tab:{id:1}};assert.equal((await b.handle({type:'HM_MEDIA_CONNECT'},sender)).connected,true);assert.deepEqual(requested,[{origins:['https://*.x.com/*']}]);assert.equal(created,1);assert.ok(local.casebenchMediaBridge);assert.equal(session.casebenchXTab.tabId,91);await b.handle({type:'HM_MEDIA_DISCONNECT'},sender);assert.equal(local.casebenchMediaBridge,undefined);assert.equal(session.casebenchXTab,undefined);
});
