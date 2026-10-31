import {readFile} from 'node:fs/promises';
export async function callMediaTool(session,name,args){
 if(!session?.tools.some(t=>t.name===name))throw Error('本轮未开放此工具');
 const config=JSON.parse(await readFile(session.file,'utf8')),url=new URL(config.endpoint);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('工具地址不是本机');
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:config.id,token:config.token,method:'call',name,arguments:args}),signal:AbortSignal.timeout(150000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'工具请求失败');return result;
}
