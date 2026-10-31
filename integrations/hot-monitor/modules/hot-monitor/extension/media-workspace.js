(() => {
 if(globalThis.__casebenchMediaWorkspace)return;globalThis.__casebenchMediaWorkspace=true;
 const local=()=>['http://127.0.0.1:43110','http://localhost:43110'].includes(location.origin);
 let captureClick=0;
 document.addEventListener('click',e=>{if(e.isTrusted&&e.target instanceof Element&&e.target.closest('button[data-capture-instance]'))captureClick=Date.now();},true);
 window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin||!local()||e.data?.source!=='casebench-capture-target'||Date.now()-captureClick>15000)return;void chrome.runtime.sendMessage({type:'HM_CAPTURE_TARGET',target:{instanceId:e.data.instanceId,title:e.data.title,url:e.data.url}}).catch(()=>{});});
 const report=data=>window.postMessage({source:'casebench-media-extension',...data},location.origin);
 let polling=false;
 async function poll(){if(!local()||polling)return;polling=true;try{const r=await chrome.runtime.sendMessage({type:'HM_MEDIA_POLL'});if(r?.connected!==undefined)report(r);}catch{}finally{polling=false;}}
 document.addEventListener('click',event=>{
  if(!event.isTrusted||!local()||!(event.target instanceof Element))return;
  const button=event.target.closest('button[data-media-bridge]');if(!button||button.disabled)return;
  const action=button.getAttribute('data-media-bridge');if(!['connect','disconnect'].includes(action))return;
  void chrome.runtime.sendMessage({type:action==='connect'?'HM_MEDIA_CONNECT':'HM_MEDIA_DISCONNECT'}).then(report,error=>report({error:error.message}));
 },true);
 setInterval(()=>void poll(),2000);void poll();report({installed:true});
})();
