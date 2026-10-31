import path from 'node:path';
import {readFile} from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import type {EditorialService} from './editorial';
import type {FileRecord} from '../contracts';
import {videoFrames,runMediaCommand} from './media-runtime';
import {now} from './service';
export interface VideoCover {id:string;videoId:string;frames:FileRecord[];defaultId:string;createdAt:string}
const pending=new Map<string,Promise<VideoCover>>();
export async function ensureVideoCover(e:EditorialService,file:FileRecord):Promise<VideoCover>{
 const old=(await e.list<VideoCover>('video-cover')).find(c=>c.videoId===file.id);if(old)return old;
 const key=e.s.store.directory+file.id;if(pending.has(key))return pending.get(key)!;
 const work=(async()=>{const directory=path.join(e.s.store.directory,'video-covers',file.id),paths=await videoFrames(e.s.filePath(file.id),directory),frames:FileRecord[]=[];
  for(const p of paths){
   // Measure luminance rather than assuming a large PNG is a usable frame.
   const statsPath=p+'.stats';await runMediaCommand(ffmpeg!,['-nostdin','-hide_banner','-loglevel','error','-i',p,'-vf',`signalstats,metadata=print:file=${statsPath}`,'-frames:v','1','-f','null','-']);
   const stats=await readFile(statsPath,'utf8'),luma=Number(/lavfi.signalstats.YAVG=([\d.]+)/.exec(stats)?.[1]??255);
   if(luma<24)continue;
   const bytes=await readFile(p);
   const frame=await e.s.putFile(bytes,'视频封面-'+(frames.length+1)+'.png','image/png','reference');if(!frames.some(f=>f.id===frame.id))frames.push(frame);
  }
  if(!frames.length)throw Error('未取得有效视频画面');
  const cover:VideoCover={id:'cover_'+file.id.slice(5),videoId:file.id,frames,defaultId:frames[Math.min(1,frames.length-1)].id,createdAt:now()};return e.insert('video-cover',cover);
 })();pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
