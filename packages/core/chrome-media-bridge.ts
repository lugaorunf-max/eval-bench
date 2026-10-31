import {randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
type Command={id:string;type:'search'|'post';query?:string;url?:string;screenshot?:boolean;claimed:boolean;onClaim:()=>void;resolve:(v:any)=>void;reject:(e:Error)=>void};
const global=globalThis as typeof globalThis&{chromeMediaBridge?:{clientId:string;secret:string;seen:number;commands:Map<string,Command>}};
const bridge=global.chromeMediaBridge??={clientId:'',secret:'',seen:0,commands:new Map()};
export function chromeMediaStatus(){return {connected:!!bridge.clientId&&(Date.now()-bridge.seen<120000||[...bridge.commands.values()].some(c=>c.claimed)),paired:!!bridge.clientId,lastSeenAt:bridge.seen?new Date(bridge.seen).toISOString():null,pending:bridge.commands.size};}
export function chromeMediaControl(raw:unknown){
 const v=z.object({operation:z.enum(['connect','poll','result','disconnect']),clientId:z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),secret:z.string().regex(/^[a-f0-9]{64}$/),id:z.string().max(100).optional(),result:z.unknown().optional(),error:z.string().max(1000).optional(),replace:z.boolean().optional()}).strict().parse(raw);
 if(v.operation==='connect'){
  if(bridge.clientId&&bridge.clientId!==v.clientId){if(chromeMediaStatus().connected&&!v.replace)throw Error('另一个 Chrome 已连接，请先断开');for(const command of bridge.commands.values())command.reject(Error('Chrome 采集连接已切换，请重新提交操作'));bridge.commands.clear();}bridge.clientId=v.clientId;bridge.secret=v.secret;bridge.seen=Date.now();return {connected:true};
 }
 if(v.clientId!==bridge.clientId||v.secret.length!==bridge.secret.length||!timingSafeEqual(Buffer.from(v.secret),Buffer.from(bridge.secret)))throw Error('Chrome 采集连接无效，请重新连接');bridge.seen=Date.now();
 if(v.operation==='disconnect'){bridge.clientId='';bridge.secret='';bridge.seen=0;for(const c of bridge.commands.values())c.reject(Error('Chrome 采集已断开'));bridge.commands.clear();return {connected:false};}
 if(v.operation==='result'){const c=v.id?bridge.commands.get(v.id):null;if(c){bridge.commands.delete(c.id);v.error?c.reject(Error(v.error)):c.resolve(v.result);}return {ok:true};}
 if([...bridge.commands.values()].some(c=>c.claimed))return {command:null};
 const command=[...bridge.commands.values()].find(c=>!c.claimed);if(command){command.claimed=true;command.onClaim();const {resolve,reject,claimed,onClaim,...data}=command;return {command:data};}return {command:null};
}
export async function chromeMediaRequest(type:Command['type'],args:{query?:string;url?:string;screenshot?:boolean},signal?:AbortSignal):Promise<any>{
 if(!chromeMediaStatus().paired)throw Error('请在已登录 X 的 Chrome 中点击采集插件，再回网站“写作设置”连接 Chrome 采集。');
 return new Promise((resolve,reject)=>{const id=randomBytes(16).toString('hex');let settled=false;const end=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);bridge.commands.delete(id);error?reject(error):resolve(value);};const abort=()=>end(Error('已取消 Chrome 采集'));let timer=setTimeout(()=>end(Error('Chrome 采集排队超时')),600000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();bridge.commands.set(id,{id,type,...args,claimed:false,onClaim:()=>{clearTimeout(timer);timer=setTimeout(()=>end(Error('Chrome 采集超时，请检查 X 登录或验证页面')),65000);},resolve:(v:unknown)=>end(undefined,v),reject:(e:Error)=>end(e)});});
}
