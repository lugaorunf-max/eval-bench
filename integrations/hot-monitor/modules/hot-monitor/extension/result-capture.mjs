const LOCAL=['http://127.0.0.1:43110','http://localhost:43110'];
const isLocal=u=>{try{return LOCAL.includes(new URL(u).origin);}catch{return false;}};
const validTarget=v=>v&&/^(attempt|instance)_[a-f0-9]{32}$/.test(v.instanceId)&&/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]{36}\//.test(v.url);
export function createResultCapture(api){
 async function toolbar(tab){const {resultCaptureTarget:t}=await api.storage.session.get('resultCaptureTarget');if(!validTarget(t)||tab.url!==t.url)return false;
  const id=crypto.randomUUID();await api.storage.session.set({['capture:'+id]:{...t,tabId:tab.id,windowId:tab.windowId}});await api.windows.create({url:api.runtime.getURL('capture.html?id='+id),type:'popup',width:440,height:310});return true;
 }
 async function handle(m,sender){if(sender.id!==api.runtime.id)throw Error('无效的录制请求');
  if(m.type==='HM_CAPTURE_TARGET'){if(sender.frameId!==0||!isLocal(sender.url)||!validTarget(m.target))throw Error('无效的效果目标');await api.storage.session.set({resultCaptureTarget:{...m.target,title:String(m.target.title||'效果').slice(0,120)}});return {ok:true};}
  if(!sender.url?.startsWith(api.runtime.getURL('capture.html'))||!/^[a-f0-9-]{36}$/.test(m.id||''))throw Error('请从效果页点击插件');
  const t=(await api.storage.session.get('capture:'+m.id))['capture:'+m.id];if(!validTarget(t))throw Error('录制目标已过期，请重新打开效果');
  if(m.type==='HM_CAPTURE_INFO')return {ok:true,target:t};
  if(m.type==='HM_CAPTURE_SCREENSHOT'){const tab=await api.tabs.get(t.tabId);if(tab.url!==t.url||!tab.active)throw Error('请先让效果标签页在原窗口中显示');return {ok:true,data:await api.tabs.captureVisibleTab(t.windowId,{format:'png'})};}
  if(!['HM_CAPTURE_CHUNK','HM_CAPTURE_SAVE'].includes(m.type))throw Error('不支持的录制操作');
  const tabs=await api.tabs.query({url:LOCAL.map(o=>o+'/*')}),workspace=tabs.filter(t=>isLocal(t.url)).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];if(!workspace)throw Error('请保持测写网站打开');
  if(m.type==='HM_CAPTURE_CHUNK'&&(typeof m.data!=='string'||m.data.length>750000||!/^[A-Za-z0-9+/=]*$/.test(m.data)))throw Error('录屏分片无效');
  const results=await api.scripting.executeScript({target:{tabId:workspace.id},func:async function({id,data,final,target,mime,name}){
   const LOCAL=['http://127.0.0.1:43110','http://localhost:43110'];if(!LOCAL.includes(location.origin))throw Error('工作台地址已改变');
   const cache=globalThis.__casebenchCaptures??=new Map();let item=cache.get(id);if(!item){item={chunks:[],size:0};cache.set(id,item);}
   if(!final){const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));item.size+=bytes.length;if(item.size>100*1024*1024){cache.delete(id);throw Error('录屏超过 100 MB');}item.chunks.push(bytes);return {ok:true};}
   try{if(!item.size)throw Error('未收到录屏文件');const body=new FormData();body.set('file',new File(item.chunks,name,{type:mime}));let r=await fetch('/api/editorial/files',{method:'POST',body}),f=await r.json();if(!r.ok)throw Error(f.error||'上传失败');r=await fetch('/api/editorial/media',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileId:f.id,instanceId:target.instanceId,origin:mime==='image/png'?'uploaded':'recorded'})});const saved=await r.json();if(!r.ok)throw Error(saved.error||'关联结果失败');window.dispatchEvent(new Event('casebench-library-changed'));window.dispatchEvent(new Event('casebench-resources-changed'));return {ok:true,fileId:f.id};}finally{cache.delete(id);}
  },args:[{id:m.id,data:m.data,final:m.type==='HM_CAPTURE_SAVE',target:t,mime:m.mime==='image/png'?'image/png':'video/webm',name:t.title+(m.mime==='image/png'?'-截图.png':'-录屏.webm')}]});return results[0]?.result||{ok:false,error:'工作台没有响应'};
 }
 return {toolbar,handle};
}
