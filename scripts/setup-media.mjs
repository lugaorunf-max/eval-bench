import {spawn} from 'node:child_process';
import {mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),runtime=path.join(root,'tools/media-runtime'),windows=process.platform==='win32';
const run=(program,args)=>new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd:root,stdio:'inherit',shell:false});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('媒体依赖安装未完成，请检查网络和 Python 环境')));});
await mkdir(path.dirname(runtime),{recursive:true});
const python=path.join(runtime,windows?'Scripts/python.exe':'bin/python');
try{await access(python);}catch{await run(process.env.CASEBENCH_PYTHON|| (windows?'python':'python3'),['-m','venv',runtime]);}
await run(python,['-m','pip','install','yt-dlp==2026.10.26']);
await run(process.execPath,[path.join(root,'node_modules/playwright/cli.js'),'install','ffmpeg']);
console.log('媒体依赖已准备。X 使用你已登录的 Chrome；无需另开自动化登录窗口。');
