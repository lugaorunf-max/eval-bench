import {createHash} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import type {CasePromptDraft,MediaJob} from './media-workflow';
import type {EditorialService} from './editorial';
import type {WritingArticle,WritingReference,SourceItem} from '../contracts/editorial';
import type {CandidateCase,LibrarySource,LibraryMeta} from '../contracts/library';
import type {ResourceCard,ResourceKind,ResourceLink} from '../contracts/content-workspace';
import {ContentLibrary,libraryMetaId,canonicalSource} from './content-library';
import {editorialRecords} from './schema';
import {AppError,now,newId} from './service';

export const resourceKey=(kind:ResourceKind,id:string)=>kind+':'+id;
const linkId=(articleId:string,kind:ResourceKind,id:string)=>'resource_'+createHash('sha256').update(articleId+'|'+resourceKey(kind,id)).digest('hex').slice(0,32);
const kindSchema=z.enum(['source','candidate','case','media','instance']);
export class ContentWorkspace {
 constructor(public e:EditorialService){}
 async link(articleId:string,kind:ResourceKind,itemId:string,values:Partial<Pick<ResourceLink,'state'|'priority'>> & {origin?:'manual'|'automatic'}={}){
  if(articleId)await this.e.get(articleId,'article');
  const id=linkId(articleId,kind,itemId),at=now();
  await this.e.s.db.insert(editorialRecords).values({id,kind:'article-resource',data:{id,articleId,kind,itemId,state:'pending',priority:false,origins:[],createdAt:at,updatedAt:at},createdAt:at,updatedAt:at}).onConflictDoNothing();
  const {origin,...patch}=values;
  return this.e.mutate<ResourceLink>(id,'article-resource',r=>({...r,...(origin==='manual'&&['ignored','removed'].includes(r.state)?{state:'pending' as const}:{}),...patch,origins:[...new Set([...r.origins,...(origin?[origin]:[])])],updatedAt:now()}));
 }
 async record(raw:{url:string;title:string;summary?:string;author?:string;articleId?:string;intent?:'media'|'case'|'article';origin?:'manual'|'automatic';priority?:boolean;previewUrl?:string;hasVideo?:boolean}){
  const library=new ContentLibrary(this.e),source=await library.source(raw);
  await this.e.mutate<LibrarySource>(source.id,'library-source',s=>({...s,summary:raw.summary||s.summary||'',previewUrl:raw.previewUrl||s.previewUrl,hasVideo:s.hasVideo||raw.hasVideo,intents:[...new Set([...(s.intents||[]),raw.intent||'article'])]}));
  await this.link('', 'source',source.id,{origin:raw.origin||'manual',...(raw.priority!==undefined?{priority:raw.priority}:{})});
  if(raw.articleId){await this.link(raw.articleId,'source',source.id,{origin:raw.origin||'manual',...(raw.priority!==undefined?{priority:raw.priority}:{})});if(raw.origin!=='automatic')await this.attach(raw.articleId,'source',source.id);}
  return this.e.get<LibrarySource>(source.id,'library-source');
 }
 async attach(articleId:string,kind:ResourceKind,id:string){
  const library=new ContentLibrary(this.e);await this.e.get(articleId,'article');
  if(['case','candidate','media'].includes(kind)){await library.ensureItem(kind as 'case'|'candidate'|'media',id);await library.link(kind as 'case'|'candidate'|'media',id,{articleId});}
  else if(kind==='source'){await this.e.get(id,'library-source');}
  else if(!(await this.e.instances()).some(i=>i.id===id))throw new AppError(404,'实测结果不存在');
  const metas=await this.e.list<LibraryMeta>('library-meta'),sourceIds=kind==='source'?[id]:metas.find(m=>m.kind===kind&&m.itemId===id)?.sourceIds||[];
  const links=await this.e.list<ResourceLink>('article-resource');
  for(const sourceId of sourceIds){const old=links.find(l=>l.articleId===articleId&&l.kind==='source'&&l.itemId===sourceId);await this.link(articleId,'source',sourceId,old&&['ignored','removed'].includes(old.state)?{state:'pending'}:{});for(const meta of metas.filter(m=>!m.trashedAt&&!m.purgedAt&&m.sourceIds.includes(sourceId))){const prior=links.find(l=>l.articleId===articleId&&l.kind===meta.kind&&l.itemId===meta.itemId);if(prior&&['ignored','removed'].includes(prior.state))await this.link(articleId,meta.kind,meta.itemId,{state:'pending'});await library.link(meta.kind,meta.itemId,{articleId});}}
  const old=(await this.e.list<ResourceLink>('article-resource')).find(r=>r.articleId===articleId&&r.kind===kind&&r.itemId===id);
  return this.link(articleId,kind,id,old&&['ignored','removed'].includes(old.state)?{state:'pending'}:{});
 }
 private async snapshot(kind:ResourceKind,id:string):Promise<WritingReference>{
  if(kind==='source'){
   let s:LibrarySource;try{s=await this.e.get(id,'library-source');}catch{return this.e.snapshot({kind:'source',id});}
   const library=new ContentLibrary(this.e),media=(await library.media()).filter(m=>!m.meta.trashedAt&&m.sourceIds.includes(s.id));
   const metas=await this.e.list<LibraryMeta>('library-meta'),entries=(await this.e.s.listCases()).filter(c=>metas.some(m=>m.kind==='case'&&m.itemId===c.id&&m.sourceIds.includes(s.id)&&!m.trashedAt));
   return {id:newId('ref'),sourceId:s.id,kind:'source',title:s.title,url:s.url,task:entries.map(c=>c.title+' · 案例 v'+c.version+' 的提示词（任务要求，不代表实测效果）\n'+c.prompt).join('\n\n'),output:s.summary||'',notes:'外部来源，作者陈述不等于本机实测。',files:media.map(m=>m.file),capturedAt:now(),enabled:true};
  }
  return this.e.snapshot({kind:kind==='candidate'?'case':kind,id});
 }
 async change(articleId:string,body:unknown){
  const v=z.object({items:z.array(z.object({kind:kindSchema,id:z.string().max(130)}).strict()).min(1).max(100),state:z.enum(['pending','selected','ignored','removed']).optional(),priority:z.boolean().optional()}).strict().parse(body);
  if(articleId&&['removed','ignored','pending'].includes(v.state||'')){
   const sourceIds=v.items.filter(i=>i.kind==='source').map(i=>i.id);
   for(const meta of await this.e.list<LibraryMeta>('library-meta'))if(!meta.purgedAt&&meta.sourceIds.some(id=>sourceIds.includes(id))&&!v.items.some(i=>i.kind===meta.kind&&i.id===meta.itemId))v.items.push({kind:meta.kind,id:meta.itemId});
  }
  // Validate and prepare every snapshot before touching any article references.
  const snapshots=new Map<string,WritingReference>(),sourceUrls=new Map<string,string>();
  for(const item of v.items)if(item.kind==='source'){let source:LibrarySource|SourceItem;try{source=await this.e.get(item.id,'library-source');}catch{source=await this.e.get(item.id,'source');}if(source.url)sourceUrls.set(item.id,canonicalSource(source.url));}
  for(const item of v.items){if(v.state==='selected'&&articleId)snapshots.set(resourceKey(item.kind,item.id),await this.snapshot(item.kind,item.id));else if(item.kind==='source'){try{await this.e.get(item.id,'library-source');}catch{await this.e.get(item.id,'source');}}else if(item.kind==='instance'){if(!(await this.e.instances()).some(i=>i.id===item.id))throw new AppError(404,'实测结果不存在');}else await new ContentLibrary(this.e).ensureItem(item.kind,item.id);}
  const replacingSources=v.state==='selected'?v.items.filter(i=>i.kind==='source').map(i=>i.id):[],replacedChildren=(await this.e.list<LibraryMeta>('library-meta')).filter(m=>m.sourceIds.some(id=>replacingSources.includes(id)));
  if(articleId&&v.state){await this.e.mutate<WritingArticle>(articleId,'article',a=>{
   if(a.messages.some(m=>m.status==='pending'))throw new AppError(409,'正在生成，请完成后调整参考资料');
   const references=a.references.map(ref=>replacedChildren.some(m=>m.itemId===ref.sourceId&&(m.kind==='candidate'?'case':m.kind)===ref.kind)?{...ref,enabled:false}:ref);
   for(const item of v.items){const refKind=item.kind==='candidate'?'case':item.kind,index=references.findIndex(r=>r.sourceId===item.id&&r.kind===refKind||item.kind==='source'&&r.kind==='source'&&r.url&&sourceUrls.get(item.id)===canonicalSource(r.url)),ref=snapshots.get(resourceKey(item.kind,item.id));
    if(index>=0)references[index]={...references[index],...(ref?{...ref,id:references[index].id}:{}),enabled:v.state==='selected',removed:v.state==='removed'};
    else if(ref)references.push(ref);
   }
   if(references.filter(r=>!r.removed&&r.enabled!==false).length>30)throw new AppError(400,'本篇最多选用 30 条参考，请先取消部分资料');
   return {...a,references,revision:a.revision+1,updatedAt:now()};
  });}
  for(const item of v.items){await this.link(articleId,item.kind,item.id,{...(v.state?{state:v.state}:{}),...(v.priority!==undefined?{priority:v.priority}:{})});
   if(articleId&&v.state==='selected'&&['case','candidate','media'].includes(item.kind))await this.attach(articleId,item.kind,item.id);
   if(articleId&&v.state==='removed'&&['case','candidate','media'].includes(item.kind)){const meta=await new ContentLibrary(this.e).meta(item.kind as 'case'|'candidate'|'media',item.id);await this.e.mutate<LibraryMeta>(meta.id,'library-meta',m=>({...m,articleIds:m.articleIds.filter(id=>id!==articleId),updatedAt:now()}));}
  }
  return {updated:v.items.length};
 }
 async cards(articleId=''):Promise<ResourceCard[]>{
  const library=new ContentLibrary(this.e,true);
  const [sources,candidates,media,cases,instances,links,articles,metas,sourceItems,jobs]=await Promise.all([this.e.list<LibrarySource>('library-source'),library.candidates(),library.readMedia(),this.e.s.listCases(true),this.e.instances(),this.e.list<ResourceLink>('article-resource'),this.e.list<WritingArticle>('article'),this.e.list<LibraryMeta>('library-meta'),this.e.list<SourceItem>('source'),this.e.list<MediaJob>('media-job')]);
  const article=articleId?articles.find(a=>a.id===articleId):undefined;if(articleId&&!article)throw new AppError(404,'文章不存在');
  const scoped=links.filter(l=>l.articleId===articleId),global=links.filter(l=>!l.articleId),refFor=(kind:ResourceKind,id:string)=>article?.references.find(r=>r.sourceId===id&&r.kind===(kind==='candidate'?'case':kind)&&!r.removed),out:ResourceCard[]=[];
  const metaFor=(kind:'media'|'case'|'candidate',id:string)=>metas.find(m=>m.id===libraryMetaId(kind,id));
  const add=(card:Omit<ResourceCard,'state'|'priority'|'origins'|'selected'|'inserted'>,related:boolean,members:{kind:ResourceKind;id:string}[]=[])=>{
   const link=scoped.find(l=>l.kind===card.kind&&l.itemId===card.id),base=global.find(l=>l.kind===card.kind&&l.itemId===card.id),ref=refFor(card.kind,card.id)||(card.kind==='source'&&card.url?article?.references.find(r=>!r.removed&&r.url&&canonicalSource(r.url)===canonicalSource(card.url)):undefined);
   if(articleId&&!related&&!link&&!ref)return;
   const childSelected=members.some(member=>scoped.some(l=>l.kind===member.kind&&l.itemId===member.id&&l.state==='selected')||article?.references.some(r=>r.sourceId===member.id&&r.kind===(member.kind==='candidate'?'case':member.kind)&&r.enabled!==false&&!r.removed));
   const selected=link?.state==='selected'||!!ref&&ref.enabled!==false||childSelected;if(link?.state==='removed'&&!selected)return;
   const inserted=!!article?.document&&card.files.some(f=>JSON.stringify(article.document).includes('"'+f.id+'"'));
   const articleIds=[...new Set([...(card.articleIds||[]),...links.filter(l=>l.articleId&&l.kind===card.kind&&l.itemId===card.id&&l.state!=='removed').map(l=>l.articleId),...articles.filter(a=>a.references.some(r=>!r.removed&&r.kind===(card.kind==='candidate'?'case':card.kind)&&r.sourceId===card.id)).map(a=>a.id)])].filter(id=>!links.some(l=>l.articleId===id&&l.kind===card.kind&&l.itemId===card.id&&l.state==='removed'));
   out.push({...card,articleIds,state:selected?'selected':link?.state||'pending',priority:link?.priority??base?.priority??false,origins:[...new Set(link?.origins.length?link.origins:base?.origins||[])],selected,inserted});
  };
  const drafts=await this.e.list<CasePromptDraft>('case-prompt-draft');
  const groupedCases=new Set<string>(),groupedCandidates=new Set<string>(),groupedFiles=new Set<string>();
  for(const source of sources){
   if(!source.url)continue;
   const candidate=candidates.find(c=>c.sourceId===source.id&&!c.meta?.trashedAt),files=media.filter(m=>!m.meta.trashedAt&&(!articleId||!scoped.some(l=>l.kind==='media'&&l.itemId===m.id&&l.state==='removed'))&&(m.sourceIds.includes(source.id)||m.source?.url&&canonicalSource(m.source.url)===source.url));
   if((!source.url||/\/instances(?:[?#]|$)/.test(source.url))&&files.some(m=>m.instanceId))continue;
   const linkedCases=cases.filter(c=>metaFor('case',c.id)?.sourceIds.includes(source.id)&&!metaFor('case',c.id)?.trashedAt);
   const related=!!articleId&&(!!scoped.find(l=>l.kind==='source'&&l.itemId===source.id)||!!candidate?.meta?.articleIds.includes(articleId)||linkedCases.some(c=>metaFor('case',c.id)?.articleIds.includes(articleId))||files.some(m=>m.meta.articleIds.includes(articleId)||m.uses.some(u=>u.articleId===articleId))||!!article?.references.some(r=>!r.removed&&r.url&&canonicalSource(r.url)===source.url));
   add({key:resourceKey('source',source.id),kind:'source',id:source.id,title:drafts.find(d=>d.id===candidate?.draftId)?.title||source.title,sourceText:source.summary,summary:drafts.find(d=>d.id===candidate?.draftId)?.summary||source.cardSummary||'',scenes:drafts.find(d=>d.id===candidate?.draftId)?.scenes||source.scenes,artifactTypes:drafts.find(d=>d.id===candidate?.draftId)?.artifactTypes||source.artifactTypes,scene:drafts.find(d=>d.id===candidate?.draftId)?.scene||source.scene,artifactType:drafts.find(d=>d.id===candidate?.draftId)?.artifactType||source.artifactType,capabilities:drafts.find(d=>d.id===candidate?.draftId)?.capabilities||source.capabilities,cover:candidate?await library.cover('candidate',candidate.id):undefined,articleIds:[...new Set([...links.filter(l=>l.kind==='source'&&l.itemId===source.id&&l.articleId&&l.state!=='removed').map(l=>l.articleId),...candidate?.meta?.articleIds||[],...files.flatMap(m=>m.meta.articleIds),...linkedCases.flatMap(c=>metaFor('case',c.id)?.articleIds||[])])],url:source.url,author:source.author,createdAt:source.createdAt,files:files.map(m=>m.file),caseIds:linkedCases.map(c=>c.id),candidateId:candidate?.id,draftId:candidate?.draftId,analysisState:candidate?.savedCaseId?'ready':candidate&&jobs.find(j=>j.targetId===candidate.id)?.status==='running'?'running':candidate&&jobs.find(j=>j.targetId===candidate.id)?.status==='failed'?'failed':candidate?.draftId?'review':candidate?'unparsed':undefined,previewUrl:source.previewUrl,hasVideo:source.hasVideo},related,[...files.map(m=>({kind:'media' as const,id:m.file.id})),...linkedCases.map(c=>({kind:'case' as const,id:c.id})),...(candidate?[{kind:'candidate' as const,id:candidate.id}]:[])]);
   if(!articleId||related||scoped.some(l=>l.kind==='source'&&l.itemId===source.id)){if(candidate)groupedCandidates.add(candidate.id);linkedCases.forEach(c=>groupedCases.add(c.id));files.forEach(m=>groupedFiles.add(m.id));}
  }
  for(const c of candidates){if(groupedCandidates.has(c.id)||c.meta?.trashedAt||c.savedCaseId)continue;add({key:resourceKey('candidate',c.id),kind:'candidate',id:c.id,title:c.meta?.title||drafts.find(d=>d.id===c.draftId)?.title||c.title,sourceText:c.summary,summary:drafts.find(d=>d.id===c.draftId)?.summary||'',scenes:drafts.find(d=>d.id===c.draftId)?.scenes,artifactTypes:drafts.find(d=>d.id===c.draftId)?.artifactTypes,scene:drafts.find(d=>d.id===c.draftId)?.scene,artifactType:drafts.find(d=>d.id===c.draftId)?.artifactType,capabilities:drafts.find(d=>d.id===c.draftId)?.capabilities,cover:await library.cover('candidate',c.id),articleIds:c.meta?.articleIds||[],url:c.url,author:c.author,createdAt:c.createdAt,files:await Promise.all(c.mediaIds.map(id=>this.e.s.file(id))),caseIds:[],candidateId:c.id,draftId:c.draftId,analysisState:jobs.find(j=>j.targetId===c.id)?.status==='running'?'running':jobs.find(j=>j.targetId===c.id)?.status==='failed'?'failed':c.draftId?'review':'unparsed'},!!c.meta?.articleIds.includes(articleId));}
  for(const c of cases){if(groupedCases.has(c.id)||metaFor('case',c.id)?.trashedAt)continue;add({key:resourceKey('case',c.id),kind:'case',id:c.id,title:metaFor('case',c.id)?.title||c.title,summary:metaFor('case',c.id)?.summary||'',scene:c.scene,scenes:c.scenes,artifactTypes:c.artifactTypes,artifactType:c.artifactType,capabilities:c.capabilities,cover:await library.cover('case',c.id),articleIds:metaFor('case',c.id)?.articleIds||[],url:'',author:'',createdAt:c.createdAt,files:c.reference?[c.reference]:[],caseIds:[c.id]},!!metaFor('case',c.id)?.articleIds.includes(articleId));}
  for(const i of instances){const before=out.length;add({key:resourceKey('instance',i.id),kind:'instance',id:i.id,articleIds:i.articleIds,title:i.title,summary:i.preparation?.observation||i.notes||'',url:'',author:i.agent||'',createdAt:i.createdAt,files:[...new Map([...i.files.filter(f=>/^image\//.test(f.mime)||f.mime.startsWith('video/')),...(i.media||[]).map(m=>m.file)].map(f=>[f.id,f])).values()],caseIds:[],instanceId:i.id,executionStatus:i.status},!!i.articleIds?.includes(articleId));if(out.length>before)(i.media||[]).forEach(m=>groupedFiles.add(m.file.id));}
  for(const m of media){if(groupedFiles.has(m.id)||m.meta.trashedAt)continue;add({key:resourceKey('media',m.id),kind:'media',id:m.id,articleIds:[...m.meta.articleIds,...m.uses.filter(u=>u.associated||u.reference||u.inserted).map(u=>u.articleId)],title:m.meta.title||m.file.name,summary:m.source?.title||'',url:m.source?.url||'',author:m.source?.author||'',createdAt:m.createdAt,files:[m.file],caseIds:[],instanceId:m.instanceId||undefined},m.meta.articleIds.includes(articleId)||m.uses.some(u=>u.articleId===articleId));}
  // Existing article references stay visible without inventing ownership for unrelated history.
  for(const ref of article?.references||[]){if(ref.removed||out.some(c=>c.id===ref.sourceId||c.url&&c.url===ref.url))continue;const s=sourceItems.find(s=>s.id===ref.sourceId);if(s)add({key:resourceKey('source',s.id),kind:'source',id:s.id,title:s.title,summary:s.summary,url:s.url,author:s.source,createdAt:s.createdAt,files:ref.files,caseIds:[]},true);}
  return out.sort((a,b)=>Number(b.priority)-Number(a.priority)||b.createdAt.localeCompare(a.createdAt));
 }
}
