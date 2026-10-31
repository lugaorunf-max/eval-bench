import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const endpoint=new URL(config.endpoint);if(!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw Error('本机工具桥接地址无效');
const request=async(method,rest={})=>{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:config.id,token:config.token,method,...rest}),signal:AbortSignal.timeout(150000)});const data=await r.json();if(!r.ok)throw Error(data.error||'工具请求失败');return data;};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{void(async()=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id==null)return;const result=value=>send({jsonrpc:'2.0',id:m.id,result:value});try{
 if(m.method==='initialize')return result({protocolVersion:m.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'casebench-media',version:'1.0.0'}});
 if(m.method==='ping')return result({});if(m.method==='tools/list')return result(await request('list'));
 if(m.method==='tools/call')return result(await request('call',{name:m.params?.name,arguments:m.params?.arguments}));
 send({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'不支持的操作'}});
 }catch(e){send({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:e.message}});}})();});
