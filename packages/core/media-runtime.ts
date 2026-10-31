import {chromeMediaStatus,chromeMediaRequest} from './chrome-media-bridge';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,readdir,stat,access} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import ffmpeg from 'ffmpeg-static';
import type {Page} from 'playwright';
import {projectRoot} from './config';
import {isPublicAddress,publicImageUrl} from './writing-web-media';

export async function runMediaCommand(program:string,args:string[],options:{signal?:AbortSignal;timeout?:number;maxOutput?:number}={}){
 return new Promise<string>((resolve,reject)=>{
  const child=spawn(program,args,{shell:false,stdio:['ignore','pipe','pipe']}),limit=options.maxOutput||2_000_000;let out='',err='',settled=false;
  const end=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(error);}else resolve(out);};
  const abort=()=>end(Error('任务已取消')),timer=setTimeout(()=>end(Error('媒体处理超时')),options.timeout||90000);
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
  child.stdout.on('data',b=>{out+=b;if(out.length>limit)end(Error('工具响应过大'));});child.stderr.on('data',b=>err=(err+b).slice(-4000));
  child.once('error',e=>end(Error('无法启动媒体工具：'+e.message)));child.once('close',code=>end(code===0?undefined:Error('媒体工具执行失败：'+err.replace(/(?:auth_token|ct0|cookie)[=:][^\s]+/gi,'[已隐藏]').slice(-1200))));
 });
}
export function xPostUrl(raw:string){const u=new URL(raw);if(!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||u.protocol!=='https:'||u.username||u.password)throw Error('请提供 HTTPS 的 X 帖子链接');const id=/^\/[^/]+\/status\/(\d+)/.exec(u.pathname)?.[1];if(!id)throw Error('请打开具体 X 帖子后保存');return {id,url:`https://x.com/i/status/${id}`};}
export async function assertPublicWebUrl(raw:string){const u=publicImageUrl(raw),hosts=await lookup(u.hostname,{all:true});if(!hosts.length||hosts.some(a=>!isPublicAddress(a.address)))throw Error('仅访问公开网页');return u;}

