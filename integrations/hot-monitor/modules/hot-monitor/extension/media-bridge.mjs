const KEY='casebenchMediaBridge',TARGET='casebenchXTab',LOCAL=['http://127.0.0.1:43110','http://localhost:43110'];
const xUrl=raw=>{const u=new URL(raw);if(u.protocol!=='https:'||!['x.com','www.x.com'].includes(u.hostname))throw Error('仅支持指定的 X 标签页');return u;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// Executes only in the local website's isolated extension world. Secrets never enter page messages.
async function localRequest(payload){try{if(!['http://127.0.0.1:43110','http://localhost:43110'].includes(location.origin))throw Error('本机网站已关闭');const r=await fetch('/api/editorial/browser-bridge',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});const d=await r.json();return r.ok?{bridgeResponse:true,data:d}:{bridgeResponse:true,error:d.error||'本机采集桥接失败'};}catch(error){return {bridgeResponse:true,error:error.message||'本机网站未响应'};}}
async function readPostDocument(id){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));let article;
 for(let n=0;n<40;n++){article=[...document.querySelectorAll('article')].find(node=>[...node.querySelectorAll('a[href]')].some(a=>a.querySelector('time')&&new URL(a.href).pathname.split('/status/')[1]?.split('/')[0]===id));if(article)break;await sleep(400);}
 if(!article)throw Error('原帖未加载，请检查 X 是否要求登录或验证');
 const original=[...article.querySelectorAll('[role="button"],button')].find(n=>['Show original','显示原文','查看原文'].includes(n.textContent?.trim()));original?.click();if(original)await sleep(500);
 const more=[...article.querySelectorAll('[role="button"],button')].find(n=>['Show more','显示更多','展开'].includes(n.textContent?.trim()));more?.click();await sleep(300);
 const video=article.querySelector('video');if(video){const mute=video.muted;video.muted=true;await video.play().catch(()=>{});await sleep(800);video.pause();video.muted=mute;}
 const own=[...article.querySelectorAll('a[href]')].find(a=>a.querySelector('time')&&new URL(a.href).pathname.includes('/status/'+id));
 const images=[...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map(n=>n.src).filter(url=>{try{return new URL(url).hostname==='pbs.twimg.com';}catch{return false;}});
 const sourceVideoId=/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/(\d+)/.exec(video?.poster||'')?.[1];
 const videoUrls=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(url=>sourceVideoId&&url.includes('/'+sourceVideoId+'/')).filter(url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='video.twimg.com'&&/\.(mp4|m3u8)(?:$|\?)/.test(u.pathname+u.search);}catch{return false;}}))].slice(-8);
 article.scrollIntoView({block:'start'});window.scrollBy(0,-70);await sleep(300);const r=article.getBoundingClientRect();
 return {id,url:location.href,text:article.querySelector('[data-testid="tweetText"]')?.innerText||'',author:article.querySelector('[data-testid="User-Name"]')?.innerText||'',publishedAt:own?.querySelector('time')?.dateTime||'',images,hasVideo:!!video,poster:video?.poster||'',videoUrls,bounds:{x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight},notice:r.height>innerHeight-80?'原帖较长，截图仅含当前可见部分。':''};
}
async function readSearchDocument(){const sleep=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<40&&!document.querySelector('article');i++)await sleep(400);const results=[...document.querySelectorAll('article')].slice(0,12).map(n=>{const a=[...n.querySelectorAll('a[href]')].find(a=>a.querySelector('time'));return {url:a?.href||'',text:n.querySelector('[data-testid="tweetText"]')?.innerText||'',author:n.querySelector('[data-testid="User-Name"]')?.innerText||'',publishedAt:a?.querySelector('time')?.dateTime||''};}).filter(v=>v.url&&v.text);if(!results.length)throw Error('X 没有显示可读取的搜索结果，请检查登录或验证提示');return {results};}
async function cropScreenshot(data,bounds){
 const image=await createImageBitmap(await(await fetch(data)).blob()),scale=image.width/bounds.viewportWidth;
 const x=Math.max(0,Math.round(bounds.x*scale)),y=Math.max(0,Math.round(bounds.y*scale)),w=Math.min(image.width-x,Math.round(bounds.width*scale)),h=Math.min(image.height-y,Math.round(bounds.height*scale));
 if(w<=0||h<=0)throw Error('原帖不在可见区域，未保存空白截图');const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);image.close();const blob=await canvas.convertToBlob({type:'image/png'});if(blob.size>8*1024*1024)throw Error('截图超过 8 MB');const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
}
export function createMediaBridge(api){
 let busy=false;
 const local=sender=>sender?.id===api.runtime.id&&sender.frameId===0&&LOCAL.includes(new URL(sender.url||'about:blank').origin);
 const request=async(tabId,payload)=>{const r=await api.scripting.executeScript({target:{tabId},func:localRequest,args:[payload]}),result=r[0]?.result;if(result===undefined)throw Error('本机网站未响应');if(result.bridgeResponse){if(result.error)throw Error(result.error);return result.data;}return result;};
 async function select(tab){if(!Number.isInteger(tab?.id))return;xUrl(tab.url);await api.storage.session.set({[TARGET]:{tabId:tab.id,windowId:tab.windowId}});await api.action.setBadgeText({tabId:tab.id,text:'AI'});await api.action.setTitle({tabId:tab.id,title:'此 X 标签可供测写助手搜索与截帖；回网站连接 Chrome 采集'});}
 async function execute(command,target){
  const tab=await api.tabs.get(target.tabId);xUrl(tab.url);let url,id;
  if(command.type==='search'){if(typeof command.query!=='string'||command.query.length<2||command.query.length>300)throw Error('搜索词无效');url='https://x.com/search?q='+encodeURIComponent(command.query)+'&src=typed_query&f=live';}
  else if(command.type==='post'){const u=xUrl(command.url);id=/^\/[^/]+\/status\/(\d+)/.exec(u.pathname)?.[1];if(!id)throw Error('不是具体 X 帖子');url=u.href;}
  else throw Error('未开放的浏览器操作');
  await api.tabs.update(target.tabId,{url});for(let n=0;n<60;n++){await pause(250);const current=await api.tabs.get(target.tabId);xUrl(current.url);if(current.status==='complete')break;}
  const r=await api.scripting.executeScript({target:{tabId:target.tabId},func:command.type==='search'?readSearchDocument:readPostDocument,args:command.type==='search'?[]:[id]});const data=r[0]?.result;if(!data)throw Error('X 标签没有返回内容');
  if(command.type==='post'&&command.screenshot){const previous=(await api.tabs.query({active:true,windowId:tab.windowId}))[0];try{await api.tabs.update(target.tabId,{active:true});await pause(250);data.screenshotBase64=await cropScreenshot(await api.tabs.captureVisibleTab(tab.windowId,{format:'png'}),data.bounds);}finally{if(previous?.id&&previous.id!==target.tabId)await api.tabs.update(previous.id,{active:true}).catch(()=>{});}}
  delete data.bounds;return data;
 }
 async function handle(message,sender){
  if(!local(sender))throw Error('只能从本机测写网站连接');
  if(message.type==='HM_MEDIA_CONNECT'){
   // First use requests only the declared optional X host permission, from the user's connect gesture.
   const granted=api.permissions?await api.permissions.request({origins:['https://*.x.com/*']}):false;
   let target=(await api.storage.session.get(TARGET))[TARGET];
   if(target){try{xUrl((await api.tabs.get(target.tabId)).url);}catch{target=null;}}
   if(!target&&granted){const tabs=await api.tabs.query({url:['https://x.com/*','https://*.x.com/*']}),tab=tabs.sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0]||await api.tabs.create({url:'https://x.com/home',active:true});await select(tab);target={tabId:tab.id,windowId:tab.windowId};}
   if(!target)throw Error('请授权 X 网站访问，或在已登录 X 标签页点击插件后重试');
   const tab=await api.tabs.get(target.tabId);xUrl(tab.url);
   // Request only the already declared X host scope, never cookies, debugger or all sites.
   // The toolbar click grants activeTab to this one X tab, including same-origin navigation.
   const existing=(await api.storage.session.get(KEY))[KEY],clientId=existing?.clientId||crypto.randomUUID().replaceAll('-',''),secret=existing?.secret||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),config={clientId,secret};
   await request(sender.tab.id,{operation:'connect',...config,replace:true});await api.storage.session.set({[KEY]:config});if(granted&&api.storage.local)await api.storage.local.set({[KEY]:config});return {installed:true,connected:true,message:'Chrome 的 X 标签已连接'};
  }
  const config=(await api.storage.session.get(KEY))[KEY]||(api.storage.local?((await api.storage.local.get(KEY))[KEY]):null);if(!config)return {installed:true,connected:false};
  if(message.type==='HM_MEDIA_DISCONNECT'){await request(sender.tab.id,{operation:'disconnect',...config}).catch(()=>{});await api.storage.session.remove(KEY);await api.storage.session.remove(TARGET);if(api.storage.local)await api.storage.local.remove(KEY);return {connected:false};}
  if(message.type!=='HM_MEDIA_POLL')throw Error('未开放的桥接操作');if(busy)return {connected:true};busy=true;
  if(api.permissions&&await api.permissions.contains({origins:['https://*.x.com/*']})){try{const selected=(await api.storage.session.get(TARGET))[TARGET];let valid=false;if(selected)try{xUrl((await api.tabs.get(selected.tabId)).url);valid=true;}catch{}if(!valid){const tab=(await api.tabs.query({url:['https://x.com/*','https://*.x.com/*']}))[0]||await api.tabs.create({url:'https://x.com/home',active:false});await select(tab);}await api.storage.session.set({[KEY]:config});}catch(error){busy=false;return {installed:true,connected:false,error:error.message};}}

  try{const next=await request(sender.tab.id,{operation:'poll',...config});if(next.command){let result,error;try{let target=(await api.storage.session.get(TARGET))[TARGET];if(!target&&api.permissions&&await api.permissions.contains({origins:['https://*.x.com/*']})){const tab=(await api.tabs.query({url:['https://x.com/*','https://*.x.com/*']}))[0];if(tab){await select(tab);target={tabId:tab.id,windowId:tab.windowId};}}if(!target)throw Error('X 标签未连接，请在左下角连接中重新打开 X');result=await execute(next.command,target);}catch(e){error=e.message;}await request(sender.tab.id,{operation:'result',...config,id:next.command.id,...(error?{error}:{result})});}return {installed:true,connected:true};}catch(e){if(/连接无效/.test(e.message)){try{const target=(await api.storage.session.get(TARGET))[TARGET];if(!target)throw e;xUrl((await api.tabs.get(target.tabId)).url);await request(sender.tab.id,{operation:'connect',...config});return {installed:true,connected:true,message:'Chrome 采集已恢复'};}catch{}}return {installed:true,connected:false,error:e.message};}finally{busy=false;}
 }
 return {select,handle};
}
