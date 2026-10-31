import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
export interface MediaTool {name:string;description:string;inputSchema:Record<string,unknown>}
export type ToolContent={type:'text';text:string}|{type:'image';data:string;mimeType:string};
export interface MediaToolResult {content:ToolContent[];isError?:boolean}
type Session={token:string;expires:number;tools:MediaTool[];call:(name:string,args:unknown)=>Promise<MediaToolResult>;calls:number;running:boolean;maxCalls:number};
const sessions=(globalThis as typeof globalThis&{mediaToolSessions?:Map<string,Session>}).mediaToolSessions??=new Map<string,Session>();
export async function createMediaToolSession(origin:string,directory:string,tools:MediaTool[],call:Session['call'],options:{maxCalls?:number}={}){
 const u=new URL(origin);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('工具桥接仅允许本机');
 const token=randomBytes(32).toString('hex'),id=randomBytes(16).toString('hex');
 sessions.set(id,{token,expires:Date.now()+12*60*1000,tools,call,calls:0,running:false,maxCalls:Math.max(1,Math.min(120,options.maxCalls||36))});
 const file=path.join(directory,'media-tools.private.json');await mkdir(directory,{recursive:true});await writeFile(file,JSON.stringify({endpoint:u.origin+'/api/editorial/tool-session',id,token}),{mode:0o600});
 return {file,tools,close:()=>sessions.delete(id)};
}
export async function mediaToolRequest(body:unknown):Promise<unknown>{
 const v=body as {id?:string;token?:string;method?:string;name?:string;arguments?:unknown};
 const s=typeof v?.id==='string'?sessions.get(v.id):null;
 const token=typeof v?.token==='string'?v.token:'';
 if(!/^[a-f0-9]{64}$/.test(token)||!s||Date.now()>s.expires||token.length!==s.token.length||!timingSafeEqual(Buffer.from(token),Buffer.from(s.token)))throw Error('工具会话已失效');
 if(v.method==='list')return {tools:s.tools};
 if(v.method!=='call'||!s.tools.some(t=>t.name===v.name))throw Error('此会话未开放该工具');
 if(s.running)throw Error('请等待当前工具完成后再调用');if(s.calls>=s.maxCalls)throw Error('本轮工具调用已达上限');
 s.running=true;s.calls++;try{return await s.call(v.name!,v.arguments);}catch(e){return {isError:true,content:[{type:'text',text:(e as Error).message}]};}finally{s.running=false;}
}
export const toolText=(data:unknown):MediaToolResult=>({content:[{type:'text',text:typeof data==='string'?data:JSON.stringify(data)}]});
