import {cp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConnection} from 'node:net';
import {createStore} from '../packages/core/db';
import {CasebenchService} from '../packages/core/service';
import {readCaseBundle,planCaseBundle,importCaseBundle} from '../packages/core/case-bundles';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),option=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]||fallback;};
const manifest=path.resolve(option('--bundle',path.join(root,'data/case-library/kimi-2026-10/manifest.json'))),directory=path.resolve(option('--data-dir',path.join(root,'.casebench'))),apply=args.includes('--apply');
try{
 const bundle=await readCaseBundle(manifest);
 // PGlite must have a single owner, including for a read-only preview.
 const online=await new Promise<boolean>((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:43110}),timer=setTimeout(()=>{socket.destroy();reject(Error('无法确认网站是否已停止，请检查 43110 端口'));},1500);socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve(true);});socket.once('error',error=>{clearTimeout(timer);socket.destroy();if((error as NodeJS.ErrnoException).code==='ECONNREFUSED')resolve(false);else reject(error);});});
 if(online)throw Error('请先停止本地网站，再导入案例包；导入结束后重新启动。此命令不能与正在运行的网站同时打开业务数据库。');
 const output=path.resolve(option('--report-dir',path.join(root,'output/case-bundle-'+new Date().toISOString().replaceAll(':','-'))));await mkdir(output,{recursive:true});
 if(apply)await cp(directory,path.join(output,'database-before'),{recursive:true,errorOnExist:true,force:false});
 const store=await createStore(directory,'');try{const service=new CasebenchService(store),plan=await planCaseBundle(service,bundle);await writeFile(path.join(output,'plan.json'),JSON.stringify(plan,null,2));if(!apply){console.log(JSON.stringify(plan,null,2));}else{const result=await importCaseBundle(service,bundle);await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({created:result.create,reused:result.reuse,pending:result.pending.length,report:output},null,2));}}finally{await store.close();}
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