async function chromium(){return (await import('playwright')).chromium;}
async function launchOptions(){const p=process.env.CASEBENCH_BROWSER_PATH;if(p)return {executablePath:p};if(process.platform==='darwin'){const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';try{await access(chrome);return {executablePath:chrome};}catch{}}return {};}
const postVideos=(globalThis as typeof globalThis&{casebenchPostVideos?:Map<string,string[]>}).casebenchPostVideos??=new Map<string,string[]>();
export async function searchX(query:string,signal?:AbortSignal){
 if(query.trim().length<2||query.length>300)throw Error('搜索词应为 2—300 字');
 if(!chromeMediaStatus().paired)throw Error('请在已登录 X 的 Chrome 标签页点击采集插件，再回写作设置连接 Chrome 采集。');
 return {query,...await chromeMediaRequest('search',{query},signal),notice:'来自明确连接的 Chrome X 标签页，搜索结果尚未验证。'};
}
export async function readXPost(raw:string,options:{screenshot?:boolean;signal?:AbortSignal;directory?:string}={}){
 const post=xPostUrl(raw);if(!chromeMediaStatus().paired)throw Error('请先连接已登录 X 的 Chrome 采集标签页。');
 let data:any;try{data=await chromeMediaRequest('post',{url:raw,screenshot:options.screenshot},options.signal);}catch(error){if(!options.screenshot||!/capture|截图|readback/i.test((error as Error).message))throw error;data=await chromeMediaRequest('post',{url:raw,screenshot:false},options.signal);data.screenshotError='原帖截图失败，请解锁 Mac 并展开 X 所在 Chrome 窗口后重试。原文与媒体已继续读取。';}
 if(data.id!==post.id||!String(data.text||'').trim()&&!data.images?.length&&!data.hasVideo)throw Error('未取得具体原帖内容');
 if(xPostUrl(data.url||raw).id!==post.id)throw Error('X 标签已切换，未把其他帖子归入当前来源');data.text=String(data.text||'').slice(0,30000);const urls=(data.videoUrls||[]).filter((u:string)=>{try{return new URL(u).protocol==='https:'&&new URL(u).hostname==='video.twimg.com';}catch{return false;}}).slice(0,8);
 postVideos.set(post.id,urls);if(postVideos.size>50)postVideos.delete(postVideos.keys().next().value!);
 let screenshotPath:string|undefined;if(data.screenshotBase64&&options.directory){const bytes=Buffer.from(data.screenshotBase64,'base64');if(bytes.length>8*1024*1024)throw Error('原帖截图过大');await mkdir(options.directory,{recursive:true});screenshotPath=path.join(options.directory,'x-post-'+post.id+'.png');await(await import('node:fs/promises')).writeFile(screenshotPath,bytes);}
 return {...data,screenshotBase64:undefined,screenshotPath};
}

export async function downloadXVideo(raw:string,directory:string,signal?:AbortSignal,videoCandidates?:string[]){
 xPostUrl(raw);await mkdir(directory,{recursive:true});const local=path.join(projectRoot(),'tools/media-runtime/bin/yt-dlp'),program=process.env.CASEBENCH_YTDLP||local;
 const args=['--no-continue','--force-overwrites','--no-playlist','--no-progress','--no-warnings','--max-filesize','100M','--socket-timeout','20','--retries','1','--restrict-filenames','--write-info-json','--no-write-thumbnail','-f','best[ext=mp4]/best','-o',path.join(directory,'source.%(ext)s'),raw];
 let candidates=videoCandidates||postVideos.get(xPostUrl(raw).id)||[];
 if(!candidates.length&&chromeMediaStatus().paired){try{await readXPost(raw,{signal});candidates=postVideos.get(xPostUrl(raw).id)||[];}catch{}}
 const valid=candidates.filter(u=>{try{return new URL(u).protocol==='https:'&&new URL(u).hostname==='video.twimg.com'&&!/\/(?:aud|mp4a)\//.test(new URL(u).pathname);}catch{return false;}}),media=valid.find(u=>/\.m3u8(?:$|\?)/.test(u))||valid.find(u=>/\.mp4(?:$|\?)/.test(u)&&!/\/0\/0\//.test(u));
 if(media){await assertPublicWebUrl(media);await runMediaCommand(program,[...(ffmpeg?['--ffmpeg-location',ffmpeg]:[]),...args.slice(0,-1),media],{signal,timeout:120000});}
 else await runMediaCommand(program,args,{signal,timeout:45000});
 const names=await readdir(directory),name=names.find(n=>/^source\.(mp4|webm|mov|mkv)$/.test(n));if(!name)throw Error('没有下载到可用视频；可以用采集助手补充原帖或上传视频');
 const file=path.join(directory,name);if((await stat(file)).size>100*1024*1024)throw Error('原视频超过 100 MB');
 let metadata:any={};try{metadata=JSON.parse(await readFile(path.join(directory,'source.info.json'),'utf8'));}catch{}
 return {file,name,mime:name.endsWith('.webm')?'video/webm':'video/mp4',title:String(metadata.title||'X 视频'),text:String(metadata.description||''),author:String(metadata.uploader||''),duration:Number(metadata.duration)||null,url:raw};
}
export async function transcodeClip(input:string,output:string,options:{start:number;end:number;width:number;fps:number;signal?:AbortSignal}){
 if(!ffmpeg)throw Error('媒体编码器尚未安装');const {start,end,width,fps}=options;if(start<0||end<=start||end-start>120||width<160||width>1920||fps<5||fps>30)throw Error('片段或尺寸参数无效');
 const filter=`fps=${fps},scale=${width}:-2:force_original_aspect_ratio=decrease:flags=lanczos`;
 const args=['-nostdin','-hide_banner','-loglevel','error','-ss',String(start),'-i',input,'-t',String(end-start),'-threads','2','-filter_complex_threads','1'];
 if(output.endsWith('.gif'))args.push('-filter_complex',`${filter},split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer`,'-loop','0');else args.push('-vf',filter,'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-an','-movflags','+faststart');
 await runMediaCommand(ffmpeg,[...args,'-y',output],{signal:options.signal,timeout:120000});if(!(await stat(output)).size)throw Error('没有生成有效素材');
}
export async function videoFrames(input:string,directory:string,signal?:AbortSignal){
 if(!ffmpeg)throw Error('媒体编码器尚未安装');await mkdir(directory,{recursive:true});
 const duration=await new Promise<number|null>((resolve,reject)=>{const child=spawn(ffmpeg!,['-nostdin','-hide_banner','-i',input],{shell:false,stdio:['ignore','ignore','pipe']});let text='';const finish=(value:number|null)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(value);},abort=()=>{child.kill('SIGKILL');reject(Error('已取消素材读取'));},timer=setTimeout(()=>{child.kill('SIGKILL');finish(null);},10000);signal?.addEventListener('abort',abort,{once:true});child.stderr.on('data',b=>text=(text+b).slice(-10000));child.once('error',()=>finish(null));child.once('close',()=>{const m=/Duration: (\d+):(\d+):([\d.]+)/.exec(text);finish(m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):null);});});
 const frames:string[]=[],times:number[]=[];for(let i=0;i<6;i++){signal?.throwIfAborted();const time=duration?Math.max(0,duration-.12)*i/5:i*3,file=path.join(directory,'frame-'+String(i).padStart(2,'0')+'.png');await runMediaCommand(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-ss',String(time),'-i',input,'-frames:v','1','-vf','scale=720:-2','-threads','2','-y',file],{signal});try{if((await stat(file)).size){frames.push(file);times.push(Math.round(time*100)/100);}}catch{}}
 if(!frames.length)throw Error('未取得可用的视频关键帧');await(await import('node:fs/promises')).writeFile(path.join(directory,'frames.json'),JSON.stringify({durationSeconds:duration,frameSeconds:times}));return frames;
}

export type DemoAction={type:'click';text:string}|{type:'press';key:string}|{type:'scroll';dy:number}|{type:'drag';fromX:number;fromY:number;toX:number;toY:number}|{type:'wait';ms:number};
export async function performDemoAction(page:Page,action:DemoAction){
 const size=page.viewportSize()||{width:1280,height:800};
 if(action.type==='click')await page.getByText(action.text,{exact:true}).first().click({timeout:3000});
 else if(action.type==='press'){if(!/^(Arrow(Up|Down|Left|Right)|Space|Enter|Escape|[wasd])$/.test(action.key))throw Error('不支持此按键');await page.keyboard.press(action.key);}
 else if(action.type==='scroll')await page.mouse.wheel(0,Math.max(-size.height,Math.min(size.height,action.dy)));
 else if(action.type==='drag'){const x=(v:number)=>Math.max(0,Math.min(1,v))*size.width,y=(v:number)=>Math.max(0,Math.min(1,v))*size.height;await page.mouse.move(x(action.fromX),y(action.fromY));await page.mouse.down();await page.mouse.move(x(action.toX),y(action.toY),{steps:35});await page.mouse.up();}
 else await page.waitForTimeout(Math.max(0,Math.min(2000,action.ms)));
}
export async function recordArtifact(assets:{name:string;bytes:Uint8Array;mime:string}[],directory:string,options:{seconds?:number;signal?:AbortSignal;onReady?:(page:Page,recordStartedAt:number)=>Promise<{start?:number;end?:number}|void>}={}){
 const html=assets.find(f=>f.mime==='text/html'||/\.html?$/i.test(f.name));if(!html)throw Error('此结果没有可运行的网页产物，请上传视频或使用原始媒体');await mkdir(directory,{recursive:true});
 const key=randomUUID(),server=createServer((req,res)=>{let name:string;try{name=decodeURIComponent(new URL(req.url||'/', 'http://localhost').pathname).slice(key.length+2);}catch{res.writeHead(400);res.end();return;}const file=assets.find(f=>f.name===name);if(!req.url?.startsWith('/'+key+'/')||!file){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':file.mime,'cache-control':'no-store'});res.end(file.bytes);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port,browser=await (await chromium()).launch({...await launchOptions(),headless:true,args:['--enable-unsafe-swiftshader']}).catch(error=>{server.close();throw error;});
 const context=await browser.newContext({viewport:{width:1280,height:800},recordVideo:{dir:directory,size:{width:1280,height:800}},acceptDownloads:false});
 const abort=()=>void context.close();options.signal?.addEventListener('abort',abort,{once:true});const errors:string[]=[];
 try{await context.route('**/*',async route=>{const u=new URL(route.request().url());if(['data:','blob:','about:'].includes(u.protocol)||u.origin===`http://127.0.0.1:${port}`)return route.continue();try{await assertPublicWebUrl(u.href);await route.continue();}catch{await route.abort();}});
  const page=await context.newPage(),recordStart=Date.now();page.on('pageerror',e=>errors.push(e.message.slice(0,300)));await page.goto(`http://127.0.0.1:${port}/${key}/${encodeURI(html.name)}`,{waitUntil:'load',timeout:30000});await page.waitForTimeout(1000);
  const screenshot=path.join(directory,'cover.png');await page.screenshot({path:screenshot});const seconds=Math.max(4,Math.min(30,options.seconds||10));
  let segment:{start?:number;end?:number}|void=undefined;if(options.onReady){segment=await options.onReady(page,recordStart);await page.waitForTimeout(800);}else{const steps=Math.max(1,Math.floor(seconds*2));for(let n=0;n<steps;n++){options.signal?.throwIfAborted();await page.evaluate(()=>{const items=[document.scrollingElement,...document.querySelectorAll('*')].filter((e):e is Element=>!!e&&e.scrollHeight>e.clientHeight+100);const target=items.sort((a,b)=>(b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight))[0];if(target)target.scrollTop+=Math.max(40,target.clientHeight/8);});await page.waitForTimeout(500);}}
  const video=page.video();await context.close();const videoPath=await video?.path();if(!videoPath)throw Error('录制没有生成视频文件');return {screenshot,video:videoPath,errors,start:segment?.start??0,end:segment?.end??seconds,recordedSeconds:(Date.now()-recordStart)/1000};
 }finally{options.signal?.removeEventListener('abort',abort);await context.close().catch(()=>{});await browser.close().catch(()=>{});await new Promise<void>(r=>server.close(()=>r()));}
}
