import archiver from 'archiver';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from './config';
export const COLLECTOR_EXTENSION_FILES=['manifest.json','background.js','content.js','collector-core.mjs','collector-v2.mjs','workspace.js','auto.js','media-bridge.mjs','media-workspace.js','README.txt','result-capture.mjs','capture.html','capture.js'];
export async function collectorExtensionPackage(){
 const zip=archiver('zip',{zlib:{level:6}}),chunks:Buffer[]=[];
 const complete=new Promise<Buffer>((resolve,reject)=>{zip.on('data',b=>chunks.push(b));zip.on('end',()=>resolve(Buffer.concat(chunks)));zip.on('error',reject);});
 for(const name of COLLECTOR_EXTENSION_FILES)zip.append(await readFile(path.join(projectRoot(),'integrations/hot-monitor/modules/hot-monitor/extension',name)),{name:'hot-monitor-collector/'+name});
 await zip.finalize();return complete;
}
