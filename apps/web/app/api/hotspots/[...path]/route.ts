import {collectorExtensionPackage} from '@/packages/core/collector-extension';
import {collectorFetch} from '@/packages/core/hotspots/client';
import {HotspotsBridge} from '@/packages/core/hotspots/bridge';
import {getStore} from '@/packages/core/db';
import {CasebenchService,AppError} from '@/packages/core/service';
import {ZodError} from 'zod';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function body(request:Request){const reader=request.body?.getReader();const chunks:Uint8Array[]=[];let size=0;if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>37*1024*1024){await reader.cancel();throw new AppError(413,'上传文件过大');}chunks.push(value);}return Buffer.concat(chunks);}
async function handler(request:Request,context:{params:Promise<{path:string[]}>}){
 try{
  const u=new URL(request.url),host=(request.headers.get('host')||'').split(':')[0],allowed=new Set(['localhost','127.0.0.1',...(process.env.CASEBENCH_ALLOWED_HOSTS||'').split(',')]);
  if(!allowed.has(host))throw new AppError(403,'未授权的主机地址');
  u.host=request.headers.get('host')!;
  const origin=request.headers.get('origin');if(origin&&origin!==u.origin)throw new AppError(403,'请求来源不匹配');
  if(request.method!=='GET'&&request.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'请从本网站提交操作');
  const p=(await context.params).path;if(p.some(v=>!v||v.includes('..')||v.includes('/')||v.includes('\\')))throw new AppError(400,'无效路径');
  if(request.method!=='GET'&&!request.headers.get('content-type')?.startsWith('application/json'))throw new AppError(415,'请使用 JSON 提交');
  if(p[0]==='bridge'&&request.method==='POST'){
   const data=JSON.parse((await body(request)).toString()||'{}'),bridge=new HotspotsBridge(new CasebenchService(await getStore()));
   if(p[1]==='reconcile')return Response.json(await bridge.reconcile());
   if(p[1]==='source'&&p[2])return Response.json(await bridge.source(p[2],data.caseId));
   if(p[1]==='test'&&p[2]&&typeof data.caseId==='string'){const{caseId,...rest}=data;return Response.json(await bridge.test(p[2],caseId,rest));}
   if(p[1]==='asset'&&p[2])return Response.json(await bridge.asset(p[2]));
   if(p[1]==='experiment'&&p[2]&&typeof data.experimentId==='string')return Response.json(await bridge.experiment(p[2],data.experimentId));
   throw new AppError(404,'关联操作不存在');
  }
  const route=p.join('/');if(route==='collector/extension.zip'&&request.method==='GET')return new Response(new Uint8Array(await collectorExtensionPackage()),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename=hot-monitor-collector.zip','cache-control':'no-store'}});let eventBody:Buffer|undefined;
  if(route==='events'&&request.method==='POST'){eventBody=await body(request);const input=JSON.parse(eventBody.toString()||'{}');if(!input.url)return Response.json(await new HotspotsBridge(new CasebenchService(await getStore())).addLocalTopic(input));}
  const topicUsage=route==='overview'?await new HotspotsBridge(new CasebenchService(await getStore())).usage():null;
  if(topicUsage&&u.searchParams.get('mode')==='used')u.searchParams.set('ids',Object.keys(topicUsage).join(','));
  const read=/^(overview|events\/[^/]+(?:\/(?:export|bundle|handoff))?|cases|assets\/[^/]+|catalogue|connections|rules|usage|topics|collector\/extension\.zip|model-connection)$/;
  const mutate=/^(events(?:\/[^/]+(?:\/(?:candidate|manual-score|score|translate|search))?)?|cases(?:\/import|\/[^/]+(?:\/(?:hydrate|video|archive|assets))?)?|catalogue(?:\/[^/]+\/(?:enabled|classification|check))?|connections\/(?:dajiala|socialdata)|usage\/settings|classifications|experiments|topics\/export|sync|collect|model-connection)$/;
  if(!((request.method==='GET'?read:mutate).test(route)))throw new AppError(404,'未迁入的接口');
  const response=await collectorFetch('/api/admin/monitor/'+route+u.search,{method:request.method,headers:{'content-type':'application/json',...(request.headers.get('range')?{'range':request.headers.get('range')!}:{}),...(request.headers.get('idempotency-key')?{'idempotency-key':request.headers.get('idempotency-key')!}:{})},...(request.method!=='GET'?{body:new Uint8Array(eventBody||await body(request))}:{})});
  if(topicUsage&&response.ok){const data=await response.json();return Response.json({...data,events:data.events.map((e:any)=>({...e,articleCount:topicUsage[e.id]||0}))},{headers:{'cache-control':'no-store'}});}
  const headers=new Headers({'cache-control':'no-store','x-content-type-options':'nosniff'});for(const name of ['content-type','content-disposition','content-length','content-range','accept-ranges']){const v=response.headers.get(name);if(v)headers.set(name,v);}
  return new Response(response.body,{status:response.status,headers});
 }catch(error){const status=error instanceof AppError?error.status:error instanceof ZodError||error instanceof SyntaxError?400:500;return Response.json({error:status===500?'热点处理失败，请检查本机服务日志':error instanceof ZodError?error.issues[0]?.message:(error as Error).message},{status});}
}
export {handler as GET,handler as POST,handler as PATCH};
