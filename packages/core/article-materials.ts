import {ContentWorkspace} from './content-workspace';
import {ContentLibrary} from './content-library';
import {z} from 'zod';
import {Slice,Fragment} from '@tiptap/pm/model';
import {Transform} from '@tiptap/pm/transform';
import type {EditorialService} from './editorial';
import type {DocumentNode,WritingArticle,WritingReference} from '../contracts/editorial';
import {AppError,now} from './service';
import {normalizeArticle,markdownDocument,validateDocument} from './writing-document';
import {writingSchema} from './writing-selection';
import {documentVersion} from './writing-service';
import {isWritingMedia} from '../contracts/writing-media';
import {importWritingImages,writingImages,downloadPublicImage} from './writing-web-media';

const choice=z.object({kind:z.enum(['source','instance','media','case']),id:z.string().max(130),parts:z.array(z.enum(['task','output','notes'])).default(['task','output','notes']),includeFiles:z.boolean().default(true),includeMetrics:z.boolean().default(false)}).strict();
const key=(r:WritingReference)=>r.kind+':'+r.sourceId;
export class ArticleMaterialsService {
  constructor(private e:EditorialService,private imageDownload=downloadPublicImage){}
  async importImages(id:string,body:unknown){
    const v=z.object({documentRevision:z.number().int().nonnegative()}).strict().parse(body),base=normalizeArticle(await this.e.get<WritingArticle>(id,'article'));
    if(base.documentRevision!==v.documentRevision)throw new AppError(409,'正文已更新，请重新读取后补入图片');
    const candidates=new Map(base.messages.filter(m=>m.role==='assistant'&&m.status==='complete'&&m.documentMarkdown).flatMap(m=>writingImages(m.documentMarkdown!)).map(i=>[i.url,i]));
    const link=(node:DocumentNode)=>{
      if(node.type!=='paragraph'||!node.content?.length)return null;
      const href=node.content[0].marks?.find(m=>m.type==='link')?.attrs?.href;
      return typeof href==='string'&&candidates.has(href)&&node.content.every(n=>n.type==='text'&&n.marks?.some(m=>m.type==='link'&&m.attrs?.href===href))?href:null;
    };
    const urls=[...new Set((base.document?.content||[]).map(link).filter((url):url is string=>!!url))];
    if(!urls.length)return {article:base,warnings:[]};
    const markdown=urls.map(url=>'!['+candidates.get(url)!.caption.replace(/[\\\[\]]/g,'\\$&')+'](<'+url+'>)').join('\n\n');
    const imported=await importWritingImages(this.e.s,markdown,base.webMedia||[],this.imageDownload,[...base.media,...base.references.flatMap(r=>r.files)]);
    if(!imported.files.length)return {article:base,warnings:imported.warnings};
    const article=await this.e.mutate<WritingArticle>(id,'article',raw=>{
      const a=normalizeArticle(raw);if(a.documentRevision!==v.documentRevision)throw new AppError(409,'补图期间正文有新修改，已保留当前正文，请重试补图');
      const media=[...new Map([...a.media,...imported.files].map(f=>[f.id,f])).values()];
      const document={...a.document!,content:a.document!.content!.map(node=>{const href=link(node),file=href&&imported.byUrl[href];return file?{type:'writingMedia',attrs:{fileId:file.id,caption:node.content!.map(n=>n.text||'').join('')}}:node;})};
      validateDocument(document,{...a,media});
      return {...a,media,webMedia:[...(a.webMedia||[]),...imported.sources],document,documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),versions:[...(a.versions||[]),documentVersion(a,'补入网页图片前')].slice(-30)};
    });
    return {article,warnings:imported.warnings};
  }
  async media(id:string,body:unknown){
    const v=z.object({fileIds:z.array(z.string().max(130)).min(1).max(20)}).strict().parse(body);
    const files=await Promise.all([...new Set(v.fileIds)].map(id=>this.e.s.file(id)));
    const article=await this.e.get<WritingArticle>(id,'article'),library=new ContentLibrary(this.e);for(const file of files){const m=await library.meta('media',file.id);if(m.trashedAt&&!article.media.some(f=>f.id===file.id))throw new AppError(409,'该素材已移入回收站，请先恢复');}
    if(files.some(f=>!isWritingMedia(f.mime)))throw new AppError(400,'正文只支持图片、GIF 和视频');
    // Union under the article lock: registering an upload never replaces prose or AI context.
    const updated=await this.e.mutate<WritingArticle>(id,'article',raw=>{
      const a=normalizeArticle(raw),media=[...new Map([...a.media,...files].map(f=>[f.id,f])).values()];
      return media.length===a.media.length?a:{...a,media,revision:a.revision+1,updatedAt:now()};
    });
    for(const file of files){await library.link('media',file.id,{articleId:id});await new ContentWorkspace(this.e).link(id,'media',file.id,{state:'selected'});}
    return updated;
  }
  async references(id:string,body:unknown){
    const v=z.object({revision:z.number().int(),add:z.array(choice).max(30).default([]),remove:z.array(z.string()).max(30).default([]),enabled:z.array(z.object({id:z.string(),value:z.boolean()})).max(30).default([])}).strict().parse(body),refs=await Promise.all(v.add.map(r=>this.e.snapshot(r)));
    const article=await this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);if(a.revision!==v.revision)throw new AppError(409,'文章资料已更新，请重新读取');if(a.messages.some(m=>m.status==='pending'))throw new AppError(409,'生成中，请稍后调整本篇资料');const references=a.references.map(r=>({...r,...(v.remove.includes(r.id)?{removed:true,enabled:false}:{}),...(v.enabled.find(e=>e.id===r.id)?{enabled:v.enabled.find(e=>e.id===r.id)!.value}:{})}));for(const ref of refs){const existing=references.find(r=>key(r)===key(ref));if(existing){existing.removed=false;existing.enabled=true;}else references.push({...ref,enabled:true});}if(references.filter(r=>!r.removed).length>30)throw new AppError(400,'每篇文章最多添加 30 条资料');return {...a,references,revision:a.revision+1,updatedAt:now()};});
    const workspace=new ContentWorkspace(this.e);for(const ref of article.references){if(v.remove.includes(ref.id)||v.enabled.some(v=>v.id===ref.id)||v.add.some(v=>v.id===ref.sourceId&&v.kind===ref.kind)){const candidates=ref.kind==='case'?await new ContentLibrary(this.e).candidates():[];await workspace.link(id,candidates.some(c=>c.id===ref.sourceId)?'candidate':ref.kind,ref.sourceId,{state:ref.removed?'removed':ref.enabled===false?'pending':'selected'});}}
    const library=new ContentLibrary(this.e);for(const ref of article.references.filter(r=>r.kind==='case')){const candidate=(await library.candidates()).find(c=>c.id===ref.sourceId),kind=candidate?'candidate':'case';if(ref.removed){const meta=await library.meta(kind,ref.sourceId);await this.e.mutate<any>(meta.id,'library-meta',m=>({...m,articleIds:m.articleIds.filter((v:string)=>v!==id)}));}else await library.link(kind,ref.sourceId,{articleId:id});}return article;
  }
  async insert(id:string,body:unknown){const v=z.object({documentRevision:z.number().int(),position:z.number().int().nonnegative(),requestKey:z.string().uuid(),references:z.array(choice).max(20).default([]),fileIds:z.array(z.string()).max(20).default([]),caption:z.string().max(500).default('')}).strict().parse(body);const existing=normalizeArticle(await this.e.get<WritingArticle>(id,'article'));if(existing.insertions?.includes(v.requestKey))return existing;const refs=await Promise.all(v.references.map(r=>this.e.snapshot(r))),files=await Promise.all(v.fileIds.map(id=>this.e.s.file(id)));
    const library=new ContentLibrary(this.e);for(const file of files)if((await library.meta('media',file.id)).trashedAt&&!existing.media.some(f=>f.id===file.id))throw new AppError(409,'素材已移入回收站，请先恢复');
    const instances=v.references.some(r=>r.kind==='instance')?await this.e.instances():[];
    return this.e.mutate<WritingArticle>(id,'article',raw=>{const a=normalizeArticle(raw);if(a.insertions?.includes(v.requestKey))return a;if(a.documentRevision!==v.documentRevision)throw new AppError(409,'正文已更新，请重新选择插入位置');const references=[...a.references];const nodes:DocumentNode[]=[];for(const ref of refs){const old=references.find(r=>key(r)===key(ref));if(!old)references.push({...ref,enabled:false,removed:true});const choice=v.references[refs.indexOf(ref)],instance=instances.find(i=>i.id===ref.sourceId),notes=ref.kind==='instance'?(choice.parts.includes('notes')?[instance?.preparation?.observation,instance?.notes].filter(Boolean).join('\n\n'):''):ref.notes;const text=[ref.task?`### 任务与提示词\n\n${ref.task}`:'',ref.output,notes?`### 实际观察与说明\n\n${notes}`:'',choice.includeMetrics&&instance?'执行指标：'+JSON.stringify(instance.metrics||{}):'',ref.url?`来源：[${ref.title}](${ref.url})`:''].filter(Boolean).join('\n\n');if(text)nodes.push(...markdownDocument(text).content!);}
      const media=[...new Map([...a.media,...files].map(f=>[f.id,f])).values()];for(const file of files)nodes.push({type:'writingMedia',attrs:{fileId:file.id,caption:v.caption||file.name}});if(!nodes.length)throw new AppError(400,'请至少选择一段内容或一个素材');const doc=writingSchema.nodeFromJSON(a.document);if(v.position>doc.content.size)throw new AppError(409,'插入位置已变化');const content=Fragment.fromArray(nodes.map(n=>writingSchema.nodeFromJSON(n))),document=new Transform(doc).replaceRange(v.position,v.position,new Slice(content,0,0)).doc.toJSON();validateDocument(document,{...a,references,media});return {...a,document,references,media,documentRevision:(a.documentRevision||0)+1,revision:a.revision+1,updatedAt:now(),versions:[...(a.versions||[]),documentVersion(a,'插入正文前')].slice(-30),insertions:[...(a.insertions||[]),v.requestKey].slice(-100)};});
  }
}
