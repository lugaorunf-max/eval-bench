import {createServer,type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {EditorialService} from './editorial';
import {AppError} from './service';

const viewers=(globalThis as typeof globalThis&{artifactViewers?:Map<string,{url:string;server:Server}>}).artifactViewers??=new Map();
// Generated code runs on a separate origin and receives only this result's files.
export async function openArtifact(e:EditorialService,id:string){
 while(viewers.size>=12&&!viewers.has(id)){const key=viewers.keys().next().value!;viewers.get(key)!.server.close();viewers.delete(key);}
 const existing=viewers.get(id);if(existing)return {url:existing.url};
 const item=(await e.instances()).find(i=>i.id===id);if(!item)throw new AppError(404,'结果不存在');
 const html=item.files.find(f=>f.mime==='text/html');if(!html)throw new AppError(400,'此结果没有可打开的网页');
 const assets=await Promise.all(item.files.map(async f=>({...f,bytes:await readFile(e.s.filePath(f.id))}))),key=randomUUID();
 const server=createServer((req,res)=>{const url=new URL(req.url||'/','http://localhost');let name='';try{name=decodeURIComponent(url.pathname.slice(key.length+2));}catch{}
  const f=url.pathname.startsWith('/'+key+'/')?assets.find(f=>f.name===name):undefined;
  if(req.method!=='GET'||!f){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':f.mime+'; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(f.bytes);
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));server.unref();
 const port=(server.address() as {port:number}).port,url=`http://127.0.0.1:${port}/${key}/${encodeURIComponent(html.name)}`;viewers.set(id,{url,server});return {url};
}
