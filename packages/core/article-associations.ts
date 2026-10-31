import {z} from 'zod';
import {EditorialService} from './editorial';
import {CasebenchService,AppError,now} from './service';
import {ContentLibrary,activeLibraryMeta} from './content-library';
import {ContentWorkspace} from './content-workspace';
import type {ResourceKind,ResourceLink} from '../contracts/content-workspace';
import type {LibraryMeta,LibrarySource} from '../contracts/library';
import type {CandidateCase} from '../contracts/library';
import type {WritingArticle} from '../contracts/editorial';
export type AssociationItem={kind:ResourceKind;id:string};
export type AssociationActor={id:string;name:string};
const item=z.object({kind:z.enum(['source','candidate','case','media','instance']),id:z.string().regex(/^[a-z][a-z0-9_-]{1,120}$/i)}).strict();
const input=z.object({items:z.array(item).min(1).max(100)}).strict();
export class ArticleAssociations {
 constructor(private e:EditorialService,private actor:AssociationActor={id:'local',name:'本机用户'}){}
 async read(raw:unknown){const {items}=input.parse(raw),lib=new ContentLibrary(this.e,true);
  const [articles,metas,links,sources,cases,media,instances,candidates,legacySources]=await Promise.all([this.e.list<WritingArticle>('article'),this.e.list<LibraryMeta>('library-meta'),this.e.list<ResourceLink>('article-resource'),this.e.list<LibrarySource>('library-source'),this.e.s.listCases(true),lib.readMedia(),this.e.instances(),this.e.list<CandidateCase>('case-candidate'),this.e.list<{id:string}>('source')]);
  const rows=items.map(i=>{const m=metas.find(m=>m.kind===i.kind&&m.itemId===i.id),candidate=i.kind==='candidate',entry=cases.find(c=>c.id===i.id),instance=instances.find(v=>v.id===i.id),file=media.find(f=>f.id===i.id),source=sources.find(s=>s.id===i.id),sourceIds=i.kind==='source'?[i.id]:m?.sourceIds||[],fileIds=i.kind==='media'?[i.id]:i.kind==='instance'?[...new Set([...(instance?.files||[]).map(f=>f.id),...(instance?.media||[]).map(m=>m.file.id)])]:i.kind==='source'?media.filter(f=>f.sourceIds.includes(i.id)).map(f=>f.id):[];
   const exists=i.kind==='case'?entry:i.kind==='media'?file:i.kind==='instance'?instance:i.kind==='source'?source||legacySources.find(s=>s.id===i.id):candidates.find(c=>c.id===i.id);
   if(!exists)throw new AppError(404,'部分内容已不存在，请刷新列表');
   const ids=articles.filter(a=>{const own=links.filter(l=>l.articleId===a.id),direct=own.find(l=>l.kind===i.kind&&l.itemId===i.id),bodyUsed=i.kind==='media'&&!!a.document&&JSON.stringify(a.document).includes('"'+i.id+'"');if(bodyUsed)return true;if(direct?.state==='removed')return false;
    return (m&&activeLibraryMeta(m,links).articleIds.includes(a.id))||i.kind==='source'&&metas.some(child=>child.sourceIds.includes(i.id)&&activeLibraryMeta(child,links).articleIds.includes(a.id))||instance?.articleIds?.includes(a.id)||own.some(l=>l.state!=='removed'&&(l.kind===i.kind&&l.itemId===i.id||l.kind==='source'&&sourceIds.includes(l.itemId)))||a.references.some(r=>!r.removed&&(r.kind===(candidate?'case':i.kind)&&r.sourceId===i.id||i.kind==='media'&&r.files.some(f=>f.id===i.id)))||i.kind==='media'&&a.media.some(f=>f.id===i.id);
   }).map(a=>a.id);
   return {...i,articleIds:ids,attributions:ids.map(articleId=>{const l=links.find(l=>l.articleId===articleId&&l.kind===i.kind&&l.itemId===i.id&&l.state!=='removed');return {articleId,addedBy:l?.addedBy,addedAt:l?.createdAt};}),fileIds};
  });
  return {articles:articles.map(a=>({id:a.id,title:a.title,author:(a as WritingArticle&{ownerName?:string}).ownerName||null})),items:rows};
 }
 async change(raw:unknown){const v=z.object({items:z.array(item).min(1).max(100),addArticleIds:z.array(z.string().max(130)).max(100).default([]),removeArticleIds:z.array(z.string().max(130)).max(100).default([])}).strict().parse(raw);
  if(v.addArticleIds.some(id=>v.removeArticleIds.includes(id)))throw new AppError(400,'同一文章不能同时添加和移除');
  const snapshot=await this.read({items:v.items});for(const id of [...v.addArticleIds,...v.removeArticleIds])if(!snapshot.articles.some(a=>a.id===id))throw new AppError(404,'目标文章不存在');
  await this.e.s.db.transaction(async tx=>{const e=new EditorialService(new CasebenchService({...this.e.s.store,db:tx as any})),lib=new ContentLibrary(e),w=new ContentWorkspace(e);
   for(const articleId of [...new Set(v.removeArticleIds)]){
    // Lock and inspect the current document, not a stale browser snapshot.
    await e.mutate<WritingArticle>(articleId,'article',a=>{if(a.messages.some(m=>m.status==='pending'))throw new AppError(409,'文章正在生成，请完成后再移除关联');const fileIds=snapshot.items.flatMap(i=>i.fileIds);if(fileIds.some(id=>JSON.stringify(a.document||{}).includes('"'+id+'"')))throw new AppError(409,'该素材仍在文章正文中，请先从正文移除；文件和历史版本会保留');return a;});
    await w.change(articleId,{items:v.items,state:'removed'});
    for(const id of [...new Set(snapshot.items.flatMap(i=>i.fileIds))])await lib.detachMedia(articleId,id);
   }
   for(const articleId of [...new Set(v.addArticleIds)])for(const i of v.items){
    if(['case','candidate','media'].includes(i.kind))await lib.link(i.kind as 'case'|'candidate'|'media',i.id,{articleId});
    if(i.kind==='instance'){const inherited=snapshot.items.find(row=>row.kind==='instance'&&row.id===i.id)?.fileIds||[];for(const fileId of inherited){if((await e.s.file(fileId)).mime.match(/^(image|video)\//)){await lib.link('media',fileId,{articleId});await w.link(articleId,'media',fileId,{state:'pending'});}}}
    const old=(await e.list<ResourceLink>('article-resource')).find(l=>l.articleId===articleId&&l.kind===i.kind&&l.itemId===i.id);const l=await w.link(articleId,i.kind,i.id,old?.state==='removed'?{state:'pending'}:{});
    if(!old||old.state==='removed')await e.mutate<ResourceLink>(l.id,'article-resource',r=>({...r,addedBy:this.actor,createdAt:old?.state==='removed'?now():r.createdAt}));
   }
  });return this.read({items:v.items});
 }
}
