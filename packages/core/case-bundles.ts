import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {caseInputSchema,type CaseRecord,type FileRecord} from '../contracts';
import type {LibraryCollection,LibraryMeta} from '../contracts/library';
import {CasebenchService,now} from './service';
import {EditorialService} from './editorial';
import {ContentLibrary} from './content-library';
import {MediaPreparationService} from './media-preparation';
import type {VideoCover} from './video-cover';

const checksum=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const assetSchema=z.object({path:z.string().min(1),mime:z.enum(['video/mp4','image/jpeg','image/png']),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive().max(25*1024*1024)}).strict();
const promptSchema=z.object({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const caseSchema=caseInputSchema.omit({prompt:true,inputIds:true,referenceId:true,instructions:true,expectedVersion:true}).extend({key:z.string().regex(/^[a-z0-9-]+$/),prompt:promptSchema,summary:z.string().max(500),reference:assetSchema,cover:assetSchema,tags:z.array(z.string().min(1).max(40)).max(30),provenance:z.record(z.string(),z.unknown()),followups:z.array(z.object({text:z.string(),sentAt:z.string(),attachments:z.array(z.string().nullable())}))}).strict();
const pendingSchema=z.object({key:z.string().regex(/^[a-z0-9-]+$/),title:z.string().min(1).max(100),summary:z.string().max(500),url:z.string().url(),documentUrl:z.string().url().optional(),documentSection:z.string(),reason:z.string(),reference:assetSchema.optional(),cover:assetSchema.optional()}).strict();
const bundleSchema=z.object({version:z.literal(1),id:z.string().regex(/^[a-z0-9-]+$/),title:z.string().min(1).max(80),sourceDocument:z.string().url(),dateRange:z.tuple([z.string(),z.string()]),cases:z.array(caseSchema).min(1).max(100),pending:z.array(pendingSchema).max(100)}).strict();
type Asset=z.infer<typeof assetSchema>;
export type CaseBundle=z.infer<typeof bundleSchema>;
export interface LoadedCaseBundle {data:CaseBundle;prompts:Map<string,string>;assets:Map<string,Uint8Array>}

/** Check the entire portable bundle before opening or modifying a business store. */
export async function readCaseBundle(manifestPath:string):Promise<LoadedCaseBundle>{
 const data=bundleSchema.parse(JSON.parse(await readFile(manifestPath,'utf8'))),root=await realpath(path.dirname(manifestPath)),prompts=new Map<string,string>(),assets=new Map<string,Uint8Array>();
 const keys=[...data.cases,...data.pending].map(v=>v.key);if(new Set(keys).size!==keys.length)throw Error('案例包中有重复编号');
 if(new Set(data.cases.map(c=>c.prompt.sha256)).size!==data.cases.length)throw Error('案例包中有重复提示词');
 async function file(relative:string){if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>p==='..'))throw Error('案例包文件必须位于包目录内');const resolved=await realpath(path.resolve(root,relative));if(!resolved.startsWith(root+path.sep))throw Error('案例包文件不能指向包外');return readFile(resolved);}
 async function asset(a:Asset){const bytes=await file(a.path);if(bytes.length!==a.size||checksum(bytes)!==a.sha256)throw Error('素材校验失败：'+a.path);if(a.mime==='video/mp4'&&Buffer.from(bytes).subarray(4,8).toString()!=='ftyp')throw Error('视频内容无效：'+a.path);if(a.mime==='image/jpeg'&&(bytes[0]!==255||bytes[1]!==216))throw Error('图片内容无效：'+a.path);if(a.mime==='image/png'&&Buffer.from(bytes).subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('图片内容无效：'+a.path);assets.set(a.path,bytes);}
 for(const c of data.cases){const prompt=(await file(c.prompt.path)).toString('utf8').trim();if(checksum(prompt)!==c.prompt.sha256)throw Error('提示词校验失败：'+c.key);caseInputSchema.parse({...c,prompt,inputIds:[],referenceId:null,instructions:''});prompts.set(c.key,prompt);await asset(c.reference);await asset(c.cover);if(!c.reference.mime.startsWith('video/')||!c.cover.mime.startsWith('image/'))throw Error('正式案例需提供参考视频和图片封面');}
 for(const c of data.pending){if(c.reference)await asset(c.reference);if(c.cover)await asset(c.cover);}
 return {data,prompts,assets};
}

export interface BundleBinding {key:string;caseId?:string;candidateId?:string;promptHash?:string;referenceId?:string;coverId?:string}
interface ImportRecord {id:string;bundleId:string;items:BundleBinding[];sourceDocument:string;createdAt:string}
export async function planCaseBundle(s:CasebenchService,b:LoadedCaseBundle){
 const e=new EditorialService(s),all=await s.listCases(true),record=(await e.list<ImportRecord>('case-bundle-import')).find(r=>r.bundleId===b.data.id),items=[];
 for(const c of b.data.cases){const prompt=b.prompts.get(c.key)!,bound=record?.items.find(i=>i.key===c.key),entry=bound?.caseId?all.find(v=>v.id===bound.caseId):undefined,matches=all.filter(v=>checksum(v.prompt.trim())===c.prompt.sha256);if(bound&&(!entry||entry.prompt.trim()!==prompt))throw Error('已导入案例已被修改或移除，保留原内容，请先核对：'+c.title);if(!entry&&matches.length>1)throw Error('提示词对应多个已有案例，请先核对：'+c.title);items.push({key:c.key,title:c.title,action:entry||matches.length?'reuse':'create',caseId:entry?.id||matches[0]?.id});}
 return {bundle:b.data.id,create:items.filter(v=>v.action==='create').length,reuse:items.filter(v=>v.action==='reuse').length,pending:b.data.pending.map(v=>({key:v.key,title:v.title,reason:v.reason})),items};
}

/** Uses the same services as the website; no model runs or fabricated execution records. */
export async function importCaseBundle(s:CasebenchService,b:LoadedCaseBundle){
 const plan=await planCaseBundle(s,b);
 return s.db.transaction(async tx=>{
  const scoped=new CasebenchService({...s.store,db:tx as any}),e=new EditorialService(scoped),lib=new ContentLibrary(e),at=now(),bindings:BundleBinding[]=[];
  let collection=(await lib.collections()).find(c=>c.title===b.data.title);if(!collection)collection=await lib.collection({title:b.data.title}) as LibraryCollection;
  async function file(a:Asset,name:string){return scoped.putFile(b.assets.get(a.path)!,name,a.mime,'reference');}
  async function patch(kind:'case'|'candidate'|'media',id:string,body:Partial<LibraryMeta>){const old=await lib.meta(kind,id),changes=Object.fromEntries(Object.entries(body).filter(([key,value])=>JSON.stringify(old[key as keyof LibraryMeta])!==JSON.stringify(value)));if(Object.keys(changes).length)await lib.patch(kind,id,changes);}
  async function metadata(kind:'case'|'candidate'|'media',id:string,summary:string,tags:string[],cover:FileRecord){const old=await lib.meta(kind,id);await patch(kind,id,{summary:old.summary||summary,tags:[...new Set([...old.tags,...tags])],collectionIds:[...new Set([...old.collectionIds,collection!.id])],...(old.coverFileId?{}:{coverFileId:cover.id})});}
  async function reference(a:Asset,coverAsset:Asset|undefined,title:string,summary:string,tags:string[]){
   const v=await file(a,title+' · Kimi参考'+(a.mime.startsWith('video/')?'.mp4':a.mime==='image/png'?'.png':'.jpg')),cover=coverAsset?await file(coverAsset,title+' · 封面.jpg'):v;
   if(v.mime.startsWith('video/')&&cover.mime.startsWith('image/')){const id='cover_'+v.id.slice(5);let old:VideoCover|undefined;try{old=await e.get<VideoCover>(id,'video-cover');}catch(error){if((error as any).status!==404)throw error;}if(!old)await e.insert('video-cover',{id,videoId:v.id,frames:[cover],defaultId:cover.id,createdAt:at});else if(!old.frames.some(f=>f.id===cover.id))await e.mutate<VideoCover>(id,'video-cover',o=>({...o,frames:[...o.frames,cover]}));}
   if(!(await e.list<any>('prepared-media')).some(m=>m.file.id===v.id&&m.instanceId===null))await new MediaPreparationService(e).attach({fileId:v.id,caption:title+' · Kimi参考效果',origin:'uploaded'});
   await metadata('media',v.id,summary,tags,cover);await patch('media',v.id,{title:title+' · Kimi参考效果'});return {video:v,cover};
  }
  for(const c of b.data.cases){
   const {video,cover}=await reference(c.reference,c.cover,c.title,c.summary,c.tags),existingId=plan.items.find(p=>p.key===c.key)?.caseId;let entry:CaseRecord;
   if(existingId){entry=(await scoped.listCases(true)).find(v=>v.id===existingId)!;if(!entry.reference)entry=await scoped.saveCase({...entry,inputIds:entry.inputs.map(f=>f.id),referenceId:video.id,expectedVersion:entry.version},entry.id);}
   else entry=await scoped.saveCase({title:c.title,prompt:b.prompts.get(c.key),scene:c.scene,scenes:c.scenes,capabilities:c.capabilities,artifactType:c.artifactType,artifactTypes:c.artifactTypes,executionMode:c.executionMode,inputIds:[],referenceId:video.id,instructions:''});
   await metadata('case',entry.id,c.summary,c.tags,cover);bindings.push({key:c.key,caseId:entry.id,promptHash:c.prompt.sha256,referenceId:video.id,coverId:cover.id});
  }
  for(const c of b.data.pending){const media=c.reference?await reference(c.reference,c.cover,c.title,c.summary,['Kimi 2026-10']):undefined,candidate=await lib.candidate({url:c.url,title:c.title,summary:c.summary,author:'Kimi 案例整理',mediaIds:media?[media.video.id]:[]});if(media)await metadata('candidate',candidate.id,c.summary,['Kimi 2026-10'],media.cover);else{const old=await lib.meta('candidate',candidate.id);await patch('candidate',candidate.id,{summary:c.summary,collectionIds:[...new Set([...old.collectionIds,collection.id])],tags:[...new Set([...old.tags,'Kimi 2026-10'])]});}bindings.push({key:c.key,candidateId:candidate.id,...(media?{referenceId:media.video.id,coverId:media.cover.id}:{})});}
  const id='bundle_'+b.data.id,record=(await e.list<ImportRecord>('case-bundle-import')).find(r=>r.id===id),data={id,bundleId:b.data.id,items:bindings,sourceDocument:b.data.sourceDocument,createdAt:record?.createdAt||at};if(!record)await e.insert('case-bundle-import',data);else if(JSON.stringify(record)!==JSON.stringify(data))await e.mutate(id,'case-bundle-import',()=>data);
  return {...plan,bindings,collectionId:collection.id};
 });
}
